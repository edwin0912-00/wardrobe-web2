#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const timeoutMs = 25_000;

async function reserveLocalPort() {
  const server = net.createServer();
  server.unref();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function responseAt(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_000);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealth(origin, child, logs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`README startup exited before listening:\n${logs.join('').slice(-4_000)}`);
    }
    try {
      const response = await responseAt(`${origin}/api/health`);
      if (response.status === 200) return response;
    } catch {
      // The process is still completing local preflight. Keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`README startup did not listen within ${timeoutMs / 1_000}s:\n${logs.join('').slice(-4_000)}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const deadline = Date.now() + 2_000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    while (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'wardrobe-readme-startup-'));
let child;
try {
  const port = await reserveLocalPort();
  const origin = `http://127.0.0.1:${port}`;
  const logs = [];
  child = spawn(process.execPath, ['src/web/start.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      ZEELY_RUNTIME_ROOT: path.join(temporaryRoot, 'runtime'),
      ZEELY_COOKIE_SECURE: 'false',
      // The local README contract must not require a public deployment origin
      // or a fallback credential merely to serve the application.
      ZEELY_PUBLIC_HTTPS_ORIGIN: '',
      OPENROUTER_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));

  const healthResponse = await waitForHealth(origin, child, logs);
  const health = await healthResponse.json();
  assert.equal(health.service, 'web', JSON.stringify(health));
  for (const pathname of ['/', '/app.js', '/scene-ui.js']) {
    const response = await responseAt(`${origin}${pathname}`);
    assert.equal(response.status, 200, `${pathname} returned HTTP ${response.status}`);
  }
  process.stdout.write(`README startup PASS · ${origin} · health=${health.status}\n`);
} finally {
  await stop(child);
  await rm(temporaryRoot, { recursive: true, force: true });
}
