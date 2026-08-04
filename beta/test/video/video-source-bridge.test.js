import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';

import {
  createUnavailableVideoAssetUrlResolver,
  createVideoAssetUrlResolver,
  redactVideoSourceRequestPath,
  registerVideoSourceBridgeRoutes,
} from '../../src/web/video-source-bridge.js';
import { installDemoAuth } from '../../src/web/demo-auth.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const RECEIPT_SHA = 'b'.repeat(64);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function fixture(fn, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'video-source-bridge-'));
  const clipStoreRoot = path.join(directory, 'video-clips');
  const clipId = 'clip-bridge-1';
  const sourcePath = path.join(clipStoreRoot, 'clips', clipId, 'source.png');
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, PNG);
  try {
    const bridge = createVideoAssetUrlResolver({
      clipStoreRoot,
      httpsOrigin: 'https://beta.example',
      ...options,
    });
    const binding = {
      clipId,
      sourceSha256: sha256(PNG),
      approvedLookReceiptSha256: RECEIPT_SHA,
    };
    await fn({ bridge, binding, sourcePath, directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('resolver issues an opaque HTTPS capability bound server-side to source and receipt', async () => {
  await fixture(async ({ bridge, binding, sourcePath }) => {
    const url = await bridge.videoAssetUrlResolver(sourcePath, binding);
    assert.match(url, /^https:\/\/beta\.example\/api\/video-source\/[A-Za-z0-9_-]{43}$/);
    assert.equal(url.includes(binding.clipId), false);
    assert.equal(url.includes(binding.sourceSha256), false);
    assert.equal(url.includes(binding.approvedLookReceiptSha256), false);
    assert.equal(url.includes(encodeURIComponent(sourcePath)), false);
    const source = await bridge.consume(url);
    assert.deepEqual(source.bytes, PNG);
    assert.equal(source.mediaType, 'image/png');
    assert.equal(source.size, PNG.length);
  });
});

test('resolver refuses traversal and a source path outside the exact clip binding', async () => {
  await fixture(async ({ bridge, binding, sourcePath, directory }) => {
    await assert.rejects(
      () => bridge.videoAssetUrlResolver(path.join(directory, '..', 'source.png'), binding),
      (error) => error.code === 'VIDEO_SOURCE_PATH_INVALID',
    );
    await assert.rejects(
      () => bridge.videoAssetUrlResolver(`${sourcePath}/../source.png`, binding),
      (error) => error.code === 'VIDEO_SOURCE_PATH_INVALID',
    );
  });
});

test('resolver refuses an incorrect approved source hash before issuing a capability', async () => {
  await fixture(async ({ bridge, binding, sourcePath }) => {
    await assert.rejects(
      () => bridge.videoAssetUrlResolver(sourcePath, {
        ...binding,
        sourceSha256: 'c'.repeat(64),
      }),
      (error) => error.code === 'VIDEO_SOURCE_HASH_MISMATCH',
    );
    await assert.rejects(
      () => bridge.videoAssetUrlResolver(sourcePath, {
        ...binding,
        approvedLookReceiptSha256: 'not-a-receipt-hash',
      }),
      (error) => error.code === 'VIDEO_SOURCE_BINDING_INVALID',
    );
  });
});

test('resolver locks supported image media type and bounded size at issuance', async () => {
  await fixture(async ({ bridge, binding, sourcePath }) => {
    await writeFile(sourcePath, Buffer.from('not-an-image'));
    await assert.rejects(
      () => bridge.videoAssetUrlResolver(sourcePath, binding),
      (error) => error.code === 'VIDEO_SOURCE_MEDIA_INVALID',
    );
  });
});

test('consume rechecks bytes and revokes a capability when the file is tampered', async () => {
  await fixture(async ({ bridge, binding, sourcePath }) => {
    const url = await bridge.videoAssetUrlResolver(sourcePath, binding);
    const tampered = Buffer.from(PNG);
    tampered[tampered.length - 1] ^= 1;
    await writeFile(sourcePath, tampered);
    await assert.rejects(
      () => bridge.consume(url),
      (error) => error.code === 'VIDEO_SOURCE_HASH_MISMATCH',
    );
    await assert.rejects(
      () => bridge.consume(url),
      (error) => error.code === 'VIDEO_SOURCE_CAPABILITY_REVOKED',
    );
  });
});

test('capability expires at its bounded deadline', async () => {
  let now = 10_000;
  await fixture(async ({ bridge, binding, sourcePath }) => {
    const url = await bridge.videoAssetUrlResolver(sourcePath, binding);
    now += 1_000;
    assert.equal(bridge.expire(), 1);
    await assert.rejects(
      () => bridge.consume(url),
      (error) => error.code === 'VIDEO_SOURCE_CAPABILITY_EXPIRED',
    );
  }, { ttlMs: 1_000, clock: () => now });
});

test('capability enforces its replay limit', async () => {
  await fixture(async ({ bridge, binding, sourcePath }) => {
    const url = await bridge.videoAssetUrlResolver(sourcePath, binding);
    await bridge.consume(url);
    await assert.rejects(
      () => bridge.consume(url),
      (error) => error.code === 'VIDEO_SOURCE_REPLAY_LIMIT',
    );
  }, { maxFetches: 1 });
});

test('capability supports explicit revocation', async () => {
  await fixture(async ({ bridge, binding, sourcePath }) => {
    const url = await bridge.videoAssetUrlResolver(sourcePath, binding);
    assert.equal(bridge.revoke(url), true);
    await assert.rejects(
      () => bridge.consume(url),
      (error) => error.code === 'VIDEO_SOURCE_CAPABILITY_REVOKED',
    );
  });
});

test('capability route serves locked bytes once without cache or secret-bearing errors', async () => {
  await fixture(async ({ bridge, binding, sourcePath }) => {
    const url = await bridge.videoAssetUrlResolver(sourcePath, binding);
    const pathname = new URL(url).pathname;
    const token = pathname.split('/').at(-1);
    const app = Fastify({ logger: false });
    await registerVideoSourceBridgeRoutes(app, { videoSourceBridge: bridge });
    const first = await app.inject({ method: 'GET', url: pathname });
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers['content-type'], 'image/png');
    assert.equal(first.headers['cache-control'], 'private, no-store, max-age=0');
    assert.equal(first.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(first.rawPayload, PNG);
    const replay = await app.inject({ method: 'GET', url: pathname });
    assert.equal(replay.statusCode, 410);
    assert.equal(replay.body.includes(token), false);
    assert.equal(replay.body.includes(sourcePath), false);
    await app.close();
  });
});

test('opaque capability is sufficient for the bridge route when demo PIN auth is enabled', async () => {
  await fixture(async ({ bridge, binding, sourcePath }) => {
    const url = await bridge.videoAssetUrlResolver(sourcePath, binding);
    const app = Fastify({ logger: false });
    installDemoAuth(app, {
      pin: '1234',
      secret: 'a-demo-secret-that-is-at-least-thirty-two-characters',
      secure: false,
    });
    await registerVideoSourceBridgeRoutes(app, { videoSourceBridge: bridge });
    const response = await app.inject({ method: 'GET', url: new URL(url).pathname });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.rawPayload, PNG);
    await app.close();
  });
});

test('logging redaction removes capability tokens and leaves ordinary stages intact', () => {
  const token = 'A'.repeat(43);
  assert.equal(
    redactVideoSourceRequestPath(`/api/video-source/${token}`),
    '/api/video-source/[redacted-capability]',
  );
  assert.equal(
    redactVideoSourceRequestPath(`/api/video-source/${token}?ignored=true`),
    '/api/video-source/[redacted-capability]',
  );
  assert.equal(redactVideoSourceRequestPath('/api/health'), '/api/health');
});

test('local startup can defer an absent public origin until an OpenRouter fallback actually needs it', async () => {
  const resolver = createUnavailableVideoAssetUrlResolver();
  await assert.rejects(
    () => resolver('/not-a-real-source.png', {}),
    (error) => error.code === 'VIDEO_SOURCE_ORIGIN_UNAVAILABLE' && error.status === 503,
  );
});
