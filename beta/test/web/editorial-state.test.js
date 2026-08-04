import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVE_EDITORIAL_SHOOT_KEY,
  clearEditorialResume,
  editorialCanCancel,
  editorialCanDelete,
  editorialIsTerminal,
  editorialResumeFromSnapshot,
  normalizeEditorialResume,
  readEditorialResume,
  safeEditorialOutputUrl,
  writeEditorialResume,
} from '../../web/public/editorial-state.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const record = {
  shoot_id: null,
  look_id: 'look_001',
  mode_id: 'editorial.edwin_novak.organic_contrast',
  mode_version: '1.0.0',
  create_idempotency_key: 'editorial-create-00000001',
  pending_action: {
    type: 'create',
    idempotency_key: 'editorial-create-action-0001',
    expected_sha256: null,
    slot: null,
  },
};

test('editorial resume state validates IDs, versions and typed pending actions', () => {
  assert.ok(normalizeEditorialResume(record));
  assert.equal(normalizeEditorialResume({ ...record, look_id: '../../private' }), null);
  assert.equal(normalizeEditorialResume({ ...record, mode_version: 'latest' }), null);
  assert.equal(normalizeEditorialResume({
    ...record,
    pending_action: { ...record.pending_action, type: 'delete' },
  }), null);
  assert.equal(normalizeEditorialResume({
    ...record,
    pending_action: {
      type: 'approve_hero',
      idempotency_key: 'hero-approval-000001',
      expected_sha256: null,
      slot: null,
    },
  }), null);
});

test('resume state round-trips and corrupted storage is cleared', () => {
  const storage = memoryStorage();
  const written = writeEditorialResume(record, storage);
  assert.deepEqual(readEditorialResume(storage), written);
  storage.setItem(ACTIVE_EDITORIAL_SHOOT_KEY, '{bad-json');
  assert.equal(readEditorialResume(storage), null);
  assert.equal(storage.getItem(ACTIVE_EDITORIAL_SHOOT_KEY), null);
  writeEditorialResume(record, storage);
  clearEditorialResume(storage);
  assert.equal(storage.getItem(ACTIVE_EDITORIAL_SHOOT_KEY), null);
});

test('snapshot recovery preserves request key and clears a completed pending action', () => {
  const recovered = editorialResumeFromSnapshot({
    shoot_id: 'shoot_001',
    bindings: {
      approved_look: { look_id: 'look_001' },
      shoot_bible: {
        mode_id: 'editorial.edwin_novak.organic_contrast',
        mode_version: '1.0.0',
      },
    },
  }, record);
  assert.equal(recovered.shoot_id, 'shoot_001');
  assert.equal(recovered.create_idempotency_key, record.create_idempotency_key);
  assert.equal(recovered.pending_action, null);
});

test('terminal actions and same-origin output URLs are fail-closed', () => {
  assert.equal(editorialIsTerminal({ status: 'COMPLETED' }), true);
  assert.equal(editorialCanDelete({ status: 'COMPLETED' }), true);
  assert.equal(editorialCanCancel({ status: 'COMPLETED' }), false);
  assert.equal(editorialCanCancel({ status: 'SERIES_RUNNING' }), true);
  assert.equal(
    safeEditorialOutputUrl('/api/profile/editorial-shoots/shoot_001/image', 'https://example.test/app'),
    '/api/profile/editorial-shoots/shoot_001/image',
  );
  assert.equal(
    safeEditorialOutputUrl('https://attacker.test/file', 'https://example.test/app'),
    null,
  );
  assert.equal(safeEditorialOutputUrl('file:///tmp/private', 'https://example.test/app'), null);
});
