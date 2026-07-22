import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MonitorEventStore } from '../../src/monitor/event-store.js';
import { createWebApp } from '../../src/web/app.js';

async function store() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zeely-monitor-'));
  const value = new MonitorEventStore({ filename: path.join(directory, 'events.jsonl') });
  await value.initialize();
  return value;
}

const service = {
  createRun: async () => null, getRun: async () => null, subscribe: () => () => {},
  outputFile: async () => null, retry: async () => null, deleteRun: async () => {},
};

test('monitor store appends structured events and returns a bounded tail', async () => {
  const monitor = await store();
  await monitor.append({ source: 'test', type: 'run.phase', run_id: 'run-1', data: { stage: 'UPLOADED' } });
  await monitor.append({ source: 'test', type: 'run.phase', run_id: 'run-1', data: { stage: 'VALIDATING' } });
  const events = await monitor.tail(1);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.stage, 'VALIDATING');
  assert.match(events[0].id, /^[0-9a-f-]{36}$/);
});

test('client telemetry accepts only allowlisted event types and data fields', async () => {
  const monitor = await store();
  const app = await createWebApp({ service, monitor });
  const accepted = await app.inject({ method: 'POST', url: '/api/telemetry', payload: {
    type: 'client.file_selected', session_id: 'session-1',
    data: { field: 'person', count: 1, bytes: 123, filename: 'private-name.png', secret: 'nope' },
  } });
  assert.equal(accepted.statusCode, 202);
  const events = (await app.inject({ method: 'GET', url: '/api/monitor/events' })).json().events;
  assert.equal(events.length, 1);
  assert.equal(events[0].data.field, 'person');
  assert.equal(events[0].data.filename, undefined);
  assert.equal(events[0].data.secret, undefined);
  const rejected = await app.inject({ method: 'POST', url: '/api/telemetry', payload: { type: 'steal.files', data: {} } });
  assert.equal(rejected.statusCode, 400);
  await app.close();
});
