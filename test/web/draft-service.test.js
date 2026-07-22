import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import FormData from 'form-data';
import { DraftService, registerDraftRoutes } from '../../src/web/draft-service.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-drafts-'));
  const service = new DraftService({ rootDirectory: root });
  await service.initialize();
  const app = Fastify();
  await app.register(multipart);
  await registerDraftRoutes(app, { service, secureCookie: false });
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
