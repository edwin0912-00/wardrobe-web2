import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalJson,
  createLineageRecord,
  sha256Bytes,
  sha256Object,
  verifyLineageRecord,
} from '../../src/conditioning/hash-lineage.mjs';

test('canonical JSON and object hashes ignore object key insertion order', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
  assert.equal(
    sha256Object({ second: 2, first: 1 }),
    sha256Object({ first: 1, second: 2 }),
  );
});

test('lineage is content addressed, deterministic, and detects byte tampering', () => {
  const source = Buffer.from('source');
  const output = Buffer.from('conditioned-output');
  const input = {
    artifactId: 'human-001-face-crop',
    outputBytes: output,
    parents: [{ assetId: 'human-001-raw', sha256: sha256Bytes(source), role: 'IDENTITY_AUTHORITY' }],
    operations: [{ type: 'EXPLICIT_BBOX_CROP', bbox: [0.1, 0.1, 0.4, 0.4] }],
  };
  const first = createLineageRecord(input);
  const second = createLineageRecord(input);

  assert.deepEqual(first, second);
  assert.deepEqual(verifyLineageRecord(first, output), { valid: true, errors: [] });
  assert.deepEqual(verifyLineageRecord(first, Buffer.from('tampered')), {
    valid: false,
    errors: ['OUTPUT_HASH_MISMATCH'],
  });
});
