import assert from 'node:assert/strict';
import { access, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { MockProvider } from '../../src/providers/mock-provider.js';
import { InputNeedsInputError, RunService } from '../../src/web/run-service.js';

async function canonical() {
  return sharp({ create: { width: 512, height: 640, channels: 3, background: '#ffffff' } }).composite([{ input: Buffer.from('<svg width="220" height="360"><rect width="220" height="360" rx="30" fill="#275b36"/></svg>'), left: 146, top: 140 }]).png().toBuffer();
}

function dependencies() {
  const vlm = {
    inspectGarments: async () => ({ status: 'READY', reason: 'clear garment', items: [] }),
    evaluateQa: async () => ({ decision: 'PASS', reason: 'all locks match', checks: [{ name: 'FIDELITY', pass: true, evidence: 'same visible garment' }], defects: [] }),
  };
  const assetGenerator = { generateGarment: async () => ({ image: await canonical(), metadata: { provider: 'mock' } }), generateScene: async () => ({ image: await canonical(), metadata: { provider: 'mock' } }) };
  return { provider: new MockProvider(), vlm, assetGenerator };
}

function subject() {
  return sharp({ create: { width: 360, height: 480, channels: 3, background: '#7b4d2e' } });
}

async function service(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const instance = new RunService({ rootDirectory: root, ...dependencies() });
  await instance.initialize();
  return { root, service: instance };
}

test('a WEBP upload is accepted on its bytes when the client declares octet-stream', async () => {
  const { root, service: runs } = await service('zeely-upload-octet-stream-');
  const run = await runs.createRun({
    runId: 'octet-stream-webp',
    person: {
      filename: 'person',
      mimetype: 'application/octet-stream',
      buffer: await subject().webp().toBuffer(),
    },
    outfitText: 'black tailored suit',
    generateScene: false,
  });
  await runs.running.get(run.run_id);
  await access(path.join(root, run.run_id, 'inputs', 'person.webp'));
});

test('a PNG upload mislabelled as WEBP is stored under the extension its bytes carry', async () => {
  const { root, service: runs } = await service('zeely-upload-mislabelled-');
  const run = await runs.createRun({
    runId: 'mislabelled-png',
    person: {
      filename: 'person.webp',
      mimetype: 'image/webp',
      buffer: await subject().png().toBuffer(),
    },
    outfitText: 'black tailored suit',
    generateScene: false,
  });
  await runs.running.get(run.run_id);
  await access(path.join(root, run.run_id, 'inputs', 'person.png'));
});

test('a decodable image outside the three accepted containers is still refused', async () => {
  const { service: runs } = await service('zeely-upload-tiff-');
  const tiff = await subject().tiff().toBuffer();
  await assert.rejects(
    () => runs.createRun({
      runId: 'declared-png-actual-tiff',
      person: {
        filename: 'person.png',
        mimetype: 'image/png',
        buffer: tiff,
      },
      outfitText: 'black tailored suit',
      generateScene: false,
    }),
    (error) => error instanceof InputNeedsInputError
      && error.code === 'UNSUPPORTED_MEDIA_TYPE'
      && error.message === 'Фото людини must be PNG, JPEG, or WEBP',
  );
});
