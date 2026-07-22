import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentSupervisor } from '../../src/monitor/agent-supervisor.js';
import { MonitorEventStore } from '../../src/monitor/event-store.js';

test('agent supervisor comments persisted phases and opens one deduplicated incident', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-supervisor-'));
  const runId = 'c8780403-9adf-43d7-a600-653b751b8a75';
  const runDirectory = path.join(root, 'runs', runId);
  await mkdir(runDirectory, { recursive: true });
  const now = new Date('2026-07-22T13:32:35.000Z');
  const run = { run_id: runId, status: 'NEEDS_INPUT', phase: 'GARMENT_CONDITIONING', inner_state: null,
    message: 'Garment slot conflicts require explicit selection', updated_at: now.toISOString(), error: { name: 'GarmentNeedsInputError' } };
  await writeFile(path.join(runDirectory, 'run.json'), JSON.stringify(run));
  const store = new MonitorEventStore({ filename: path.join(root, 'events.jsonl'), clock: () => now });
  await store.initialize();
  await store.append({ source: 'runner', type: 'run.phase', run_id: runId,
    data: { status: 'RUNNING', stage: 'GARMENT_CONDITIONING', message: 'Classifying references' } });
  await store.append({ source: 'runner', type: 'run.phase', severity: 'error', run_id: runId,
    data: { status: run.status, stage: run.phase, message: run.message } });
  const supervisor = new AgentSupervisor({ store, runsRoot: path.join(root, 'runs'), stateRoot: path.join(root, 'supervisor'),
    sourceRoot: root, clock: () => now, agentEnabled: false });
  t.after(() => supervisor.close());
  await supervisor.initialize();
  await supervisor.tick();
  const events = await store.tail(20);
  assert.equal(events.filter((event) => event.type === 'agent.comment').length, 2);
  assert.equal(events.filter((event) => event.type === 'agent.incident_opened').length, 1);
  assert.match(events.find((event) => event.type === 'agent.comment' && event.severity === 'error').data.message, /не зависання/);
  const state = JSON.parse(await readFile(path.join(root, 'supervisor', 'state.json'), 'utf8'));
  assert.equal(Object.keys(state.incidents).length, 1);
  await supervisor.tick();
  assert.equal((await store.tail(30)).filter((event) => event.type === 'agent.incident_opened').length, 1);
});
