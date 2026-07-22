import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import FormData from 'form-data';
import sharp from 'sharp';
import { DraftService, registerDraftRoutes } from '../../src/web/draft-service.js';

async function image(width = 320, height = 320, background = '#49637a') {
  return sharp({ create: { width, height, channels: 3, background } }).jpeg({ quality: 90 }).toBuffer();
}

async function fixture(runService = null) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-drafts-'));
  const service = new DraftService({ rootDirectory: root });
  await service.initialize();
  const app = Fastify();
  await app.register(multipart);
  await registerDraftRoutes(app, { service, runService, secureCookie: false });
  return { app, root, service };
}

test('anonymous browser draft survives requests and uses a 15-minute cookie', async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const first = await app.inject({ method: 'GET', url: '/api/draft' });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().generate_scene, false);
  assert.match(first.headers['set-cookie'], /Max-Age=900/);
  const cookie = first.headers['set-cookie'].split(';')[0];
  const data = new FormData();
  data.append('file', Buffer.from('jpeg fixture'), { filename: 'phone.jpg', contentType: 'image/jpeg' });
  const upload = await app.inject({ method: 'POST', url: '/api/draft/file/person', headers: { ...data.getHeaders(), cookie }, payload: data });
  assert.equal(upload.statusCode, 201, upload.body);
  const manifest = await app.inject({ method: 'GET', url: '/api/draft', headers: { cookie } });
  assert.equal(manifest.json().person.size, 12);
  const restored = await app.inject({ method: 'GET', url: manifest.json().person.url, headers: { cookie } });
  assert.equal(restored.body, 'jpeg fixture');
});

test('creates a run from server-side draft files without uploading them again', async (t) => {
  let received;
  const runService = {
    async createRun(input) {
      received = input;
      return { run_id: 'run-from-draft', status: 'QUEUED', phase: 'UPLOADED' };
    },
  };
  const { app } = await fixture(runService);
  t.after(() => app.close());
  const first = await app.inject({ method: 'GET', url: '/api/draft' });
  const cookie = first.headers['set-cookie'].split(';')[0];

  const personBytes = await image(320, 400, '#294761');
  const garmentBytes = await image(400, 320, '#754329');
  for (const [slot, value] of [['person', personBytes], ['garment', garmentBytes]]) {
    const data = new FormData();
    data.append('file', value, { filename: `${slot}.jpg`, contentType: 'image/jpeg' });
    const response = await app.inject({ method: 'POST', url: `/api/draft/file/${slot}`, headers: { ...data.getHeaders(), cookie }, payload: data });
    assert.equal(response.statusCode, 201, response.body);
  }
  const metadata = await app.inject({
    method: 'PUT', url: '/api/draft/meta', headers: { cookie, 'content-type': 'application/json' },
    payload: { outfit_text: 'black tailored look', generate_scene: false },
  });
  assert.equal(metadata.statusCode, 200);

  const created = await app.inject({
    method: 'POST', url: '/api/draft/run', headers: { cookie, 'content-type': 'application/json' }, payload: { consent: true },
  });
  assert.equal(created.statusCode, 202, created.body);
  assert.equal(created.json().run_id, 'run-from-draft');
  assert.deepEqual(received.person.buffer, personBytes);
  assert.deepEqual(received.garments[0].buffer, garmentBytes);
  assert.equal(received.person.preparation.method, 'UNCHANGED');
  assert.equal(received.garments[0].preparation.method, 'UNCHANGED');
  assert.equal(received.outfitText, 'black tailored look');
  assert.equal(received.generateScene, false);
  assert.equal(Object.hasOwn(received, 'runId'), false);
});

test('forwards a validated finalization key as the deterministic run id', async (t) => {
  const received = [];
  const runService = {
    async createRun(input) {
      received.push(input);
      return { run_id: input.runId, status: 'QUEUED', phase: 'UPLOADED' };
    },
  };
  const { app } = await fixture(runService);
  t.after(() => app.close());
  const first = await app.inject({ method: 'GET', url: '/api/draft' });
  const cookie = first.headers['set-cookie'].split(';')[0];
  const data = new FormData();
  data.append('file', await image(), { filename: 'person.jpg', contentType: 'image/jpeg' });
  const upload = await app.inject({ method: 'POST', url: '/api/draft/file/person', headers: { ...data.getHeaders(), cookie }, payload: data });
  assert.equal(upload.statusCode, 201, upload.body);

  const finalizationKey = '20cf6522-43fd-40ad-a8db-615bcdf80e07';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const created = await app.inject({
      method: 'POST', url: '/api/draft/run', headers: { cookie, 'content-type': 'application/json' },
      payload: { consent: true, finalization_key: finalizationKey },
    });
    assert.equal(created.statusCode, 202, created.body);
    assert.equal(created.json().run_id, finalizationKey);
  }
  assert.equal(received.length, 2);
  assert.deepEqual(received.map((input) => input.runId), [finalizationKey, finalizationKey]);
});

test('finalization prepares a weak decodable draft image for the immutable run without changing draft bytes', async (t) => {
  let received;
  const runService = {
    async createRun(input) {
      received = input;
      return { run_id: input.runId, status: 'QUEUED', phase: 'UPLOADED' };
    },
  };
  const { app } = await fixture(runService);
  t.after(() => app.close());
  const first = await app.inject({ method: 'GET', url: '/api/draft' });
  const cookie = first.headers['set-cookie'].split(';')[0];
  const personBytes = await image(320, 400, '#315b79');
  const weakGarmentBytes = await image(197, 256, '#80582c');

  for (const [slot, bytes] of [['person', personBytes], ['garment', weakGarmentBytes]]) {
    const data = new FormData();
    data.append('file', bytes, { filename: `${slot}.jpg`, contentType: 'image/jpeg' });
    const uploaded = await app.inject({
      method: 'POST', url: `/api/draft/file/${slot}`, headers: { ...data.getHeaders(), cookie }, payload: data,
    });
    assert.equal(uploaded.statusCode, 201, uploaded.body);
  }
  const manifestBefore = await app.inject({ method: 'GET', url: '/api/draft', headers: { cookie } });
  const rawGarmentUrl = manifestBefore.json().garments[0].url;
  const created = await app.inject({
    method: 'POST', url: '/api/draft/run', headers: { cookie, 'content-type': 'application/json' },
    payload: { consent: true, finalization_key: '20cf6522-43fd-40ad-a8db-615bcdf80e07' },
  });
  assert.equal(created.statusCode, 202, created.body);

  const runMetadata = await sharp(received.garments[0].buffer).metadata();
  assert.equal(runMetadata.width, 256);
  assert.equal(runMetadata.height, 333);
  assert.equal(received.garments[0].mimetype, 'image/png');
  assert.equal(received.garments[0].preparation.method, 'DETERMINISTIC_LANCZOS3_UPSCALE');
  assert.equal(received.garments[0].preparation.semantic_generation, false);
  assert.equal(received.garments[0].preparation.maximum_upscale_factor, 4);

  const rawAfter = await app.inject({ method: 'GET', url: rawGarmentUrl, headers: { cookie } });
  assert.equal(rawAfter.statusCode, 200, rawAfter.body);
  assert.deepEqual(rawAfter.rawPayload, weakGarmentBytes, 'server draft must preserve original source bytes');
});

test('finalization rejects an image beyond the bounded upscale policy and preserves the draft', async (t) => {
  let createCalls = 0;
  const { app } = await fixture({ async createRun() { createCalls += 1; } });
  t.after(() => app.close());
  const first = await app.inject({ method: 'GET', url: '/api/draft' });
  const cookie = first.headers['set-cookie'].split(';')[0];
  const personBytes = await image(320, 400);
  const unusableBytes = await image(48, 48);
  let garmentUrl;
  for (const [slot, bytes] of [['person', personBytes], ['garment', unusableBytes]]) {
    const data = new FormData();
    data.append('file', bytes, { filename: `${slot}.jpg`, contentType: 'image/jpeg' });
    const uploaded = await app.inject({
      method: 'POST', url: `/api/draft/file/${slot}`, headers: { ...data.getHeaders(), cookie }, payload: data,
    });
    assert.equal(uploaded.statusCode, 201, uploaded.body);
    if (slot === 'garment') garmentUrl = `/api/draft/file/garment/${uploaded.json().id}`;
  }
  const created = await app.inject({
    method: 'POST', url: '/api/draft/run', headers: { cookie, 'content-type': 'application/json' },
    payload: { consent: true },
  });
  assert.equal(created.statusCode, 422, created.body);
  assert.match(created.body, /maximum upscale is 4/);
  assert.equal(createCalls, 0);
  const rawAfter = await app.inject({ method: 'GET', url: garmentUrl, headers: { cookie } });
  assert.deepEqual(rawAfter.rawPayload, unusableBytes);
});

test('rejects malformed finalization keys before creating a run', async (t) => {
  let createCalls = 0;
  const { app } = await fixture({ async createRun() { createCalls += 1; } });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST', url: '/api/draft/run', headers: { 'content-type': 'application/json' },
    payload: { consent: true, finalization_key: '../../same-run' },
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /valid UUID v4/);
  assert.equal(createCalls, 0);
});

test('expired anonymous drafts are physically removed', async () => {
  const { root, service } = await fixture();
  const sessionId = '20cf6522-43fd-40ad-a8db-615bcdf80e07';
  await service.updateMetadata(sessionId, { outfit_text: 'temporary', generate_scene: true });
  const filename = path.join(root, sessionId, 'draft.json');
  const manifest = JSON.parse(await readFile(filename, 'utf8'));
  manifest.updated_at = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  await writeFile(filename, JSON.stringify(manifest));
  assert.equal(await service.cleanupExpired(), 1);
  await assert.rejects(readFile(filename, 'utf8'), { code: 'ENOENT' });
});
