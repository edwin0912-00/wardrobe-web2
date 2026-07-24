import assert from 'node:assert/strict';
import test from 'node:test';
import { ReplayProvider } from '../../src/providers/replay-provider.js';

test('replay provider enforces operation order and match fields', async () => {
  const provider = new ReplayProvider({
    operations: [
      {
        operation: 'qa',
        match: { phase: 'conditioning', attempt: 1 },
        response: { decision: 'PASS', checks: [] },
      },
    ],
  });
  const result = await provider.qa({ phase: 'conditioning', attempt: 1 });
  assert.equal(result.decision, 'PASS');
  assert.deepEqual(result.checks, [{
    name: 'REPLAY_SEMANTIC_QA',
    pass: true,
    score: 1,
    evidence: 'Recorded replay decision: PASS',
  }]);
  assert.equal(result.reason, 'Recorded replay decision: PASS');
  assert.deepEqual(result.defects, []);
  assert.equal(result.evaluator.type, 'REPLAY');
  assert.equal(result.evaluator.provider, 'replay-provider');
  assert.equal(result.evaluator.model, 'recorded-fixture');
  assert.equal(result.evaluator.version, '1.0.0');
  assert.match(result.evaluator.evaluation_id, /^[a-f0-9]{64}$/);
  provider.assertExhausted();
});

test('replay provider fails loudly on a non-matching call', async () => {
  const provider = new ReplayProvider({
    operations: [{ operation: 'generate', match: { phase: 'avatar' }, response: {} }],
  });
  await assert.rejects(() => provider.qa({ phase: 'avatar' }), /Replay mismatch/);
});
