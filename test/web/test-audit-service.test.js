import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Fastify from 'fastify';

import { createWebApp } from '../../src/web/app.js';
import { OpenTesterGodViewAuth } from '../../src/web/god-view-auth.js';
import { ProfileService } from '../../src/web/profile-service.js';
import { normalizeTestAuditPayload, registerTestAuditRoutes } from '../../src/web/test-audit-routes.js';
import { parseUserAgent, TestAuditService } from '../../src/web/test-audit-service.js';

const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15';

async function auditFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-test-audit-'));
  const service = new TestAuditService({
    databasePath: path.join(root, 'test-audit.sqlite'),
    ipHashKey: 'audit-test-key-that-is-long-enough',
    clock: () => new Date('2026-08-03T12:00:00.000Z'),
  });
  await service.initialize();
  t.after(async () => {
    service.close();
    await rm(root, { recursive: true, force: true });
  });
  return service;
}

test('coarse user-agent parsing distinguishes device, OS and browser without preserving the raw UA', () => {
  assert.deepEqual(parseUserAgent(MAC_SAFARI), {
    device: 'desktop',
    os: 'macOS',
    browser: 'Safari',
    browser_major: 17,
  });
  assert.deepEqual(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'), {
    device: 'mobile',
    os: 'iOS',
    browser: 'Safari',
    browser_major: 18,
  });
});

test('audit persists a bounded journey with country and a non-reversible network pseudonym, never the raw IP or UA', async (t) => {
  const service = await auditFixture(t);
  const request = {
    ip: '127.0.0.1',
    headers: {
      'cf-connecting-ip': '203.0.113.24',
      'cf-ipcountry': 'ES',
      'user-agent': MAC_SAFARI,
      'x-forwarded-host': 'site.madeforthisjob.com',
    },
  };
  await service.record({
    request,
    profile_id: 'profile-audit-0001',
    event: { type: 'main.open', session_id: 'main-session-0001', stage: 'entry', gate: 'ready', leg: 0 },
  });
  await service.record({
    request,
    profile_id: 'profile-audit-0001',
    event: { type: 'main.exit', session_id: 'main-session-0001', stage: 'fashion_shoot', gate: 'held', leg: 3 },
  });

  const overview = service.overview();
  assert.equal(overview.summary.profiles, 1);
  const [profile] = overview.profiles;
  assert.equal(profile.device, 'desktop');
  assert.equal(profile.os, 'macOS');
  assert.equal(profile.browser, 'Safari');
  assert.equal(profile.browser_major, 17);
  assert.equal(profile.country_code, 'ES');
  assert.match(profile.network_id, /^[a-f0-9]{16}$/);
  assert.equal(profile.network_source, 'cloudflare');
  assert.ok(profile.last_ended_at);
  assert.equal(profile.last_event, 'main.exit');
  assert.equal(JSON.stringify(overview).includes('203.0.113.24'), false);
  assert.equal(JSON.stringify(overview).includes(MAC_SAFARI), false);

  await service.record({
    request,
    profile_id: 'profile-audit-0001',
    event: { type: 'main.open', session_id: 'main-session-0001', stage: 'entry', gate: 'ready', leg: 0 },
  });
  assert.equal(service.overview().profiles[0].last_ended_at, null);

  assert.deepEqual(service.setSegment('profile-audit-0001', 'MY_TESTS'), {
    profile_id: 'profile-audit-0001',
    segment: 'MY_TESTS',
  });
  assert.equal(service.overview().profiles[0].segment, 'MY_TESTS');
});

test('route payload normalization accepts only the compact allowlisted event shape', () => {
  assert.deepEqual(normalizeTestAuditPayload({
    type: 'main.ready',
    session_id: 'main-session-0002',
    stage: 'ready',
    gate: 'ready',
    leg: 1,
  }), {
    type: 'main.ready',
    session_id: 'main-session-0002',
    stage: 'ready',
    gate: 'ready',
    leg: 1,
    status: null,
    code: null,
  });
  assert.throws(() => normalizeTestAuditPayload({
    type: 'arbitrary.event',
    session_id: 'main-session-0002',
  }), /Unsupported test-audit event/);
  assert.throws(() => normalizeTestAuditPayload({
    type: 'main.ready',
    session_id: 'main-session-0002',
    description: 'this must never be stored',
  }), /Unsupported test-audit field/);
});

test('same-origin route resolves the existing anonymous profile and refuses arbitrary payload fields', async (t) => {
  const service = await auditFixture(t);
  const app = Fastify();
  await registerTestAuditRoutes(app, {
    testAudit: service,
    profileApi: {
      async resolveRequestProfile() {
        return { profileId: 'profile-route-0001' };
      },
    },
  });
  t.after(() => app.close());

  const accepted = await app.inject({
    method: 'POST',
    url: '/api/test-audit/events',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.24',
      'cf-ipcountry': 'ES',
      'user-agent': MAC_SAFARI,
    },
    payload: {
      type: 'main.ready',
      session_id: 'main-session-0002',
      stage: 'ready',
      gate: 'ready',
      leg: 1,
    },
  });
  assert.equal(accepted.statusCode, 202, accepted.body);
  assert.equal(accepted.json().accepted, true);
  assert.equal(service.overview().profiles[0].last_event, 'main.ready');

  const rejected = await app.inject({
    method: 'POST',
    url: '/api/test-audit/events',
    headers: { 'content-type': 'application/json' },
    payload: {
      type: 'main.ready',
      session_id: 'main-session-0002',
      description: 'this must never be stored',
    },
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(JSON.stringify(service.overview()).includes('this must never be stored'), false);
});

test('God View exposes the private audit and lets a tester manually mark their own browser profile', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-god-audit-'));
  const testAudit = new TestAuditService({
    databasePath: path.join(root, 'test-audit.sqlite'),
    ipHashKey: 'audit-test-key-that-is-long-enough',
  });
  await testAudit.initialize();
  await testAudit.record({
    request: { ip: '127.0.0.1', headers: { 'user-agent': MAC_SAFARI, 'cf-ipcountry': 'ES' } },
    profile_id: 'profile-god-audit-0001',
    event: { type: 'client.boot', session_id: 'beta-session-0001', stage: 'start' },
  });
  const profiles = new ProfileService({ databasePath: path.join(root, 'profiles.sqlite') });
  const app = await createWebApp({
    service: { subscribe() { return () => {}; } },
    profiles,
    godViewAuth: new OpenTesterGodViewAuth(),
    testAudit,
  });
  t.after(async () => {
    await app.close();
    profiles.close();
    testAudit.close();
    await rm(root, { recursive: true, force: true });
  });

  const overview = await app.inject({ method: 'GET', url: '/api/god-view/overview' });
  assert.equal(overview.statusCode, 200, overview.body);
  assert.equal(overview.json().audit.profiles[0].profile_id, 'profile-god-audit-0001');
  assert.equal(overview.json().audit.profiles[0].country_code, 'ES');

  const marked = await app.inject({
    method: 'POST',
    url: '/api/god-view/test-audit/profiles/profile-god-audit-0001/segment',
    payload: { segment: 'MY_TESTS' },
  });
  assert.equal(marked.statusCode, 200, marked.body);
  assert.equal(marked.json().segment, 'MY_TESTS');
});
