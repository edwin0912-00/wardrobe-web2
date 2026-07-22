import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentSupervisor } from '../../src/monitor/agent-supervisor.js';
import { MonitorEventStore } from '../../src/monitor/event-store.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  // The controlled executor may not adopt the gate until its output artifact
  // has been written. Mark the gate handled immediately while preserving the
  // original rejection for the supervisor to observe.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

async function waitFor(predicate, message, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

async function seedSupervisorState(root, state) {
  const stateRoot = path.join(root, 'supervisor');
  await mkdir(path.join(stateRoot, 'incidents'), { recursive: true });
  for (const incident of Object.values(state.incidents)) {
    await writeFile(path.join(stateRoot, 'incidents', `${incident.id}.json`), JSON.stringify(incident));
  }
  await writeFile(path.join(stateRoot, 'state.json'), JSON.stringify(state));
}

function controlledExecutor() {
  const calls = [];
  const executor = (command, args) => {
    const gate = deferred();
    const outputFlag = args.indexOf('--output-last-message');
    const outputPath = args[outputFlag + 1];
    const call = { command, args, gate, outputPath };
    calls.push(call);
    return writeFile(outputPath, `review artifact ${calls.length}\n`).then(() => gate.promise);
  };
  return { calls, executor };
}

async function readSupervisorState(root) {
  return JSON.parse(await readFile(path.join(root, 'supervisor', 'state.json'), 'utf8'));
}

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
  const errorComment = events.find((event) => event.type === 'agent.comment' && event.severity === 'error').data.message;
  assert.match(errorComment, /не зависання/);
  assert.match(errorComment, /ITEM_FACTS/);
  assert.doesNotMatch(events.filter((event) => event.source === 'agent').map((event) => event.data?.message ?? '').join('\n'), /garment/i);
  const state = JSON.parse(await readFile(path.join(root, 'supervisor', 'state.json'), 'utf8'));
  assert.equal(Object.keys(state.incidents).length, 1);
  await supervisor.tick();
  assert.equal((await store.tail(30)).filter((event) => event.type === 'agent.incident_opened').length, 1);
});

test('restart reconciles a legacy stale active incident and launches it from the persisted queue', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-supervisor-restart-'));
  const now = new Date('2026-07-22T14:00:00.000Z');
  const incident = { id: 'incident-a', run_id: 'c8780403-9adf-43d7-a600-653b751b8a75', status: 'open', attempts: 1,
    created_at: '2026-07-22T13:00:00.000Z' };
  await seedSupervisorState(root, { version: 1, last_event_id: null, started_at: now.toISOString(),
    incidents: { [incident.id]: incident }, active_incident: incident.id });
  const store = new MonitorEventStore({ filename: path.join(root, 'events.jsonl'), clock: () => now });
  await store.initialize();
  const controlled = controlledExecutor();
  const supervisor = new AgentSupervisor({ store, runsRoot: path.join(root, 'runs'), stateRoot: path.join(root, 'supervisor'),
    sourceRoot: root, clock: () => now, agentEnabled: true, executor: controlled.executor, gitStatus: async () => true });
  t.after(async () => {
    controlled.calls.at(-1)?.gate.resolve({ stdout: '', stderr: '' });
    await supervisor.close();
  });

  await supervisor.initialize();
  await waitFor(() => controlled.calls.length === 1, 'stale active incident was not relaunched');
  const state = await readSupervisorState(root);
  assert.equal(state.version, 2);
  assert.equal(state.active_incident, incident.id);
  assert.equal(state.active_lease.incident_id, incident.id);
  assert.equal(state.incidents[incident.id].status, 'running');
  assert.equal(state.incidents[incident.id].attempts, 2);
  assert.equal((await store.tail(20)).filter((event) => event.type === 'agent.repair_requeued').length, 1);
});

test('an unexpired lease from a previous supervisor owner is stale and dispatches exactly once', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-supervisor-lease-'));
  const now = new Date('2026-07-22T14:00:00.000Z');
  const incident = { id: 'incident-leased', run_id: 'c8780403-9adf-43d7-a600-653b751b8a75', status: 'running', attempts: 1,
    created_at: '2026-07-22T13:00:00.000Z' };
  await seedSupervisorState(root, { version: 2, last_event_id: null, started_at: now.toISOString(),
    incidents: { [incident.id]: incident }, active_incident: incident.id,
    active_lease: { incident_id: incident.id, owner_id: 'previous-process', acquired_at: now.toISOString(),
      expires_at: new Date(now.valueOf() + 60_000).toISOString() } });
  const store = new MonitorEventStore({ filename: path.join(root, 'events.jsonl'), clock: () => now });
  await store.initialize();
  const controlled = controlledExecutor();
  const supervisor = new AgentSupervisor({ store, runsRoot: path.join(root, 'runs'), stateRoot: path.join(root, 'supervisor'),
    sourceRoot: root, clock: () => now, agentEnabled: true, executor: controlled.executor, gitStatus: async () => true,
    leaseMs: 60_000 });
  t.after(async () => {
    controlled.calls.at(-1)?.gate.resolve({ stdout: '', stderr: '' });
    await supervisor.close();
  });

  await supervisor.initialize();
  await waitFor(() => controlled.calls.length === 1, 'foreign lease did not return incident to dispatch');
  await Promise.all([supervisor.tick(), supervisor.tick()]);
  assert.equal(controlled.calls.length, 1);
  assert.equal((await readSupervisorState(root)).incidents[incident.id].attempts, 2);
});

test('dispatcher is FIFO, drains after settle, and never double launches on concurrent ticks', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-supervisor-fifo-'));
  const now = new Date('2026-07-22T14:00:00.000Z');
  const first = { id: 'incident-first', run_id: '11111111-1111-4111-8111-111111111111', status: 'queued', attempts: 0,
    created_at: '2026-07-22T13:00:00.000Z' };
  const second = { id: 'incident-second', run_id: '22222222-2222-4222-8222-222222222222', status: 'queued', attempts: 0,
    created_at: '2026-07-22T13:01:00.000Z' };
  await seedSupervisorState(root, { version: 2, last_event_id: null, started_at: now.toISOString(),
    incidents: { [second.id]: second, [first.id]: first }, active_incident: null, active_lease: null });
  const store = new MonitorEventStore({ filename: path.join(root, 'events.jsonl'), clock: () => now });
  await store.initialize();
  const controlled = controlledExecutor();
  const supervisor = new AgentSupervisor({ store, runsRoot: path.join(root, 'runs'), stateRoot: path.join(root, 'supervisor'),
    sourceRoot: root, clock: () => now, agentEnabled: true, executor: controlled.executor, gitStatus: async () => true });
  t.after(async () => {
    for (const call of controlled.calls) call.gate.resolve({ stdout: '', stderr: '' });
    await supervisor.close();
  });

  await supervisor.initialize();
  await waitFor(() => controlled.calls.length === 1, 'first FIFO incident did not launch');
  assert.match(controlled.calls[0].args[1], /incident-first\.json/);
  await Promise.all([supervisor.tick(), supervisor.tick(), supervisor.tick()]);
  assert.equal(controlled.calls.length, 1);

  controlled.calls[0].gate.resolve({ stdout: '', stderr: '' });
  await waitFor(() => controlled.calls.length === 2, 'queue did not drain after first agent settled');
  assert.match(controlled.calls[1].args[1], /incident-second\.json/);
  controlled.calls[1].gate.resolve({ stdout: '', stderr: '' });
  await waitFor(async () => (await readSupervisorState(root)).active_incident === null, 'second incident did not settle');
  const state = await readSupervisorState(root);
  assert.equal(state.incidents[first.id].status, 'review_required');
  assert.equal(state.incidents[second.id].status, 'review_required');
  assert.equal(controlled.calls.length, 2);
});

test('dirty Git leaves the oldest incident queued without consuming attempts and retries on tick', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-supervisor-dirty-'));
  const now = new Date('2026-07-22T14:00:00.000Z');
  const incident = { id: 'incident-dirty', run_id: '33333333-3333-4333-8333-333333333333', status: 'queued', attempts: 0,
    created_at: now.toISOString() };
  await seedSupervisorState(root, { version: 2, last_event_id: null, started_at: now.toISOString(),
    incidents: { [incident.id]: incident }, active_incident: null, active_lease: null });
  const store = new MonitorEventStore({ filename: path.join(root, 'events.jsonl'), clock: () => now });
  await store.initialize();
  const controlled = controlledExecutor();
  let clean = false;
  const supervisor = new AgentSupervisor({ store, runsRoot: path.join(root, 'runs'), stateRoot: path.join(root, 'supervisor'),
    sourceRoot: root, clock: () => now, agentEnabled: true, executor: controlled.executor, gitStatus: async () => clean });
  t.after(async () => {
    controlled.calls.at(-1)?.gate.resolve({ stdout: '', stderr: '' });
    await supervisor.close();
  });

  await supervisor.initialize();
  await supervisor.tick();
  assert.equal(controlled.calls.length, 0);
  let state = await readSupervisorState(root);
  assert.equal(state.incidents[incident.id].status, 'queued');
  assert.equal(state.incidents[incident.id].attempts, 0);
  assert.equal(state.incidents[incident.id].queue_reason, 'dirty_git');
  assert.equal((await store.tail(20)).filter((event) => event.type === 'agent.repair_queued').length, 1);

  clean = true;
  await supervisor.tick();
  await waitFor(() => controlled.calls.length === 1, 'queued incident was not retried after Git became clean');
  state = await readSupervisorState(root);
  assert.equal(state.incidents[incident.id].attempts, 1);
});

test('failed queued incident retries up to three attempts and then stops without a fourth launch', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-supervisor-retry-'));
  const now = new Date('2026-07-22T14:00:00.000Z');
  const incident = { id: 'incident-retry', run_id: '44444444-4444-4444-8444-444444444444', status: 'queued', attempts: 0,
    created_at: now.toISOString() };
  await seedSupervisorState(root, { version: 2, last_event_id: null, started_at: now.toISOString(),
    incidents: { [incident.id]: incident }, active_incident: null, active_lease: null });
  const store = new MonitorEventStore({ filename: path.join(root, 'events.jsonl'), clock: () => now });
  await store.initialize();
  const controlled = controlledExecutor();
  const supervisor = new AgentSupervisor({ store, runsRoot: path.join(root, 'runs'), stateRoot: path.join(root, 'supervisor'),
    sourceRoot: root, clock: () => now, agentEnabled: true, executor: controlled.executor, gitStatus: async () => true });
  t.after(() => supervisor.close());

  await supervisor.initialize();
  await waitFor(() => controlled.calls.length === 1, 'first attempt did not launch');
  controlled.calls[0].gate.reject(new Error('attempt one failed'));
  await waitFor(() => controlled.calls.length === 2, 'second attempt did not launch');
  controlled.calls[1].gate.reject(new Error('attempt two failed'));
  await waitFor(() => controlled.calls.length === 3, 'third attempt did not launch');
  controlled.calls[2].gate.reject(new Error('attempt three failed'));
  await waitFor(async () => (await readSupervisorState(root)).incidents[incident.id].status === 'stopped', 'third failure did not stop incident');
  await supervisor.tick();

  const state = await readSupervisorState(root);
  assert.equal(state.incidents[incident.id].attempts, 3);
  assert.equal(state.incidents[incident.id].queue_reason, 'attempt_limit');
  assert.equal(controlled.calls.length, 3);
  assert.equal((await store.tail(50)).filter((event) => event.type === 'agent.repair_failed').length, 3);
});
