#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainOrigins = (process.env.WARDROBE_TEST_MAIN_ORIGINS
  ?? 'https://madeforthisjob.com,https://site.madeforthisjob.com')
  .split(',')
  .map((value) => value.trim().replace(/\/$/, ''))
  .filter(Boolean);
const betaOrigin = (process.env.WARDROBE_TEST_BETA_ORIGIN ?? 'https://beta.madeforthisjob.com')
  .replace(/\/$/, '');
const timeoutMs = Number(process.env.WARDROBE_TEST_LIVE_TIMEOUT_MS ?? 60_000);
const cacheBust = `test-system-${Date.now()}`;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function fetchBytes(url, options = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    ...options,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { response, bytes };
}

async function fetchJson(url) {
  const { response, bytes } = await fetchBytes(url, {
    headers: { accept: 'application/json' },
  });
  assert.equal(response.status, 200, `${url} returned HTTP ${response.status}`);
  return JSON.parse(bytes.toString('utf8'));
}

const expectedMain = await readFile(path.join(root, 'b', 'index.html'));
const expectedMainSha = sha256(expectedMain);
const healthReceipts = [];

for (const origin of mainOrigins) {
  const { response, bytes } = await fetchBytes(`${origin}/?${cacheBust}`);
  assert.equal(response.status, 200, `${origin} root returned HTTP ${response.status}`);
  assert.equal(sha256(bytes), expectedMainSha, `${origin} does not serve this alpha main build`);

  const bridge = await fetchBytes(`${origin}/adapters/cinematic-ui-bridge.mjs?${cacheBust}`);
  assert.equal(bridge.response.status, 200, `${origin} bridge returned HTTP ${bridge.response.status}`);
  assert.ok(bridge.bytes.length > 1_000, `${origin} bridge response is unexpectedly small`);

  const health = await fetchJson(`${origin}/api/health?${cacheBust}`);
  assert.equal(health.status, 'ready', `${origin} backend status is ${health.status}`);
  healthReceipts.push({ origin, release_sha: health.release_sha, generation: health.generation });

  const catalog = await fetchBytes(`${origin}/api/scene-presets?${cacheBust}`, {
    headers: { accept: 'application/json' },
  });
  assert.equal(catalog.response.status, 200, `${origin} scene catalog returned HTTP ${catalog.response.status}`);
  assert.ok(catalog.bytes.length > 100, `${origin} scene catalog is unexpectedly empty`);

  const range = await fetchBytes(`${origin}/b/assets/seg1.mp4`, {
    headers: { Range: 'bytes=0-1023' },
  });
  assert.equal(range.response.status, 206, `${origin} MP4 Range returned HTTP ${range.response.status}`);
  assert.equal(range.bytes.length, 1_024, `${origin} MP4 Range returned ${range.bytes.length} bytes`);
  assert.ok(range.response.headers.get('content-range'), `${origin} omitted Content-Range`);
}

const betaHealth = await fetchJson(`${betaOrigin}/api/health?${cacheBust}`);
assert.equal(betaHealth.status, 'ready', `${betaOrigin} status is ${betaHealth.status}`);
assert.ok(betaHealth.release_sha, `${betaOrigin} omitted release_sha`);
for (const receipt of healthReceipts) {
  assert.equal(receipt.release_sha, betaHealth.release_sha, `${receipt.origin} and beta expose different engine releases`);
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  const criticalFailures = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    if (request.method() === 'HEAD' && request.failure()?.errorText === 'net::ERR_ABORTED') return;
    if (['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(request.resourceType())) {
      criticalFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const type = response.request().resourceType();
    if (['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(type)) {
      criticalFailures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  await page.goto(`${mainOrigins[0]}/?${cacheBust}`, {
    waitUntil: 'domcontentloaded',
    timeout: timeoutMs,
  });
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-bridge') === 'ready'
      && Boolean(window.WardrobeCinematicBridge),
    null,
    { timeout: timeoutMs },
  );
  const receipt = await page.evaluate(async () => {
    const state = await window.WardrobeCinematicBridge.probe();
    const alert = document.querySelector('[data-bridge-status]');
    return {
      availability: state.availability,
      release_sha: state.releaseSha,
      bridge_alert_hidden: !alert || alert.hidden,
      body_visible: document.body.getBoundingClientRect().height > 0,
    };
  });
  assert.equal(receipt.availability, 'ready', `browser bridge is ${receipt.availability}`);
  assert.equal(receipt.release_sha, betaHealth.release_sha, 'browser bridge exposes a different engine release');
  assert.equal(receipt.bridge_alert_hidden, true, 'browser shows the bridge failure alert');
  assert.equal(receipt.body_visible, true, 'browser rendered an empty document');
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
  assert.deepEqual(criticalFailures, [], `critical request failures: ${criticalFailures.join(' | ')}`);

  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    main_origins: mainOrigins,
    main_sha256: expectedMainSha,
    beta_origin: betaOrigin,
    engine_release_sha: betaHealth.release_sha,
    browser: receipt,
    paid_generation_started: false,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
