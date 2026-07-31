import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { sha256 } from '../../src/web/scene-contract.js';
import {
  VideoReferenceRegistryError,
  createFashionVideoReferenceResolver,
} from '../../src/web/video-reference-registry.js';

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-video-ref-'));
  try {
    const referenceBytes = Buffer.from('verified-motion-reference');
    const referencePath = path.join(root, 'motion.mp4');
    const previewBytes = Buffer.from('verified-preview');
    const previewPath = path.join(root, 'preview.jpg');
    const playbackBytes = Buffer.from('verified-ui-playback');
    const playbackPath = path.join(root, 'playback.mp4');
    const manifestPath = path.join(root, 'manifest.json');
    await writeFile(referencePath, referenceBytes);
    await writeFile(previewPath, previewBytes);
    await writeFile(playbackPath, playbackBytes);
    await writeFile(manifestPath, JSON.stringify({
      schema_version: '1.0.0',
      pack_id: 'fashion.test.v1',
      references: [{
        id: 'walk',
        ui_title_uk: 'Рух',
        filename: 'motion.mp4',
        playback_filename: 'playback.mp4',
        playback_sha256: sha256(playbackBytes),
        playback_bytes: playbackBytes.length,
        preview_filename: 'preview.jpg',
        preview_sha256: sha256(previewBytes),
        preview_bytes: previewBytes.length,
        sha256: sha256(referenceBytes),
        bytes: referenceBytes.length,
        duration_seconds: 13.24,
        width: 1080,
        height: 1920,
        fps: 25,
        default_motion_mode: 'walk_stride',
        motion_modes: ['walk_stride'],
        cut_sheet: {
          schema_version: '1.0.0',
          cuts: [{
            cut_index: 0, start_ms: 0, end_ms: 13240,
            subject_rule: 'APPROVED_AVATAR_OR_EMPTY',
            direction: 'Reconstruct the verified motion interval with the approved avatar only or an empty environment.',
          }],
        },
      }],
    }));
    await run({
      root,
      referencePath,
      playbackPath,
      manifestPath,
      referenceBytes,
      playbackBytes,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('resolver selects and verifies the hash-bound motion reference and UI playback', async () => {
  await fixture(async ({
    root,
    referencePath,
    playbackPath,
    manifestPath,
    referenceBytes,
    playbackBytes,
  }) => {
    const resolve = createFashionVideoReferenceResolver({
      rootDirectory: root,
      manifestPath,
    });
    const result = await resolve({ motionMode: 'walk_stride' });
    assert.equal(result.state, 'READY');
    assert.equal(result.reference_path, await realpath(referencePath));
    assert.equal(result.reference_sha256, sha256(referenceBytes));
    assert.equal(result.available_styles[0].title, 'Рух');
    assert.equal(result.playback_path, await realpath(playbackPath));
    assert.equal(result.available_styles[0].playback_sha256, sha256(playbackBytes));
    assert.match(result.reference_pack_sha256, /^[a-f0-9]{64}$/);
    assert.equal(result.duration_seconds, 13.24);
    assert.equal(result.provider_duration_seconds, 13);
    assert.equal(result.cut_sheet.cuts.length, 1);
    assert.match(result.cut_sheet_sha256, /^[a-f0-9]{64}$/);
  });
});

test('resolver refuses a playback derivative changed after approval', async () => {
  await fixture(async ({ root, playbackPath, manifestPath }) => {
    await writeFile(playbackPath, 'tampered-ui-playback');
    const resolve = createFashionVideoReferenceResolver({
      rootDirectory: root,
      manifestPath,
    });
    await assert.rejects(
      () => resolve({ motionMode: 'walk_stride' }),
      (error) => error instanceof VideoReferenceRegistryError,
    );
  });
});

test('resolver refuses a reference changed after approval', async () => {
  await fixture(async ({ root, referencePath, manifestPath }) => {
    await writeFile(referencePath, 'tampered-motion-reference');
    const resolve = createFashionVideoReferenceResolver({
      rootDirectory: root,
      manifestPath,
    });
    await assert.rejects(
      () => resolve({ motionMode: 'walk_stride' }),
      (error) => error instanceof VideoReferenceRegistryError,
    );
  });
});

test('resolver stays unavailable when no runtime reference root is configured', async () => {
  const resolve = createFashionVideoReferenceResolver({
    rootDirectory: null,
    manifestPath: '/not/read/without/root.json',
  });
  assert.equal(await resolve({ motionMode: 'walk_stride' }), null);
});

test('product reference pack gives every motion mode one deterministic authority', async () => {
  const manifest = JSON.parse(await readFile(
    new URL('../../config/video-reference-packs/fashion-cool-style-v1.json', import.meta.url),
    'utf8',
  ));
  const expected = {
    editorial_micro_moment: 'editorial-detail',
    walk_stride: 'walk-camera-energy',
    garment_gesture: 'walk-camera-energy',
    camera_drift: 'hard-sun-pose',
  };
  for (const [motionMode, referenceId] of Object.entries(expected)) {
    const matches = manifest.references.filter((reference) => reference.motion_modes.includes(motionMode));
    assert.deepEqual(matches.map((reference) => reference.id), [referenceId]);
  }
});
