import assert from 'node:assert/strict';
import test from 'node:test';
import { isDraftExpired, LOCAL_DRAFT_TTL_MS } from '../../web/public/draft-store.js';

test('browser-local image drafts expire after the same 15-minute window as server drafts', () => {
  const now = Date.parse('2026-07-22T12:30:00.000Z');
  assert.equal(isDraftExpired(new Date(now - LOCAL_DRAFT_TTL_MS).toISOString(), now), false);
  assert.equal(isDraftExpired(new Date(now - LOCAL_DRAFT_TTL_MS - 1).toISOString(), now), true);
  assert.equal(isDraftExpired('invalid', now), true);
});
