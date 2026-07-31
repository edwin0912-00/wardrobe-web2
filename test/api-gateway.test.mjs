import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const REPO = path.resolve(import.meta.dirname, '..');

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
    const fail = (error) => { child.kill(); reject(error); };
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

function requestGateway(port, { path: requestPath, method = 'GET', headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path: requestPath, method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.once('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

test('static Range delivery and same-origin API streaming share one server', async (t) => {
  const requests = [];
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      method: request.method,
      url: request.url,
      host: request.headers.host,
      origin: request.headers.origin,
      body: Buffer.concat(chunks).toString(),
    });
    response.setHeader('content-type', 'application/json');
    response.setHeader('set-cookie', '__Host-wardrobe=test; Secure; Path=/; SameSite=Strict');
    response.end(JSON.stringify({ status: 'ready', release_sha: 'beta-test' }));
  });
  const upstreamPort = await listen(upstream);
  t.after(() => upstream.close());

  const root = await mkdtemp(path.join(tmpdir(), 'wardrobe-gateway-'));
  await writeFile(path.join(root, 'clip.mp4'), Buffer.from('0123456789'));
  const gateway = await startGateway(root, upstreamPort);
  t.after(async () => {
    gateway.child.kill('SIGTERM');
    await once(gateway.child, 'exit').catch(() => {});
  });

  const origin = `http://127.0.0.1:${gateway.port}`;
  const health = await requestGateway(gateway.port, {
    path: '/api/health',
    headers: { host: 'site.madeforthisjob.com', origin: 'https://site.madeforthisjob.com' },
  });
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).release_sha, 'beta-test');
  assert.match(health.headers['set-cookie'][0], /^__Host-wardrobe=/);
  assert.deepEqual(requests[0], {
    method: 'GET',
    url: '/api/health',
    host: 'site.madeforthisjob.com',
    origin: 'https://site.madeforthisjob.com',
    body: '',
  });

  const mutationBody = JSON.stringify({ outfit_text: 'linen' });
  const mutation = await requestGateway(gateway.port, {
    path: '/api/draft/meta',
    method: 'PUT',
    headers: {
      host: 'site.madeforthisjob.com',
      origin: 'https://site.madeforthisjob.com',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(mutationBody),
    },
    body: mutationBody,
  });
  assert.equal(mutation.status, 200);
  assert.equal(requests[1].body, '{"outfit_text":"linen"}');

  // Browser multipart uploads may reach the tunnel with chunked request
  // framing. The gateway must relay those bytes instead of treating them as
  // an empty body merely because Content-Length is absent.
  const chunked = await requestGateway(gateway.port, {
    path: '/api/runs',
    method: 'POST',
    headers: {
      host: 'site.madeforthisjob.com',
      origin: 'https://site.madeforthisjob.com',
      'content-type': 'application/octet-stream',
    },
    body: 'chunked-upload',
  });
  assert.equal(chunked.status, 200);
  assert.equal(requests[2].body, 'chunked-upload');

  const range = await fetch(`${origin}/clip.mp4`, { headers: { range: 'bytes=2-5' } });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), '2345');
  assert.equal(range.headers.get('content-range'), 'bytes 2-5/10');

  // This is not an analytics endpoint. It exists solely for a same-origin browser
  // health signal, and must reject an accidental third-party POST.
  const observationBody = JSON.stringify({
    event: 'bridge_needs_input', code: 'look', gate: 'none', leg: 0,
  });
  const observation = await requestGateway(gateway.port, {
    path: '/__site-observability',
    method: 'POST',
    headers: {
      host: `127.0.0.1:${gateway.port}`,
      origin,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(observationBody),
    },
    body: observationBody,
  });
  assert.equal(observation.status, 204);

  const crossSite = await requestGateway(gateway.port, {
    path: '/__site-observability',
    method: 'POST',
    headers: {
      host: `127.0.0.1:${gateway.port}`,
      origin: 'https://not-the-site.example',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(observationBody),
    },
    body: observationBody,
  });
  assert.equal(crossSite.status, 403);
});
