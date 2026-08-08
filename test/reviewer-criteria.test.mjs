import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { createZeelyClient, ZeelyApiError } from '../adapters/zeely-client.mjs';
import { createCinematicUiBridge } from '../adapters/cinematic-ui-bridge.mjs';

const REPO = path.resolve(import.meta.dirname, '..');

test('alpha README and evaluator expose one reproducible behavioral acceptance path', async () => {
  const [readme, reviewerAcceptance, packageJson, checks, lock] = await Promise.all([
    readFile(path.join(REPO, 'README.md'), 'utf8'),
    readFile(path.join(REPO, 'docs', 'REVIEWER-ACCEPTANCE.md'), 'utf8'),
    readFile(path.join(REPO, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(REPO, 'self-check', 'checks.json'), 'utf8').then(JSON.parse),
    readFile(path.join(REPO, 'release', 'RELEASE.lock.json'), 'utf8').then(JSON.parse),
  ]);

  assert.match(readme, /--filter=blob:none --depth 8 --single-branch --branch alpha/);
  assert.match(readme, /\.\/scripts\/install-local\.sh --run/);
  assert.match(readme, /main-сайт: `http:\/\/127\.0\.0\.1:4173\/`/);
  assert.match(readme, /REVIEWER-ACCEPTANCE\.md/);
  assert.match(reviewerAcceptance, /Bridge module повернув 404/);
  assert.match(reviewerAcceptance, /Видимий `\[role="alert"\]`/);
  assert.match(reviewerAcceptance, /нуль `POST \/api\/runs`/);
  assert.match(reviewerAcceptance, /Deterministic fixture.*не видається за доказ фотореалізму/s);
  assert.equal(packageJson.scripts['self-check'], 'node scripts/self-check.mjs');
  assert.equal(packageJson.scripts['test:browser-core'], 'node scripts/browser-core-e2e.mjs');
  assert.equal(packageJson.scripts['media:install'], 'node scripts/fetch-media-bundle.mjs');
  assert.ok(checks.rules.some((rule) => rule.id === 'BROWSER_CORE_E2E' && rule.blocking));
  assert.deepEqual(checks.forbidden_repairs.includes('change QA thresholds'), true);
  assert.equal(lock.sources.beta_engine.commit, '9393da5dc1b0815169d6a2c93a4128e7ca714b47');
  assert.deepEqual(lock.provenance.excluded_private_paths, [
    'beta/secrets/zeely-runtime-private.tar.gz.enc',
  ]);
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function startGateway(root, upstreamPort) {
  const child = spawn('/usr/bin/python3', [path.join(REPO, 'serve.py'), '0', root], {
    env: { ...process.env, WARDROBE_API_UPSTREAM: `http://127.0.0.1:${upstreamPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let output = '';
    const fail = (error) => {
      child.kill();
      reject(error);
    };
    child.once('error', fail);
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/127\.0\.0\.1:(\d+)/);
      if (match) resolve({ child, port: Number(match[1]) });
    });
    child.once('exit', (code) => fail(new Error(`gateway exited ${code}: ${output}`)));
  });
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

test('README journey uses a real gateway: bridge restores account history and preserves backend errors', async (t) => {
  const requested = [];
  const upstream = createServer((request, response) => {
    requested.push(request.url);
    const routes = {
      '/api/health': { status: 'ready', generation: 'available', release_sha: 'reviewer-beta-sha' },
      '/api/profile': {
        looks: [{ look_id: 'look-review', image_url: '/api/profile/looks/look-review/image' }],
      },
      '/api/scene-presets': [],
      '/api/editorial-modes': [],
      '/api/profile/looks/look-review/video-capability': {},
      '/api/post-shoot/realtime-look-capability?look_id=look-review': {},
      '/api/post-shoot/pipeline': {},
      '/api/profile/looks/look-review/scenes': [{
        scene_id: 'scene-review', status: 'COMPLETED',
        image_url: '/api/profile/scenes/scene-review/image',
      }],
      '/api/profile/looks/look-review/editorial-shoots': [{
        shoot_id: 'shoot-review', status: 'COMPLETED',
        shots: [{
          slot: 'environmental_hero', status: 'APPROVED',
          output: { image_url: '/api/profile/editorial-shoots/shoot-review/shots/environmental_hero/image' },
        }],
      }],
      '/api/profile/looks/look-review/video-clips': [{
        clip_id: 'video-review', status: 'PASS',
        video_url: '/api/profile/video-clips/video-review/video',
      }],
    };

    if (request.url === '/api/runs/rejected-run') {
      json(response, 409, {
        error: 'The supplied image is too small',
        code: 'IMAGE_TOO_SMALL',
        reason_code: 'INPUT_PIXEL_DIMENSIONS_TOO_SMALL',
        next_action: 'REPLACE_INPUT',
      });
      return;
    }
    if (Object.hasOwn(routes, request.url)) {
      json(response, 200, routes[request.url]);
      return;
    }
    json(response, 404, { code: 'NOT_FOUND' });
  });
  const upstreamPort = await listen(upstream);
  t.after(() => upstream.close());

  const root = await mkdtemp(path.join(tmpdir(), 'wardrobe-reviewer-gateway-'));
  const gateway = await startGateway(REPO, upstreamPort);
  t.after(async () => {
    gateway.child.kill('SIGTERM');
    await once(gateway.child, 'exit').catch(() => {});
  });

  const origin = `http://127.0.0.1:${gateway.port}`;
  for (const modulePath of [
    '/adapters/zeely-client.mjs',
    '/adapters/cinematic-ui-bridge.mjs',
  ]) {
    const moduleResponse = await fetch(`${origin}${modulePath}`);
    assert.equal(moduleResponse.status, 200, `${modulePath} must load from the README origin`);
    assert.match(moduleResponse.headers.get('content-type') ?? '', /javascript/);
    assert.ok((await moduleResponse.text()).length > 1_000);
  }

  const client = createZeelyClient({
    apiBase: `${origin}/api`,
    EventSourceImpl: class NoEventSource {},
  });
  const bridge = createCinematicUiBridge({ client, autoProbe: false });
  t.after(() => bridge.dispose());

  const state = await bridge.probe();
  assert.equal(state.availability, 'ready');
  assert.equal(state.releaseSha, 'reviewer-beta-sha');
  assert.equal(state.savedLook.look_id, 'look-review');
  assert.equal(state.deliveries.scenes[0].scene_id, 'scene-review');
  assert.equal(state.deliveries.shoots[0].shoot_id, 'shoot-review');
  assert.equal(state.deliveries.videos[0].clip_id, 'video-review');

  await assert.rejects(client.loadRun('rejected-run'), (error) => {
    assert.ok(error instanceof ZeelyApiError);
    assert.equal(error.status, 409);
    assert.equal(error.code, 'IMAGE_TOO_SMALL');
    assert.equal(error.reasonCode, 'INPUT_PIXEL_DIMENSIONS_TOO_SMALL');
    assert.equal(error.nextAction, 'REPLACE_INPUT');
    return true;
  });

  for (const requiredPath of [
    '/api/health',
    '/api/profile',
    '/api/profile/looks/look-review/scenes',
    '/api/profile/looks/look-review/editorial-shoots',
    '/api/profile/looks/look-review/video-clips',
    '/api/runs/rejected-run',
  ]) assert.ok(requested.includes(requiredPath), `real upstream did not receive ${requiredPath}`);
});
