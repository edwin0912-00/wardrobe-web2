#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { MockProvider } from '../beta/src/providers/mock-provider.js';
import { createWebApp } from '../beta/src/web/app.js';
import { ProfileService } from '../beta/src/web/profile-service.js';
import { RunService } from '../beta/src/web/run-service.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const timeoutMs = 30_000;
const requireFromBeta = createRequire(path.join(root, 'beta', 'package.json'));
const sharp = requireFromBeta('sharp');

async function canonicalOutput() {
  const silhouette = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="560" viewBox="0 0 256 560">
      <circle cx="128" cy="48" r="38" fill="#9b7156"/>
      <rect x="71" y="91" width="114" height="190" rx="28" fill="#275b36"/>
      <rect x="82" y="276" width="42" height="210" rx="18" fill="#26313d"/>
      <rect x="132" y="276" width="42" height="210" rx="18" fill="#26313d"/>
      <rect x="67" y="478" width="67" height="37" rx="16" fill="#101317"/>
      <rect x="122" y="478" width="67" height="37" rx="16" fill="#101317"/>
    </svg>
  `);
  return sharp({ create: { width: 512, height: 640, channels: 3, background: '#ffffff' } })
    .composite([{ input: silhouette, left: 128, top: 30 }])
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .png()
    .toBuffer();
}

function garmentInspection(paths, context) {
  if (context?.purpose === 'FIRST_APPEARANCE_LOCK') {
    return {
      status: 'READY',
      reason: 'deterministic first-appearance fixture',
      items: [
        {
          source_index: 0,
          source_indexes: [0],
          category: 'bottom',
          confidence: 1,
          same_item_confidence: 1,
          grouping_evidence: ['One deterministic fixture reference.'],
          observed: {
            garment_type: 'charcoal trousers',
            colors: ['charcoal'],
            material: ['woven'],
            pattern: [],
            logo_text: [],
            construction: ['full-length leg'],
          },
          unknowns: [],
          blockers: [],
        },
        {
          source_index: 1,
          source_indexes: [1],
          category: 'footwear',
          confidence: 1,
          same_item_confidence: 1,
          grouping_evidence: ['Deterministic full-body fixture.'],
          observed: {
            garment_type: 'black shoes',
            colors: ['black'],
            material: ['leather'],
            pattern: [],
            logo_text: [],
            construction: ['closed toe'],
          },
          unknowns: [],
          blockers: [],
        },
      ],
    };
  }
  return {
    status: 'READY',
    reason: `deterministic inspection of ${paths.length} reference(s)`,
    items: paths.map((_, index) => ({
      source_index: index,
      source_indexes: [index],
      category: 'top',
      confidence: 1,
      same_item_confidence: 1,
      grouping_evidence: ['One deterministic fixture reference.'],
      observed: {
        garment_type: 'forest green hoodie',
        colors: ['forest green'],
        material: ['fleece'],
        pattern: [],
        logo_text: [],
        construction: ['hood', 'long sleeves'],
      },
      unknowns: [],
      blockers: [],
    })),
  };
}

async function startEngine(runtimeRoot) {
  const generatedImage = await canonicalOutput();
  const garmentImage = await readFile(path.join(
    root,
    'beta',
    'artifacts',
    'conditioning',
    'garments',
    'hoodie-green',
    'reference-card.png',
  ));
  const vlm = {
    inspectGarments: garmentInspection,
    evaluateQa: async () => ({
      decision: 'PASS',
      reason: 'deterministic self-check QA',
      checks: [{ name: 'SELF_CHECK', pass: true, score: 1, evidence: 'Explicit fixture approval.' }],
      defects: [],
    }),
  };
  const provider = new MockProvider({ image: generatedImage });
  const service = new RunService({
    rootDirectory: path.join(runtimeRoot, 'runs'),
    provider,
    vlm,
    assetGenerator: {
      generateGarment: async () => ({
        image: garmentImage,
        metadata: { provider: 'deterministic-self-check' },
      }),
      generateScene: async () => ({
        image: generatedImage,
        metadata: { provider: 'deterministic-self-check' },
      }),
    },
  });
  await service.initialize();
  const profiles = new ProfileService({ databasePath: path.join(runtimeRoot, 'profiles.sqlite') });
  const app = await createWebApp({
    service,
    profiles,
    health: {
      status: 'ready',
      generation: 'deterministic-self-check',
      semantic_qa: 'deterministic-self-check',
    },
    releaseIdentity: {
      release_sha: 'self-check-fixture',
      cache_token: 'product-selfcheck-browsercore',
    },
    logger: false,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  return {
    app,
    profiles,
    origin: `http://127.0.0.1:${app.server.address().port}`,
  };
}

function startGateway(upstream) {
  const child = spawn('/usr/bin/python3', [path.join(root, 'serve.py'), '0', root], {
    cwd: root,
    env: { ...process.env, PYTHONUNBUFFERED: '1', WARDROBE_API_UPSTREAM: upstream },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`gateway did not listen within ${timeoutMs}ms: ${output}`));
    }, timeoutMs);
    const finish = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    child.once('error', reject);
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/127\.0\.0\.1:(\d+)/);
      if (match) finish({ child, origin: `http://127.0.0.1:${match[1]}` });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`gateway exited ${code}: ${output}`));
    });
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'wardrobe-browser-self-check-'));
let engine;
let gateway;
let browser;
try {
  engine = await startEngine(runtimeRoot);
  gateway = await startGateway(engine.origin);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  const failedCriticalRequests = [];
  const failedCriticalResponses = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    // Chromium cancels media-capability HEAD probes after receiving enough
    // headers. GET/fetch/script failures remain blocking; these speculative
    // HEAD ERR_ABORTED events are not failed product requests.
    if (request.method() === 'HEAD' && request.failure()?.errorText === 'net::ERR_ABORTED') return;
    if (['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(request.resourceType())) {
      failedCriticalRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`);
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    if (response.status() < 400 || !['document', 'script', 'stylesheet'].includes(request.resourceType())) return;
    failedCriticalResponses.push(`${response.status()} ${request.method()} ${response.url()}`);
  });

  await page.goto(`${gateway.origin}/b/`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  assert.equal(await page.locator('body').count(), 1, 'cinematic page did not render a body');
  await page.waitForFunction(() => window.WardrobeCinematicBridge && window.ui, null, { timeout: timeoutMs });
  const bootBridge = await page.evaluate(async () => {
    const bridge = window.WardrobeCinematicBridge;
    if (!bridge) return { loaded: false, availability: 'unavailable', release_sha: null };
    const state = await bridge.probe();
    return {
      loaded: bridge === window.WardrobeCinematicBridge,
      availability: state.availability,
      release_sha: state.releaseSha,
    };
  });
  assert.deepEqual(bootBridge, {
    loaded: true,
    availability: 'ready',
    release_sha: 'self-check-fixture',
  });

  const personBytes = await readFile(path.join(root, 'beta', 'inputs', 'zeely-test', 'users', 'input4.jpg'));
  const garmentBytes = await readFile(path.join(root, 'beta', 'inputs', 'zeely-test', 'outfits', '180827-1.webp'));
  const result = await page.evaluate(async ({ personBase64, garmentBase64 }) => {
    const bytes = (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const request = async (url, options = {}) => {
      const response = await fetch(url, { credentials: 'same-origin', ...options });
      let body = null;
      try { body = await response.clone().json(); } catch { body = await response.arrayBuffer(); }
      return { status: response.status, headers: Object.fromEntries(response.headers), body };
    };
    const waitForRun = async (runId) => {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const current = await request(`/api/runs/${encodeURIComponent(runId)}`);
        if (['COMPLETED', 'FAILED', 'NEEDS_INPUT'].includes(current.body?.status)) return current;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`run ${runId} did not become terminal`);
    };
    const create = async ({ garment }) => {
      const form = new FormData();
      form.append('person_photo', new Blob([bytes(personBase64)], { type: 'image/jpeg' }), 'person.jpg');
      if (garment) {
        form.append('garment_images', new Blob([bytes(garmentBase64)], { type: 'image/webp' }), 'hoodie.webp');
      } else {
        form.append('outfit_text', 'cobalt-blue blazer with a plain white crew-neck top');
      }
      form.append('generate_scene', 'false');
      form.append('consent', 'true');
      const created = await request('/api/runs', { method: 'POST', body: form });
      if (created.status !== 202) throw new Error(`create failed ${created.status}: ${JSON.stringify(created.body)}`);
      const terminal = await waitForRun(created.body.run_id);
      if (terminal.body.status !== 'COMPLETED') throw new Error(`run failed: ${JSON.stringify(terminal.body)}`);
      const avatar = await request(`/api/runs/${created.body.run_id}/files/avatar.png`);
      const outfit = await request(`/api/runs/${created.body.run_id}/files/avatar_outfit.png`);
      const claim = await request(`/api/profile/runs/${created.body.run_id}/claim`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source_avatar_id: null }),
      });
      const saved = await request(`/api/profile/runs/${created.body.run_id}/save`, { method: 'POST' });
      return {
        run_id: created.body.run_id,
        avatar_status: avatar.status,
        outfit_status: outfit.status,
        avatar_cache: avatar.headers['cache-control'],
        claim_status: claim.status,
        save_status: saved.status,
        look_id: saved.body?.look?.look_id,
      };
    };

    const initialProfile = await request('/api/profile');
    const text = await create({ garment: false });
    const reference = await create({ garment: true });

    const bad = new FormData();
    bad.append('person_photo', new Blob([
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]),
    ], { type: 'image/png' }), 'broken.png');
    bad.append('outfit_text', 'black top');
    bad.append('consent', 'true');
    const structuredError = await request('/api/runs', { method: 'POST', body: bad });

    const bridge = window.WardrobeCinematicBridge;
    if (!bridge || bridge !== window.WardrobeCinematicBridge) {
      throw new Error('the page-owned cinematic bridge did not load');
    }
    const state = await bridge.probe();
    const profile = await request('/api/profile');

    let bridgeInputError = null;
    try {
      await bridge.createLook({
        person: new Blob([
          new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]),
        ], { type: 'image/png' }),
        outfitText: 'black top',
      });
    } catch (error) {
      bridgeInputError = {
        status: error?.status ?? null,
        code: error?.code ?? null,
        reason_code: error?.reasonCode ?? null,
        next_action: error?.nextAction ?? null,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.querySelector('[data-stage]')?.setAttribute('data-station', '1');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const errorDom = {
      visible: Boolean(document.querySelector('[data-ui-show] [role="alert"]')),
      retry: Boolean(document.querySelector('[data-ui-show] [data-retry-action]')),
      back: Boolean(document.querySelector('[data-ui-show] [data-cancel-action]')),
      action_error: window.ui?.state().actionError ?? null,
    };
    document.querySelector('[data-ui-show] [data-cancel-action]')?.click();
    const afterBack = window.ui?.state() ?? null;
    const openedHistory = window.ui?.openLookLibrary() ?? false;
    const historyState = window.ui?.state() ?? null;

    return {
      initial_profile_status: initialProfile.status,
      text,
      reference,
      structured_error: {
        status: structuredError.status,
        code: structuredError.body?.code,
        next_action: structuredError.body?.next_action,
      },
      bridge: {
        page_owned: bridge === window.WardrobeCinematicBridge,
        availability: state.availability,
        saved_look_id: state.savedLook?.look_id ?? null,
      },
      bridge_input_error: bridgeInputError,
      error_dom: errorDom,
      after_back: {
        action_error: afterBack?.actionError ?? null,
        view: afterBack?.view ?? null,
      },
      history: {
        opened: openedHistory,
        look_count: historyState?.looks?.length ?? 0,
        step_id: historyState?.stepId ?? null,
      },
      profile_look_count: profile.body?.looks?.length ?? 0,
    };
  }, {
    personBase64: personBytes.toString('base64'),
    garmentBase64: garmentBytes.toString('base64'),
  });

  assert.equal(result.initial_profile_status, 200);
  for (const flow of [result.text, result.reference]) {
    assert.equal(flow.avatar_status, 200);
    assert.equal(flow.outfit_status, 200);
    assert.match(flow.avatar_cache ?? '', /private, no-store/);
    assert.ok([200, 201].includes(flow.claim_status));
    assert.ok([200, 201].includes(flow.save_status));
    assert.match(flow.look_id ?? '', /^[0-9a-f-]{36}$/i);
  }
  assert.equal(result.structured_error.status, 422);
  assert.equal(result.structured_error.code, 'IMAGE_DECODE_FAILED');
  assert.equal(result.structured_error.next_action, 'REPLACE_INPUT');
  assert.deepEqual(result.bridge_input_error, {
    status: 422,
    code: 'IMAGE_DECODE_FAILED',
    reason_code: null,
    next_action: 'REPLACE_INPUT',
  });
  assert.equal(result.error_dom.visible, true);
  assert.equal(result.error_dom.retry, true);
  assert.equal(result.error_dom.back, true);
  assert.equal(result.error_dom.action_error?.kind, 'look');
  assert.equal(result.error_dom.action_error?.code, 'IMAGE_DECODE_FAILED');
  assert.equal(result.after_back.action_error, null);
  assert.equal(result.after_back.view, 'look');
  assert.deepEqual(result.history, { opened: true, look_count: 2, step_id: 'looks' });
  assert.equal(result.bridge.page_owned, true);
  assert.equal(result.bridge.availability, 'ready');
  assert.ok(result.bridge.saved_look_id);
  assert.equal(result.profile_look_count, 2);

  await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs });
  const restored = await page.evaluate(async () => {
    const response = await fetch('/api/profile', { credentials: 'same-origin' });
    const profile = await response.json();
    return { status: response.status, looks: profile.looks?.length ?? 0 };
  });
  assert.deepEqual(restored, { status: 200, looks: 2 });
  assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join(' | ')}`);
  assert.deepEqual(failedCriticalRequests, [], `critical request failures: ${failedCriticalRequests.join(' | ')}`);
  assert.deepEqual(failedCriticalResponses, [], `critical HTTP responses: ${failedCriticalResponses.join(' | ')}`);

  const brokenContext = await browser.newContext();
  const brokenPage = await brokenContext.newPage();
  const attemptedRunMutations = [];
  brokenPage.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') {
      attemptedRunMutations.push(request.url());
    }
  });
  await brokenPage.route('**/adapters/cinematic-ui-bridge.mjs*', (route) => route.fulfill({
    status: 404,
    contentType: 'text/javascript; charset=utf-8',
    body: '/* forced missing bridge for acceptance */',
  }));
  const startupTelemetry = brokenPage.waitForRequest((request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/__site-observability') return false;
    try {
      const body = JSON.parse(request.postData() ?? '{}');
      return body.event === 'bridge_failed' && body.code === 'module-load';
    } catch {
      return false;
    }
  }, { timeout: timeoutMs });
  await brokenPage.goto(`${gateway.origin}/b/`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await brokenPage.waitForFunction(() => (
    document.documentElement.getAttribute('data-bridge') === 'unavailable'
      && window.ui?.state().bridge?.availability === 'unavailable'
  ), null, { timeout: timeoutMs });
  const telemetryRequest = await startupTelemetry;
  const bridge404 = await brokenPage.evaluate(() => {
    const alert = document.querySelector('[data-bridge-status][role="alert"]');
    const state = window.ui?.state() ?? null;
    return {
      alert_visible: Boolean(alert && !alert.hidden),
      alert_text: alert?.textContent?.trim() ?? '',
      bridge_marker: document.documentElement.getAttribute('data-bridge'),
      bridge_code: document.documentElement.getAttribute('data-bridge-code'),
      bridge_availability: state?.bridge?.availability ?? null,
      simulated: state?.simulated ?? null,
      pending: state?.pending ?? null,
      look_count: state?.looks?.length ?? null,
      rendered_result: Boolean(document.querySelector('[data-ui-show] .lookframe__img')),
      global_bridge: Boolean(window.WardrobeCinematicBridge),
    };
  });
  assert.deepEqual(bridge404, {
    alert_visible: true,
    alert_text: 'Не вдалося підключити генерацію. Оновіть сторінку.',
    bridge_marker: 'unavailable',
    bridge_code: 'module-load',
    bridge_availability: 'unavailable',
    simulated: false,
    pending: false,
    look_count: 0,
    rendered_result: false,
    global_bridge: false,
  });
  const telemetryBody = JSON.parse(telemetryRequest.postData() ?? '{}');
  assert.equal(telemetryBody.event, 'bridge_failed');
  assert.equal(telemetryBody.code, 'module-load');
  assert.deepEqual(Object.keys(telemetryBody).sort(), ['code', 'event', 'gate', 'leg']);
  assert.deepEqual(attemptedRunMutations, []);
  await brokenContext.close();

  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    provider: 'deterministic-fixture-not-paid-generation',
    browser: 'chromium',
    core_flows: ['text_outfit', 'reference_outfit'],
    outputs_downloaded: 4,
    saved_looks_after_reload: restored.looks,
    structured_error: result.structured_error,
    bridge: result.bridge,
    visible_error_recovery: {
      error: result.error_dom,
      after_back: result.after_back,
      history: result.history,
    },
    bridge_module_404: bridge404,
    weakened_checks: [],
  }, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => {});
  await stop(gateway?.child);
  await engine?.app.close().catch(() => {});
  engine?.profiles.close();
  await rm(runtimeRoot, { recursive: true, force: true });
}
