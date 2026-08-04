import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { MockProvider } from '../../src/providers/mock-provider.js';
import { PipelineRunner } from '../../src/runner/pipeline-runner.js';
import { STATES } from '../../src/runner/state-machine.js';

const WIDTH = 7;
const HEIGHT = 7;
const BACKGROUND = [250, 249, 248];
const SUBJECT = [40, 50, 60];

function offset(x, y) {
  return (y * WIDTH + x) * 3;
}

function pixel(data, x, y) {
  return [...data.subarray(offset(x, y), offset(x, y) + 3)];
}

async function offWhiteFixturePng() {
  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let index = 0; index < WIDTH * HEIGHT; index += 1) rgb.set(BACKGROUND, index * 3);
  for (let y = 2; y <= 4; y += 1) {
    for (let x = 2; x <= 4; x += 1) {
      if (x !== 3 || y !== 3) rgb.set(SUBJECT, offset(x, y));
    }
  }
  return sharp(rgb, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .toColourspace('srgb')
    .png()
    .toBuffer();
}

async function runnerFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zeely-runner-white-'));
  await mkdir(path.join(directory, 'input'));
  await writeFile(path.join(directory, 'input', 'person.jpg'), Buffer.from('identity-source'));
  await writeFile(path.join(directory, 'avatar.txt'), 'avatar={{IDENTITY_REFERENCE}}\n');
  await writeFile(
    path.join(directory, 'outfit.txt'),
    'identity={{ORIGINAL_IDENTITY_REFERENCE}} avatar={{APPROVED_AVATAR_REFERENCE}} outfit={{OUTFIT_TEXT}}\n',
  );
  const jobPath = path.join(directory, 'job.json');
  await writeFile(jobPath, `${JSON.stringify({
    job_id: 'white-normalization-001',
    identity_reference: './input/person.jpg',
    output_directory: './output',
    prompts: { avatar: './avatar.txt', outfit: './outfit.txt' },
    outfit: { mode: 'text', text: 'Plain navy crew-neck top' },
    quality_references: [],
  }, null, 2)}\n`);
  return { directory, jobPath, output: path.join(directory, 'output') };
}

async function rawPixels(filename) {
  return sharp(filename, { failOn: 'error' }).toColourspace('srgb').removeAlpha().raw().toBuffer();
}

test('normalizes provider PNG before QA/export while preserving isolated near-white subject pixels', async () => {
  const files = await runnerFixture();
  const provider = new MockProvider({ image: await offWhiteFixturePng() });
  const seenQaPhases = [];
  provider.script.qa = async (context) => {
    if (context.phase === 'avatar' || context.phase === 'outfit') {
      const candidate = await rawPixels(context.evidence.candidate.artifact.path);
      assert.deepEqual(pixel(candidate, 0, 0), [255, 255, 255], 'QA must receive normalized background');
      assert.deepEqual(pixel(candidate, 3, 3), BACKGROUND, 'isolated near-white subject pixel must survive');
      seenQaPhases.push(context.phase);
    }
    return { decision: 'PASS', checks: [], defects: [] };
  };

  const result = await new PipelineRunner({ provider }).runJobFile(files.jobPath);
  assert.equal(result.status, STATES.COMPLETED);
  assert.deepEqual(seenQaPhases, ['avatar', 'outfit']);

  const checkpoint = JSON.parse(await readFile(result.checkpointPath, 'utf8'));
  for (const phase of ['avatar', 'outfit']) {
    const candidate = checkpoint.artifacts[phase];
    assert.notEqual(candidate.provider_original_artifact.digest, candidate.artifact.digest);
    assert.equal(candidate.normalization.wrote_output, true);
    assert.equal(candidate.normalization.stats.changed_pixels, 40);
    assert.equal(candidate.normalization.lineage.parent_sha256, candidate.provider_original_artifact.digest);
    assert.equal(candidate.normalization.lineage.output_sha256, candidate.artifact.digest);
    assert.equal(candidate.normalization.lineage.operation, 'NORMALIZE_BORDER_CONNECTED_NEAR_WHITE_TO_EXACT_WHITE');

    const original = await rawPixels(candidate.provider_original_artifact.path);
    const normalized = await rawPixels(candidate.artifact.path);
    assert.deepEqual(pixel(original, 0, 0), BACKGROUND, 'provider-original artifact remains unchanged');
    assert.deepEqual(pixel(normalized, 0, 0), [255, 255, 255]);
    assert.deepEqual(pixel(normalized, 3, 3), BACKGROUND);
  }

  const avatarOutput = await rawPixels(path.join(files.output, 'avatar.png'));
  const outfitOutput = await rawPixels(path.join(files.output, 'avatar_outfit.png'));
  assert.deepEqual(pixel(avatarOutput, 0, 0), [255, 255, 255]);
  assert.deepEqual(pixel(outfitOutput, 0, 0), [255, 255, 255]);
  assert.deepEqual(pixel(avatarOutput, 3, 3), BACKGROUND);

  const manifest = JSON.parse(await readFile(path.join(files.output, 'run-manifest.json'), 'utf8'));
  assert.equal(
    manifest.image_artifacts.avatar.provider_original.digest,
    checkpoint.artifacts.avatar.provider_original_artifact.digest,
  );
  assert.equal(manifest.image_artifacts.avatar.normalized.digest, checkpoint.artifacts.avatar.artifact.digest);
  assert.equal(manifest.image_artifacts.avatar.normalization.stats.changed_pixels, 40);
  assert.equal(manifest.outputs.avatar.sha256, checkpoint.artifacts.avatar.artifact.digest);
});

test('reuses content-addressed normalization receipts when resuming the same attempt', async () => {
  const files = await runnerFixture();
  const provider = new MockProvider({ image: await offWhiteFixturePng() });
  const runner = new PipelineRunner({ provider });
  const first = await runner.runJobFile(files.jobPath);
  assert.equal(first.status, STATES.COMPLETED);
  const providerCallsAfterFirstRun = provider.calls.length;

  const checkpoint = JSON.parse(await readFile(first.checkpointPath, 'utf8'));
  checkpoint.state = STATES.GENERATING_AVATAR;
  await writeFile(first.checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);

  const second = await runner.runJobFile(files.jobPath);
  assert.equal(second.status, STATES.COMPLETED);
  assert.equal(second.reused, false);
  assert.equal(provider.calls.length, providerCallsAfterFirstRun, 'resume must reuse provider and QA receipts');

  const events = (await readFile(second.eventsPath, 'utf8')).trim().split('\n').map(JSON.parse);
  const normalizationSucceeded = events.filter((event) => event.type === 'NORMALIZATION_SUCCEEDED');
  const normalizationReused = events.filter(
    (event) => event.type === 'RECEIPT_REUSED' && String(event.data.operation).startsWith('normalize:'),
  );
  assert.equal(normalizationSucceeded.length, 2, 'normalization must execute once per selected image');
  assert.deepEqual(
    normalizationReused.map((event) => event.data.operation),
    ['normalize:avatar', 'normalize:outfit'],
  );
  assert.ok(normalizationReused.every((event) => event.data.source_sha256 && event.data.output_sha256));
});
