import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CinematicUiBridgeError,
  MIRROR_COPY,
  createCinematicUiBridge,
} from '../adapters/cinematic-ui-bridge.mjs';

function clientStub({ health = { status: 'ready' } } = {}) {
  let subscriber = null;
  const calls = [];
  return {
    calls,
    health: async () => health,
    subscribe(listener) {
      subscriber = listener;
      listener({ type: 'snapshot' });
      return () => { subscriber = null; };
    },
    emit(event) { subscriber?.(event); },
    async createRunFromUploads(input) {
      calls.push(['createRunFromUploads', input]);
      return { run_id: 'run-1', status: 'QUEUED', outputs: {} };
    },
    async selectGarments(runId, selections) {
      calls.push(['selectGarments', runId, selections]);
      return { run_id: runId, status: 'QUEUED', outputs: {} };
    },
    async retryRun(runId) {
      calls.push(['retryRun', runId]);
      return { run_id: runId, status: 'QUEUED', outputs: {} };
    },
    async saveRun() { return { look: { look_id: 'look-1' } }; },
  };
}

test('an absent same-origin gateway stays unavailable and cannot create a fake look', async () => {
  const client = clientStub({ health: { status: 'degraded' } });
  const bridge = createCinematicUiBridge({ client, autoProbe: false });

  await bridge.probe();

  assert.equal(bridge.state().availability, 'unavailable');
  assert.equal(bridge.canStartLook(), false);
  await assert.rejects(
    bridge.createLook({ person: new Blob(['a']), garments: [new Blob(['b'])] }),
    (error) => error instanceof CinematicUiBridgeError && error.code === 'MIRROR_UNAVAILABLE',
  );
  assert.deepEqual(client.calls, []);
});

test('only a completed API run supplies a mirror result image', async () => {
  const client = clientStub();
  const bridge = createCinematicUiBridge({ client, autoProbe: false });
  await bridge.probe();

  await bridge.createLook({
    person: new Blob(['person']),
    garments: [new Blob(['garment'])],
  });
  assert.equal(bridge.state().phase, 'running');
  assert.equal(bridge.state().result, null);
  assert.equal(MIRROR_COPY.running, 'Збираємо образ');

  client.emit({
    type: 'run:event',
    run: {
      run_id: 'run-1',
      status: 'COMPLETED',
      outputs: { avatar_outfit: '/api/runs/run-1/files/avatar_outfit.png' },
    },
  });

  assert.equal(bridge.state().phase, 'completed');
  assert.deepEqual(bridge.state().result, {
    runId: 'run-1',
    imageUrl: '/api/runs/run-1/files/avatar_outfit.png',
  });
});

test('garment resolution stays on the left-choice path while the right mirror remains waiting', async () => {
  const client = clientStub();
  const bridge = createCinematicUiBridge({ client, autoProbe: false });
  await bridge.probe();

  client.emit({
    type: 'run:event',
    run: {
      run_id: 'run-choice',
      status: 'NEEDS_INPUT',
      conflicts: [{
        type: 'DUPLICATE_SLOT',
        category: 'top',
        reference_set_ids: ['shirt-a', 'shirt-b'],
      }],
    },
  });

  assert.equal(bridge.state().phase, 'needs_input');
  assert.deepEqual(bridge.state().choices, [{
    category: 'top',
    options: ['shirt-a', 'shirt-b'],
  }]);
  await bridge.selectGarments({ top: 'shirt-b' });
  assert.deepEqual(client.calls.at(-1), ['selectGarments', 'run-choice', { top: 'shirt-b' }]);
});
