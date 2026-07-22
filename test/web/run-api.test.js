import assert from 'node:assert/strict';
import test from 'node:test';
import FormData from 'form-data';
import sharp from 'sharp';
import { createWebApp } from '../../src/web/app.js';

test('web API accepts a new multipart user flow without job JSON editing', async () => {
  let received;
  const service = {
    createRun: async (input) => { received = input; return { run_id: 'fresh-run', status: 'QUEUED', phase: 'UPLOADED' }; },
    getRun: async () => null, subscribe: () => () => {}, outputFile: async () => null,
    retry: async () => null, deleteRun: async () => {},
  };
  const app = await createWebApp({ service });
  const image = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const form = new FormData();
  form.append('person_photo', image, { filename: 'person.png', contentType: 'image/png' });
  form.append('garment_images', image, { filename: 'look.png', contentType: 'image/png' });
  form.append('outfit_text', 'keep every reference item');
  form.append('generate_scene', 'false');
  form.append('consent', 'true');
  const response = await app.inject({ method: 'POST', url: '/api/runs', headers: form.getHeaders(), payload: form.getBuffer() });
  assert.equal(response.statusCode, 202);
  assert.equal(response.json().run_id, 'fresh-run');
  assert.equal(received.garments.length, 1);
  assert.equal(received.outfitText, 'keep every reference item');
  assert.equal(received.generateScene, false);
  await app.close();
});

test('web API requires consent before transmitting personal images', async () => {
  const service = { createRun: async () => { throw new Error('must not run'); }, getRun: async () => null, subscribe: () => () => {}, outputFile: async () => null, retry: async () => null, deleteRun: async () => {} };
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
