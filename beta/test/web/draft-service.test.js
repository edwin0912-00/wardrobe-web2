import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import FormData from 'form-data';
import sharp from 'sharp';
import {
  DraftService,
  prepareDraftUploadForRun,
  registerDraftRoutes,
} from '../../src/web/draft-service.js';

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

function fileManifest(manifest) {
  const binding = (item) => item ? {
    id: item.id,
    sha256: item.sha256,
    size: item.size,
    mimetype: item.mimetype,
  } : null;
  return {
    version: 1,
    person: binding(manifest.person),
    identity: binding(manifest.identity),
    garments: manifest.garments.map(binding),
  };
}

async function finalizationPayload(app, cookie, extra = {}) {
  const response = await app.inject({ method: 'GET', url: '/api/draft', headers: cookie ? { cookie } : {} });
  assert.equal(response.statusCode, 200, response.body);
  return { consent: true, file_manifest: fileManifest(response.json()), ...extra };
}

test('draft preparation reports unusable bytes as structured NEEDS_INPUT', async () => {
  await assert.rejects(
    prepareDraftUploadForRun({
      filename: 'broken.png',
      mimetype: 'image/png',
      buffer: Buffer.from('not-an-image'),
    }, { field: 'Фото людини' }),
    (error) => {
      assert.equal(error.name, 'InputNeedsInputError');
      assert.equal(error.statusCode, 422);
      assert.equal(error.status, 'NEEDS_INPUT');
      assert.equal(error.code, 'IMAGE_DECODE_FAILED');
      assert.equal(error.field, 'Фото людини');
      assert.deepEqual(error.requirements, ['valid, non-corrupt image bytes']);
      assert.equal(error.nextAction, 'REPLACE_INPUT');
      return true;
    },
  );
});

test('anonymous browser draft survives requests and uses a 15-minute cookie', async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const first = await app.inject({ method: 'GET', url: '/api/draft' });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().draft_mode, 'NEW_AVATAR');
  assert.equal(first.json().generate_scene, false);
  assert.match(first.headers['set-cookie'], /Max-Age=900/);
  const cookie = first.headers['set-cookie'].split(';')[0];
  const data = new FormData();
  data.append('file', Buffer.from('jpeg fixture'), { filename: 'phone.jpg', contentType: 'image/jpeg' });
  const upload = await app.inject({ method: 'POST', url: '/api/draft/file/person', headers: { ...data.getHeaders(), cookie }, payload: data });
  assert.equal(upload.statusCode, 201, upload.body);
  assert.match(upload.json().sha256, /^[0-9a-f]{64}$/);
  const manifest = await app.inject({ method: 'GET', url: '/api/draft', headers: { cookie } });
  assert.equal(manifest.json().person.size, 12);
  assert.equal(manifest.json().person.sha256, upload.json().sha256);
  const restored = await app.inject({ method: 'GET', url: manifest.json().person.url, headers: { cookie } });
  assert.equal(restored.body, 'jpeg fixture');
});

test('ADD_ITEMS draft intent persists and its source avatar is immutable until explicit deletion', async (t) => {
  const { app, service } = await fixture();
  t.after(() => app.close());
  const sessionId = '20cf6522-43fd-40ad-a8db-615bcdf80e07';
  const sourceAvatarId = '7df0e252-7045-4721-9b95-7bb4935fe79d';
  const otherAvatarId = '41cf6522-43fd-40ad-a8db-615bcdf80e07';

  const bound = await service.updateMetadata(sessionId, {
    outfit_text: 'saved avatar continuation',
    source_avatar_id: sourceAvatarId,
    source_look_id: null,
  });
  assert.equal(bound.version, 4);
  assert.equal(bound.draft_mode, 'ADD_ITEMS');
  assert.equal(bound.source_avatar_id, sourceAvatarId);

  for (const metadata of [
    { source_avatar_id: null },
    { source_avatar_id: otherAvatarId },
    { draft_mode: 'NEW_AVATAR', source_avatar_id: null },
  ]) {
    await assert.rejects(
      service.updateMetadata(sessionId, metadata),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.match(error.code, /^DRAFT_(SOURCE|MODE)_IMMUTABLE$/);
        return true;
      },
    );
  }

  const persisted = await service.read(sessionId);
  assert.equal(persisted.draft_mode, 'ADD_ITEMS');
  assert.equal(persisted.source_avatar_id, sourceAvatarId);

  await service.clear(sessionId);
  const reset = await service.read(sessionId);
  assert.equal(reset.draft_mode, 'NEW_AVATAR');
  assert.equal(reset.source_avatar_id, null);
});

test('public ADD_ITEMS draft descriptor exposes v4 intent and SHA-bound files to the browser client', async (t) => {
  const { app, service } = await fixture();
  t.after(() => app.close());
  const sessionId = '20cf6522-43fd-40ad-a8db-615bcdf80e07';
  const sourceAvatarId = '7df0e252-7045-4721-9b95-7bb4935fe79d';
  const bytes = Buffer.from('sha-bound saved-avatar item fixture');

  await service.updateMetadata(sessionId, {
    draft_mode: 'ADD_ITEMS',
    source_avatar_id: sourceAvatarId,
    source_look_id: null,
  });
  const saved = await service.saveFile(sessionId, 'garment', {
    mimetype: 'image/jpeg',
    buffer: bytes,
  });
  const response = await app.inject({
    method: 'GET',
    url: '/api/draft',
    headers: { cookie: `zeely_draft_session=${sessionId}` },
  });
  assert.equal(response.statusCode, 200, response.body);

  const descriptor = response.json();
  assert.equal(descriptor.version, 4);
  assert.equal(descriptor.draft_mode, 'ADD_ITEMS');
  assert.equal(descriptor.source_avatar_id, sourceAvatarId);
  assert.equal(descriptor.garments.length, 1);
  assert.deepEqual(
    {
      id: descriptor.garments[0].id,
      sha256: descriptor.garments[0].sha256,
      size: descriptor.garments[0].size,
      mimetype: descriptor.garments[0].mimetype,
    },
    {
      id: saved.id,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      mimetype: 'image/jpeg',
    },
  );
});

test('concurrent saved-avatar bindings cannot race an ADD_ITEMS draft onto a second avatar', async (t) => {
  const { app, service } = await fixture();
  t.after(() => app.close());
  const sessionId = '20cf6522-43fd-40ad-a8db-615bcdf80e07';
  const candidates = [
    '7df0e252-7045-4721-9b95-7bb4935fe79d',
    '41cf6522-43fd-40ad-a8db-615bcdf80e07',
  ];

  const results = await Promise.allSettled(candidates.map((sourceAvatarId) => (
    service.updateMetadata(sessionId, {
      draft_mode: 'ADD_ITEMS',
      source_avatar_id: sourceAvatarId,
    })
  )));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'DRAFT_SOURCE_IMMUTABLE');

  const persisted = await service.read(sessionId);
  assert.equal(persisted.draft_mode, 'ADD_ITEMS');
  assert.ok(candidates.includes(persisted.source_avatar_id));
});

test('one session mutation queue preserves concurrent uploads and metadata updates', async (t) => {
  const { app, service } = await fixture();
  t.after(() => app.close());
  const sessionId = '20cf6522-43fd-40ad-a8db-615bcdf80e07';
  const firstBytes = Buffer.from('first concurrent item');
  const secondBytes = Buffer.from('second concurrent item');

  const [first, second] = await Promise.all([
    service.saveFile(sessionId, 'garment', {
      mimetype: 'image/jpeg',
      buffer: firstBytes,
    }),
    service.saveFile(sessionId, 'garment', {
      mimetype: 'image/jpeg',
      buffer: secondBytes,
    }),
    service.updateMetadata(sessionId, {
      outfit_text: 'concurrent metadata survives',
    }),
  ]);

  const persisted = await service.read(sessionId);
  assert.equal(persisted.outfit_text, 'concurrent metadata survives');
  assert.deepEqual(
    persisted.garments.map((item) => item.id),
    [first.id, second.id],
  );
  assert.deepEqual(
    persisted.garments.map((item) => item.sha256),
    [firstBytes, secondBytes].map((bytes) => createHash('sha256').update(bytes).digest('hex')),
  );
});

test('concurrent remove and replacement cannot resurrect the removed draft file', async (t) => {
  const { app, service } = await fixture();
  t.after(() => app.close());
  const sessionId = '20cf6522-43fd-40ad-a8db-615bcdf80e07';
  const old = await service.saveFile(sessionId, 'garment', {
    mimetype: 'image/jpeg',
    buffer: Buffer.from('old item'),
  });

  const [removed, replacement] = await Promise.all([
    service.removeFile(sessionId, 'garment', old.id),
    service.saveFile(sessionId, 'garment', {
      mimetype: 'image/jpeg',
      buffer: Buffer.from('replacement item'),
    }),
  ]);

  assert.equal(removed, true);
  const persisted = await service.read(sessionId);
  assert.deepEqual(persisted.garments.map((item) => item.id), [replacement.id]);
  assert.equal(await service.file(sessionId, 'garment', old.id), null);
  assert.equal((await service.file(sessionId, 'garment', replacement.id)).descriptor.id, replacement.id);
});

test('legacy draft with a saved source is inferred as ADD_ITEMS and cannot be downgraded', async (t) => {
  const { app, service } = await fixture();
  t.after(() => app.close());
  const sessionId = '20cf6522-43fd-40ad-a8db-615bcdf80e07';
  const sourceAvatarId = '7df0e252-7045-4721-9b95-7bb4935fe79d';
  await service.updateMetadata(sessionId, { source_avatar_id: sourceAvatarId });
  const filename = service.manifestPath(sessionId);
  const legacy = JSON.parse(await readFile(filename, 'utf8'));
  delete legacy.draft_mode;
  legacy.version = 3;
  await writeFile(filename, JSON.stringify(legacy));

  const restored = await service.read(sessionId);
  assert.equal(restored.draft_mode, 'ADD_ITEMS');
  assert.equal(restored.source_avatar_id, sourceAvatarId);
  await assert.rejects(
    service.updateMetadata(sessionId, { source_avatar_id: null }),
    (error) => error.code === 'DRAFT_SOURCE_IMMUTABLE',
  );
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
    method: 'POST',
    url: '/api/draft/run',
    headers: { cookie, 'content-type': 'application/json' },
    payload: await finalizationPayload(app, cookie),
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
      payload: await finalizationPayload(app, cookie, { finalization_key: finalizationKey }),
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
    payload: await finalizationPayload(app, cookie, {
      finalization_key: '20cf6522-43fd-40ad-a8db-615bcdf80e07',
    }),
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
    payload: await finalizationPayload(app, cookie),
  });
  assert.equal(created.statusCode, 422, created.body);
  assert.match(created.body, /maximum upscale is 4/);
  assert.equal(createCalls, 0);
  const rawAfter = await app.inject({ method: 'GET', url: garmentUrl, headers: { cookie } });
  assert.deepEqual(rawAfter.rawPayload, unusableBytes);
});

test('finalization rejects a same-count server draft with different file identity', async (t) => {
  let createCalls = 0;
  const { app } = await fixture({ async createRun() { createCalls += 1; } });
  t.after(() => app.close());
  const first = await app.inject({ method: 'GET', url: '/api/draft' });
  const cookie = first.headers['set-cookie'].split(';')[0];

  const uploadGarment = async (background) => {
    const data = new FormData();
    data.append('file', await image(320, 320, background), { filename: 'item.jpg', contentType: 'image/jpeg' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/draft/file/garment',
      headers: { ...data.getHeaders(), cookie },
      payload: data,
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };

  const oldFile = await uploadGarment('#111111');
  const staleBrowserPayload = await finalizationPayload(app, cookie);
  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/draft/file/garment/${oldFile.id}`,
    headers: { cookie },
  });
  assert.equal(removed.statusCode, 204, removed.body);
  const replacement = await uploadGarment('#eeeeee');
  assert.notEqual(replacement.sha256, oldFile.sha256);

  const created = await app.inject({
    method: 'POST',
    url: '/api/draft/run',
    headers: { cookie, 'content-type': 'application/json' },
    payload: staleBrowserPayload,
  });
  assert.equal(created.statusCode, 409, created.body);
  assert.equal(created.json().code, 'DRAFT_FILE_MANIFEST_MISMATCH');
  assert.equal(createCalls, 0);
});

test('finalization verifies stored bytes against the server descriptor digest', async (t) => {
  let createCalls = 0;
  const { app, service } = await fixture({ async createRun() { createCalls += 1; } });
  t.after(() => app.close());
  const first = await app.inject({ method: 'GET', url: '/api/draft' });
  const cookie = first.headers['set-cookie'].split(';')[0];
  const sessionId = cookie.split('=')[1];
  const data = new FormData();
  data.append('file', await image(), { filename: 'person.jpg', contentType: 'image/jpeg' });
  const uploaded = await app.inject({
    method: 'POST',
    url: '/api/draft/file/person',
    headers: { ...data.getHeaders(), cookie },
    payload: data,
  });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const payload = await finalizationPayload(app, cookie);
  const stored = await service.read(sessionId);
  await writeFile(path.join(service.directory(sessionId), stored.person.filename), Buffer.from('tampered bytes'));

  const created = await app.inject({
    method: 'POST',
    url: '/api/draft/run',
    headers: { cookie, 'content-type': 'application/json' },
    payload,
  });
  assert.equal(created.statusCode, 409, created.body);
  assert.match(created.body, /DRAFT_FILE_DIGEST_MISMATCH/);
  assert.equal(createCalls, 0);
});

test('rejects malformed finalization keys before creating a run', async (t) => {
  let createCalls = 0;
  const { app } = await fixture({ async createRun() { createCalls += 1; } });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST', url: '/api/draft/run', headers: { 'content-type': 'application/json' },
    payload: {
      consent: true,
      finalization_key: '../../same-run',
      file_manifest: { version: 1, person: null, identity: null, garments: [] },
    },
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /valid UUID v4/);
  assert.equal(createCalls, 0);
});

test('finalization fails closed when the browser omits its exact file manifest', async (t) => {
  let createCalls = 0;
  const { app } = await fixture({ async createRun() { createCalls += 1; } });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/draft/run',
    headers: { 'content-type': 'application/json' },
    payload: { consent: true },
  });
  assert.equal(response.statusCode, 400, response.body);
  assert.match(response.json().message, /file_manifest version 1 is required/);
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
