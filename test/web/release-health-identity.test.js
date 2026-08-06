import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createWebApp } from '../../src/web/app.js';
import { loadReleaseIdentity } from '../../src/web/release-identity.js';

test('public health binds the exact immutable release identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-health-'));
  try {
    await mkdir(path.join(root, 'ops'));
    const expected = {
      base_commit: 'c7edb70611ba0af93cd1857331f2632e4cde23f5',
      cache_token: 'product-c7edb706-2d58718c5079',
    };
    await writeFile(
      path.join(root, 'ops', 'product-release-manifest.json'),
      JSON.stringify(expected),
    );
    const releaseIdentity = await loadReleaseIdentity(root);
    const app = await createWebApp({
      service: {},
      releaseIdentity,
    });
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().release_sha, expected.base_commit);
    assert.equal(response.json().cache_token, expected.cache_token);
    await app.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('development without a release manifest stays supported', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-health-missing-'));
  try {
    assert.equal(await loadReleaseIdentity(root), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
