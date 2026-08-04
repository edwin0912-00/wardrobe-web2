import assert from 'node:assert/strict';
import test from 'node:test';

import Fastify from 'fastify';

import { ProfileError, registerProfileRoutes } from '../../src/web/profile-service.js';

// These tests cover the route contract only: authorization plumbing, headers,
// the binding payload and the failure translation. The lock itself and the card
// composition are covered by live-look-reference.test.js and by the existing
// approved-item-evidence suites; a fake service is used here deliberately so a
// route regression cannot hide behind a database fixture.
function buildApp({ liveReference }) {
  const service = {
    async initialize() {},
    resolveOrCreateSession() {
      return { profileId: 'profile-1', token: 'a'.repeat(43), expiresAt: Date.now() + 60_000 };
    },
    approvedLookLiveReference: liveReference,
  };
  const runService = { async getRun() { return null; }, async outputFile() { return null; } };
  const app = Fastify();
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ProfileError) {
      return reply.code(error.statusCode).send({ code: error.code, error: error.message });
    }
    return reply.code(500).send({ error: 'unexpected' });
  });
  return { app, service, runService };
}

const CARD = Object.freeze({
  look_id: 'look-1',
  source_run_id: 'run-1',
  image_sha256: 'a'.repeat(64),
  receipt_sha256: 'b'.repeat(64),
  reference_sha256: 'c'.repeat(64),
  width: 1024,
  height: 1024,
  items: [
    { order: 0, category: 'top', sha256: 'd'.repeat(64) },
    { order: 1, category: 'bottom', sha256: 'e'.repeat(64) },
    { order: 2, category: 'footwear', sha256: 'f'.repeat(64) },
  ],
  image: Buffer.from('89504e470d0a1a0a', 'hex'),
});

test('the binding route returns hashes and items and never the bytes', async () => {
  const { app, service, runService } = buildApp({ liveReference: async () => CARD });
  await registerProfileRoutes(app, { service, runService, secureCookie: false });

  const response = await app.inject({ method: 'GET', url: '/api/profile/looks/look-1/live-reference' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.headers.vary, 'Cookie');

  const body = response.json();
  assert.equal(body.reference_sha256, CARD.reference_sha256);
  assert.equal(body.image_sha256, CARD.image_sha256);
  assert.equal(body.receipt_sha256, CARD.receipt_sha256);
  assert.deepEqual(body.items.map((item) => item.category), ['top', 'bottom', 'footwear']);
  assert.equal(body.image, undefined, 'the JSON view must not carry image bytes');
  assert.equal(Object.hasOwn(body, 'source_run_id'), false, 'internal run id stays server-side');

  await app.close();
});

test('the png route serves the card with its hash in a header', async () => {
  const { app, service, runService } = buildApp({ liveReference: async () => CARD });
  await registerProfileRoutes(app, { service, runService, secureCookie: false });

  const response = await app.inject({ method: 'GET', url: '/api/profile/looks/look-1/live-reference.png' });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /^image\/png/);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.headers['x-live-reference-sha256'], CARD.reference_sha256);
  assert.deepEqual(response.rawPayload, CARD.image);

  await app.close();
});

test('both routes pass the session profile, not the path, as the owner', async () => {
  const seen = [];
  const { app, service, runService } = buildApp({
    liveReference: async (profileId, lookId) => {
      seen.push([profileId, lookId]);
      return CARD;
    },
  });
  await registerProfileRoutes(app, { service, runService, secureCookie: false });

  await app.inject({ method: 'GET', url: '/api/profile/looks/look-9/live-reference' });
  await app.inject({ method: 'GET', url: '/api/profile/looks/look-9/live-reference.png' });
  assert.deepEqual(seen, [['profile-1', 'look-9'], ['profile-1', 'look-9']]);

  await app.close();
});

test('an incomplete look answers 422 with its code and no image', async () => {
  const { app, service, runService } = buildApp({
    liveReference: async () => {
      throw new ProfileError(422, 'LIVE_REFERENCE_INCOMPLETE_LOOK', 'Live needs a complete locked look; missing: footwear');
    },
  });
  await registerProfileRoutes(app, { service, runService, secureCookie: false });

  for (const url of ['/api/profile/looks/look-1/live-reference', '/api/profile/looks/look-1/live-reference.png']) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().code, 'LIVE_REFERENCE_INCOMPLETE_LOOK');
    assert.doesNotMatch(response.headers['content-type'] ?? '', /image\/png/);
  }

  await app.close();
});

test('a look whose item evidence is invalid answers 409, not a fallback image', async () => {
  const { app, service, runService } = buildApp({
    liveReference: async () => {
      throw new ProfileError(409, 'LOOK_ITEM_EVIDENCE_INVALID', 'Saved look item evidence is missing or invalid');
    },
  });
  await registerProfileRoutes(app, { service, runService, secureCookie: false });

  const response = await app.inject({ method: 'GET', url: '/api/profile/looks/look-1/live-reference.png' });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, 'LOOK_ITEM_EVIDENCE_INVALID');

  await app.close();
});

test('an unknown look answers 404', async () => {
  const { app, service, runService } = buildApp({
    liveReference: async () => { throw new ProfileError(404, 'LOOK_NOT_FOUND', 'Look not found'); },
  });
  await registerProfileRoutes(app, { service, runService, secureCookie: false });

  const response = await app.inject({ method: 'GET', url: '/api/profile/looks/missing/live-reference' });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().code, 'LOOK_NOT_FOUND');

  await app.close();
});
