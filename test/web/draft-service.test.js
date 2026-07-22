import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import FormData from 'form-data';
import { DraftService, registerDraftRoutes } from '../../src/web/draft-service.js';

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

  for (const [slot, value] of [['person', 'person bytes'], ['garment', 'garment bytes']]) {
    const data = new FormData();
    data.append('file', Buffer.from(value), { filename: `${slot}.jpg`, contentType: 'image/jpeg' });
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
  assert.equal(received.person.buffer.toString(), 'person bytes');
  assert.equal(received.garments[0].buffer.toString(), 'garment bytes');
  assert.equal(received.outfitText, 'black tailored look');
  assert.equal(received.generateScene, false);
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
