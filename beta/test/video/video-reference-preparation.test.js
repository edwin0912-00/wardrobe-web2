import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const script = path.join(repo, 'beta/tools/prepare-video-references.py');
const manifestPath = path.join(repo, 'beta/config/video-reference-preparation/fashion-cool-style-v1.json');
const baseManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const python = process.env.PYTHON ?? 'python3';

function runPython(args, options = {}) {
  return spawnSync(python, args, {
    cwd: repo,
    encoding: 'utf8',
    ...options,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ...options.env },
  });
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wardrobe-video-prep-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'sources');
  const bin = path.join(root, 'bin');
  await mkdir(sourceRoot);
  await mkdir(bin);
  const manifest = structuredClone(baseManifest);
  const probe = {};
  for (const reference of manifest.references) {
    const bytes = Buffer.from(`test-source:${reference.filename}`);
    reference.source_sha256 = createHash('sha256').update(bytes).digest('hex');
    reference.face_tracks.bound_to.source_sha256 = reference.source_sha256;
    await writeFile(path.join(sourceRoot, reference.filename), bytes);
    probe[reference.filename] = {
      width: reference.width,
      height: reference.height,
      avg_frame_rate: reference.fps,
      nb_read_frames: String(reference.frame_count),
      duration: String(reference.duration_seconds),
      pix_fmt: 'yuv420p',
      color_range: 'tv',
    };
  }
  const manifestFile = path.join(root, 'manifest.json');
  const probeFile = path.join(root, 'probe.json');
  await writeFile(manifestFile, JSON.stringify(manifest));
  await writeFile(probeFile, JSON.stringify(probe));
  const fakeProbe = path.join(bin, 'ffprobe');
  await writeFile(fakeProbe, [
    '#!/usr/bin/env python3',
    'import json, os, sys',
    'from pathlib import Path',
    'fixtures = json.loads(Path(os.environ["FAKE_PROBE_JSON"]).read_text())',
    'stream = fixtures[Path(sys.argv[-1]).name]',
    'print(json.dumps({"streams": [stream]}))',
    '',
  ].join('\n'));
  await chmod(fakeProbe, 0o755);
  return { root, sourceRoot, manifestFile, probeFile, bin };
}

test('metadata manifest is bound to four catalog references and the pinned depth revision', () => {
  assert.equal(baseManifest.depth_model.revision, '5426e4f0f36572d16453bbda7a8389317b1bef99');
  assert.deepEqual(baseManifest.references.map(({ id, filename }) => [id, filename]), [
    ['editorial-detail', 'reference-01.mp4'],
    ['walk-camera-energy', 'reference-02.mp4'],
    ['hard-sun-pose', 'reference-03.mp4'],
    ['architectural-stair-glitch', 'reference-04.mp4'],
  ]);
  assert.deepEqual(baseManifest.references.map(({ frame_count }) => frame_count), [331, 379, 378, 375]);
  assert.equal(baseManifest.references.reduce((sum, reference) => sum + reference.face_tracks.frames.length, 0), 1463);
});

test('--help does not import optional video or depth libraries', () => {
  const result = runPython([script, '--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /inspect.*prepare.*verify/s);
});

test('inspect accepts unchanged sources with fake ffprobe metadata', async (t) => {
  const testCase = await fixture(t);
  const result = runPython([script, 'inspect', '--manifest', testCase.manifestFile, '--source-root', testCase.sourceRoot], {
    env: { ...process.env, PATH: `${testCase.bin}${path.delimiter}${process.env.PATH}`, FAKE_PROBE_JSON: testCase.probeFile },
  });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.references.length, 4);
  assert.equal(summary.references[0].frames, 331);
});

test('inspect fails closed when a source hash changes or a source file is missing', async (t) => {
  const changed = await fixture(t);
  await writeFile(path.join(changed.sourceRoot, 'reference-01.mp4'), 'changed after binding');
  const changedResult = runPython([script, 'inspect', '--manifest', changed.manifestFile, '--source-root', changed.sourceRoot], {
    env: { ...process.env, PATH: `${changed.bin}${path.delimiter}${process.env.PATH}`, FAKE_PROBE_JSON: changed.probeFile },
  });
  assert.notEqual(changedResult.status, 0);
  assert.match(changedResult.stderr, /SHA-256 changed/);

  const missing = await fixture(t);
  await rm(path.join(missing.sourceRoot, 'reference-04.mp4'));
  const missingResult = runPython([script, 'inspect', '--manifest', missing.manifestFile, '--source-root', missing.sourceRoot], {
    env: { ...process.env, PATH: `${missing.bin}${path.delimiter}${process.env.PATH}`, FAKE_PROBE_JSON: missing.probeFile },
  });
  assert.notEqual(missingResult.status, 0);
  assert.match(missingResult.stderr, /Missing source file/);
});

test('inspect rejects changed source timing and matte validation rejects non-binary pixels', async (t) => {
  const testCase = await fixture(t);
  const probe = JSON.parse(await readFile(testCase.probeFile, 'utf8'));
  probe['reference-02.mp4'].duration = '15.20';
  await writeFile(testCase.probeFile, JSON.stringify(probe));
  const timingResult = runPython([script, 'inspect', '--manifest', testCase.manifestFile, '--source-root', testCase.sourceRoot], {
    env: { ...process.env, PATH: `${testCase.bin}${path.delimiter}${process.env.PATH}`, FAKE_PROBE_JSON: testCase.probeFile },
  });
  assert.notEqual(timingResult.status, 0);
  assert.match(timingResult.stderr, /duration changed/);

  const maskCheck = runPython(['-c', [
    'import importlib.util, sys',
    'sys.dont_write_bytecode=True',
    `spec=importlib.util.spec_from_file_location("prep", ${JSON.stringify(script)})`,
    'module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)',
    'module.assert_binary_mask_values([0, 255, 0])',
    'try: module.assert_binary_mask_values([0, 254])',
    'except module.PreparationError: pass',
    'else: sys.exit("non-binary matte passed")',
  ].join('\n')]);
  assert.equal(maskCheck.status, 0, maskCheck.stderr || maskCheck.stdout);
});
