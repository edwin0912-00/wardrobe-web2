import assert from 'node:assert/strict';
import test from 'node:test';

import { createWebApp } from '../../src/web/app.js';

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
