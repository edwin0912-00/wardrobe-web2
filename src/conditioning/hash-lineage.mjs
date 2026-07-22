import { createHash } from 'node:crypto';

import { invariant } from './errors.mjs';
import { readInputBytes } from './input.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function sha256Bytes(bytes) {
  invariant(
    Buffer.isBuffer(bytes) || bytes instanceof Uint8Array,
    'INVALID_HASH_INPUT',
    'sha256Bytes expects Buffer or Uint8Array.',
  );
  return createHash('sha256').update(bytes).digest('hex');
}

export async function sha256Input(input) {
  return sha256Bytes(await readInputBytes(input));
}

function canonicalize(value, path = '$') {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    invariant(Number.isFinite(value), 'NON_FINITE_NUMBER', `Non-finite number at ${path}.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  invariant(
    typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype,
    'NON_CANONICAL_VALUE',
    `Only JSON-compatible values can be canonicalized (${path}).`,
  );
  const result = {};
  for (const key of Object.keys(value).sort()) {
    invariant(value[key] !== undefined, 'UNDEFINED_VALUE', `Undefined value at ${path}.${key}.`);
    result[key] = canonicalize(value[key], `${path}.${key}`);
  }
  return result;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Object(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), 'utf8'));
}

function normalizeParent(parent, index) {
  invariant(parent && typeof parent === 'object', 'INVALID_PARENT', `Parent ${index} must be an object.`);
  invariant(typeof parent.assetId === 'string' && parent.assetId, 'INVALID_PARENT_ID', `Parent ${index} has no assetId.`);
  invariant(SHA256_PATTERN.test(parent.sha256), 'INVALID_PARENT_HASH', `Parent ${index} has an invalid SHA-256.`);
  return {
    asset_id: parent.assetId,
    sha256: parent.sha256,
    role: parent.role ?? 'SOURCE',
  };
}

/**
 * Builds content-addressed lineage. No clock is consulted, so identical inputs,
 * operations and bytes produce an identical lineage_id.
 */
export function createLineageRecord({
  artifactId,
  outputBytes,
  parents,
  operations,
  policyVersion = '1.0.0',
  recordedAt,
}) {
  invariant(typeof artifactId === 'string' && artifactId, 'INVALID_ARTIFACT_ID', 'artifactId is required.');
  invariant(Array.isArray(parents) && parents.length > 0, 'MISSING_PARENTS', 'At least one parent is required.');
  invariant(Array.isArray(operations), 'INVALID_OPERATIONS', 'operations must be an array.');

  const core = {
    schema_version: '1.0.0',
    artifact_id: artifactId,
    output_sha256: sha256Bytes(outputBytes),
    parents: parents.map(normalizeParent),
    operations: canonicalize(operations),
    policy_version: policyVersion,
  };
  const record = {
    ...core,
    lineage_id: sha256Object(core),
  };
  if (recordedAt !== undefined) {
    invariant(
      typeof recordedAt === 'string' && !Number.isNaN(Date.parse(recordedAt)),
      'INVALID_RECORDED_AT',
      'recordedAt must be an ISO-compatible date string.',
    );
    record.recorded_at = recordedAt;
  }
  return record;
}

export function verifyLineageRecord(record, outputBytes) {
  invariant(record && typeof record === 'object', 'INVALID_LINEAGE', 'Lineage record is required.');
  const { lineage_id: claimedId, recorded_at: _recordedAt, ...core } = record;
  const errors = [];
  if (!SHA256_PATTERN.test(claimedId ?? '')) errors.push('INVALID_LINEAGE_ID');
  else if (sha256Object(core) !== claimedId) errors.push('LINEAGE_ID_MISMATCH');
  if (outputBytes !== undefined && sha256Bytes(outputBytes) !== record.output_sha256) {
    errors.push('OUTPUT_HASH_MISMATCH');
  }
  return { valid: errors.length === 0, errors };
}
