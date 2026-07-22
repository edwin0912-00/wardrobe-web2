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
  assert.deepEqual(
    await provider.qa({ phase: 'conditioning', attempt: 1 }),
    { decision: 'PASS', checks: [] },
  );
  provider.assertExhausted();
});

test('replay provider fails loudly on a non-matching call', async () => {
  const provider = new ReplayProvider({
    operations: [{ operation: 'generate', match: { phase: 'avatar' }, response: {} }],
  });
  await assert.rejects(() => provider.qa({ phase: 'avatar' }), /Replay mismatch/);
});
