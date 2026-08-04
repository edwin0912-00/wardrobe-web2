import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import FormData from 'form-data';
import sharp from 'sharp';
import { createWebApp } from '../../src/web/app.js';
import { InputNeedsInputError } from '../../src/web/run-service.js';

test('web API accepts a new multipart user flow without job JSON editing', async () => {
  let received;
  const service = {
    createRun: async (input) => { received = input; return { run_id: 'fresh-run', status: 'QUEUED', phase: 'UPLOADED' }; },
    getRun: async () => null, subscribe: () => () => {}, outputFile: async () => null,
    retry: async () => null, selectGarments: async () => null, garmentSourceFile: async () => null, deleteRun: async () => {},
  };
  const app = await createWebApp({ service });
  const image = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const form = new FormData();
  form.append('person_photo', image, { filename: 'person.png', contentType: 'image/png' });
  form.append('identity_detail', image, { filename: 'identity.png', contentType: 'image/png' });
  form.append('garment_images', image, { filename: 'look.png', contentType: 'image/png' });
  form.append('outfit_text', 'keep every reference item');
  form.append('generate_scene', 'false');
  form.append('consent', 'true');
  const response = await app.inject({ method: 'POST', url: '/api/runs', headers: form.getHeaders(), payload: form.getBuffer() });
  assert.equal(response.statusCode, 202);
  assert.equal(response.json().run_id, 'fresh-run');
  assert.equal(received.garments.length, 1);
  assert.equal(received.identityDetail.filename, 'identity.png');
  assert.deepEqual(received.identityDetail.buffer, image);
  assert.equal(received.outfitText, 'keep every reference item');
  assert.equal(received.generateScene, false);
  await app.close();
});

test('web API exposes invalid input as structured NEEDS_INPUT', async () => {
  let calls = 0;
  const service = {
    createRun: async () => {
      calls += 1;
      throw new InputNeedsInputError(
        'IMAGE_DECODE_FAILED',
        'Фото людини is not a decodable image',
        {
          field: 'Фото людини',
          requirements: ['valid, non-corrupt image bytes'],
        },
      );
    },
    getRun: async () => null,
    subscribe: () => () => {},
    outputFile: async () => null,
    retry: async () => null,
    selectGarments: async () => null,
    garmentSourceFile: async () => null,
    deleteRun: async () => {},
  };
  const app = await createWebApp({ service });
  const form = new FormData();
  form.append('person_photo', Buffer.from('not-an-image'), {
    filename: 'person.png',
    contentType: 'image/png',
  });
  form.append('outfit_text', 'black top');
  form.append('consent', 'true');

  const response = await app.inject({
    method: 'POST',
    url: '/api/runs',
    headers: form.getHeaders(),
    payload: form.getBuffer(),
  });
  assert.equal(calls, 1);
  assert.equal(response.statusCode, 422);
  assert.deepEqual(response.json(), {
    error: 'Фото людини is not a decodable image',
    status: 'NEEDS_INPUT',
    code: 'IMAGE_DECODE_FAILED',
    field: 'Фото людини',
    requirements: ['valid, non-corrupt image bytes'],
    next_action: 'REPLACE_INPUT',
  });
  await app.close();
});

test('web API preserves safe provider failure codes and actions without forwarding unstructured detail', async () => {
  const service = {
    createRun: async () => {
      const error = new Error('The provider rejected this immutable input after a private preflight detail');
      error.code = 'PROVIDER_INPUT_MEDIA_IP_CHECK_PENDING';
      error.failureCode = 'PROVIDER_INPUT_MEDIA_IP_CHECK_PENDING';
      error.nextAction = 'WAIT';
      error.nextActionReasonCode = 'VIDEO_PROVIDER_JOB_IN_PROGRESS';
      error.statusCode = 503;
      throw error;
    },
    getRun: async () => null,
    subscribe: () => () => {},
    outputFile: async () => null,
    retry: async () => null,
    selectGarments: async () => null,
    garmentSourceFile: async () => null,
    deleteRun: async () => {},
  };
  const app = await createWebApp({ service });
  const image = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const form = new FormData();
  form.append('person_photo', image, { filename: 'person.png', contentType: 'image/png' });
  form.append('outfit_text', 'black top');
  form.append('consent', 'true');
  const response = await app.inject({
    method: 'POST', url: '/api/runs', headers: form.getHeaders(), payload: form.getBuffer(),
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    error: 'Вхідне медіа ще проходить перевірку. Запуск не почався.',
    code: 'PROVIDER_INPUT_MEDIA_IP_CHECK_PENDING',
    failure_code: 'PROVIDER_INPUT_MEDIA_IP_CHECK_PENDING',
    next_action: 'WAIT',
    next_action_reason_code: 'VIDEO_PROVIDER_JOB_IN_PROGRESS',
  });
  await app.close();
});

test('web API requires consent before transmitting personal images', async () => {
  const service = { createRun: async () => { throw new Error('must not run'); }, getRun: async () => null, subscribe: () => () => {}, outputFile: async () => null, retry: async () => null, selectGarments: async () => null, garmentSourceFile: async () => null, deleteRun: async () => {} };
  const app = await createWebApp({ service });
  const image = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const form = new FormData();
  form.append('person_photo', image, { filename: 'person.png', contentType: 'image/png' });
  form.append('outfit_text', 'black top');
  const response = await app.inject({ method: 'POST', url: '/api/runs', headers: form.getHeaders(), payload: form.getBuffer() });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /Consent/);
  await app.close();
});

test('web API keeps the optional editorial still disabled unless explicitly requested', async () => {
  let received;
  const service = {
    createRun: async (input) => { received = input; return { run_id: 'core-only', status: 'QUEUED', phase: 'UPLOADED' }; },
    getRun: async () => null, subscribe: () => () => {}, outputFile: async () => null,
    retry: async () => null, selectGarments: async () => null, garmentSourceFile: async () => null, deleteRun: async () => {},
  };
  const app = await createWebApp({ service });
  const image = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const form = new FormData();
  form.append('person_photo', image, { filename: 'person.png', contentType: 'image/png' });
  form.append('outfit_text', 'black top');
  form.append('consent', 'true');
  const response = await app.inject({ method: 'POST', url: '/api/runs', headers: form.getHeaders(), payload: form.getBuffer() });
  assert.equal(response.statusCode, 202);
  assert.equal(received.generateScene, false);
  await app.close();
});

test('garment picker receives a bounded WebP preview, never the original source PNG', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'wardrobe-preview-'));
  const sourcePath = path.join(directory, 'garment.png');
  try {
    const source = await sharp({
      create: { width: 1200, height: 1800, channels: 3, background: '#dde6ef' },
    }).png({ compressionLevel: 0 }).toBuffer();
    await writeFile(sourcePath, source);
    const service = {
      createRun: async () => null,
      getRun: async () => null,
      subscribe: () => () => {},
      outputFile: async () => null,
      retry: async () => null,
      selectGarments: async () => null,
      garmentSourceFile: async () => sourcePath,
      deleteRun: async () => {},
    };
    const app = await createWebApp({ service });
    const response = await app.inject({ method: 'GET', url: '/api/runs/test-run/garments/0?preview=1' });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['content-type'], 'image/webp');
    assert.ok(response.rawPayload.length < source.length);
    const metadata = await sharp(response.rawPayload).metadata();
    assert.ok(metadata.width <= 480);
    assert.ok(metadata.height <= 480);
    await app.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
