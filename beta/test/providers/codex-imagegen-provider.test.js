import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test from 'node:test';
import { CodexImagegenProvider } from '../../src/providers/codex-imagegen-provider.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  const workDirectory = await mkdtemp(path.join(os.tmpdir(), 'codex-scene-order-'));
  const image = await sharp({ create: { width: 16, height: 20, channels: 3, background: '#56789a' } }).png().toBuffer();
  const guidePath = path.join(workDirectory, 'guide.png');
  const lookPath = path.join(workDirectory, 'look.png');
  await Promise.all([writeFile(guidePath, image), writeFile(lookPath, image)]);
  const base = {
    phase: 'scene',
    attempt: 1,
    model: 'gpt_image_2',
    job_set_type: 'gpt_image_2',
    prompt: 'Preserve the approved look and follow the mechanical framing guide.',
    idempotencyKey: 'a'.repeat(64),
    jobId: 'scene-test',
    workDirectory,
  };
  const references = [
    { order: 1, scope: 'outfit', role: 'MECHANICAL_FRAMING_GUIDE', path: guidePath, sha256: sha256(image), mediaType: 'image/png', source: 'CONDITIONED' },
    { order: 2, scope: 'avatar', role: 'APPROVED_LOOK_MASTER', path: lookPath, sha256: sha256(image), mediaType: 'image/png', source: 'APPROVED_AVATAR' },
  ];
  return { workDirectory, base, references, cleanup: () => rm(workDirectory, { recursive: true, force: true }) };
}

function worker(onGenerate) {
  return {
    async start() { return { status: 'ready' }; },
    async generate(context) { return onGenerate(context); },
  };
}

test('Codex accepts only the documented mechanical-guide then approved-look scene order', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  let workerContext;
  const provider = new CodexImagegenProvider({
    worker: worker(async (context) => {
      workerContext = context;
      await context.onSubmitted({ threadId: 'thread-1', turnId: 'turn-1' });
      const image = await sharp({ create: { width: 16, height: 20, channels: 3, background: '#123456' } }).png().toBuffer();
      return { image, threadId: 'thread-1', turnId: 'turn-1', itemId: 'image-1' };
    }),
  });

  const result = await provider.generate({ ...f.base, references: { ordered: f.references } });

  assert.equal(workerContext.references.length, 2);
  assert.deepEqual(result.metadata.input_media.map((item) => item.role), [
    'MECHANICAL_FRAMING_GUIDE',
    'APPROVED_LOOK_MASTER',
  ]);
});

test('Codex rejects a framing-guide role with the wrong scope or source before submission', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  let submissions = 0;
  const provider = new CodexImagegenProvider({ worker: worker(async () => { submissions += 1; }) });

  for (const guideOverride of [
    { scope: 'avatar' },
    { source: 'APPROVED_AVATAR' },
  ]) {
    await assert.rejects(
      () => provider.generate({
        ...f.base,
        idempotencyKey: sha256(Buffer.from(JSON.stringify(guideOverride))),
        references: { ordered: [{ ...f.references[0], ...guideOverride }, f.references[1]] },
      }),
      (error) => error.code === 'INVALID_SCENE_REFERENCE_ORDER',
    );
  }
  assert.equal(submissions, 0);
});
