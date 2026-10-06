import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';

import { createWebApp } from '../../src/web/app.js';

const betaRoot = path.resolve(import.meta.dirname, '../..');

function runReadmeStartupVerifier(environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['tools/verify-readme-startup.mjs'], {
      cwd: betaRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = [];
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`README startup verifier timed out:\n${output.join('').slice(-4_000)}`));
    }, 40_000);
    child.stdout.on('data', (chunk) => output.push(String(chunk)));
    child.stderr.on('data', (chunk) => output.push(String(chunk)));
    child.once('error', finish);
    child.once('close', (code, signal) => {
      const text = output.join('');
      if (code === 0) finish(null, text);
      else finish(new Error(`README startup verifier exited ${code ?? signal}:\n${text.slice(-4_000)}`));
    });
  });
}

function localBrowserPath(ownerPath, reference) {
  const url = new URL(reference, `http://wardrobe.local${ownerPath}`);
  return `${url.pathname}${url.search}`;
}

function isLocalBrowserReference(reference) {
  return /^(?:\/|\.\.?\/)/.test(reference);
}

function browserReferences(source, pathname) {
  const references = [];
  if (pathname.endsWith('.html') || pathname === '/') {
    for (const match of source.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)) {
      references.push(match[1]);
    }
  }
  if (pathname.endsWith('.js')) {
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g)) {
      references.push(match[1]);
    }
    for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      references.push(match[1]);
    }
  }
  if (pathname.endsWith('.css')) {
    for (const match of source.matchAll(/@import\s+(?:url\()?['"]?([^'"\)\s]+)['"]?\)?/g)) {
      references.push(match[1]);
    }
  }
  return references.filter(isLocalBrowserReference);
}

function sourceCanReferenceBrowserAssets(contentType, pathname) {
  return /(?:text\/html|javascript|text\/css)/i.test(contentType)
    || pathname === '/'
    || /\.(?:html|js|css)$/i.test(pathname);
}

test('README local startup surface serves the UI module graph and backend health route', async (t) => {
  // This exercises Fastify's actual static resolver and real health route,
  // rather than asserting that an import string merely exists in source.
  const app = await createWebApp({ service: {} });
  t.after(async () => app.close());

  const pending = ['/'];
  const visited = new Set();
  const failures = [];

  while (pending.length > 0) {
    const requestPath = pending.shift();
    const normalizedPath = requestPath.split('?')[0];
    if (visited.has(normalizedPath)) continue;
    visited.add(normalizedPath);

    const response = await app.inject({ method: 'GET', url: requestPath });
    if (response.statusCode !== 200) {
      failures.push(`${requestPath} → HTTP ${response.statusCode}`);
      continue;
    }
    if (!sourceCanReferenceBrowserAssets(response.headers['content-type'] ?? '', normalizedPath)) continue;

    const ownerPath = normalizedPath === '/' ? '/index.html' : normalizedPath;
    for (const reference of browserReferences(response.body, ownerPath)) {
      pending.push(localBrowserPath(ownerPath, reference));
    }
  }

  assert.deepEqual(failures, [], `README browser asset graph has broken routes:\n${failures.join('\n')}`);
  assert.ok(visited.has('/app.js'), 'main UI module was not reached from index.html');
  assert.ok(visited.has('/scene-ui.js'), 'scene UI module was not reached from app.js');

  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.statusCode, 200, health.body);
  assert.deepEqual(health.json().service, 'web');
});

test('README startup verifier stays credential-free when configured providers are inherited', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'wardrobe-readme-startup-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const output = await runReadmeStartupVerifier({
    PATH: process.env.PATH ?? '',
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
    HOME: temporaryRoot,
    CODEX_HOME: path.join(temporaryRoot, 'inherited-codex-home'),
    ZEELY_GENERATION_PROVIDER: 'codex-primary',
    ZEELY_VLM_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'test-openrouter-key',
    FAL_KEY: 'test-fal-key',
  });

  assert.match(output, /README startup PASS/);
  assert.match(output, /health=degraded/);
});
