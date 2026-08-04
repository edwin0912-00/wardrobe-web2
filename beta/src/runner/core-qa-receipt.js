import { sha256Object } from '../conditioning/hash-lineage.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PHASES = new Set(['conditioning', 'avatar', 'outfit']);
const DECISIONS = new Set(['PASS', 'RETRY', 'NEEDS_INPUT', 'REJECT']);
const EVALUATOR_TYPES = new Set(['MODEL', 'FIXTURE', 'REPLAY', 'ADAPTER', 'IMPORTED_RECEIPT']);
const PLACEHOLDER_METADATA = /(?:^|[._\s/@+-])(?:latest|current|unknown|unattested)(?:$|[._\s/@+-])/i;
const RUNNER_AUTHORITY = Object.freeze({
  owner: 'RUNNER',
  component: 'PIPELINE_RUNNER',
  version: '1.0.0',
});

const RECEIPT_KEYS = Object.freeze([
  'schema_version',
  'receipt_type',
  'authority',
  'phase',
  'attempt',
  'job_id',
  'run_id',
  'subject',
  'evidence',
  'evaluator',
  'decision',
  'reason',
  'checks',
  'defects',
  'receipt_id',
]);

function assertObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${field} must be a plain JSON object`);
  }
  return value;
}

function assertExactKeys(value, field, required, optional = []) {
  assertObject(value, field);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${field} contains unexpected property ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new Error(`${field}.${key} is required`);
  }
  return value;
}

function requireString(value, field, { maxLength = 2_000 } = {}) {
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()
    || value.length > maxLength) {
    throw new Error(`${field} must be an exact non-empty string`);
  }
  return value;
}

function requireExactMetadata(value, field) {
  const exact = requireString(value, field, { maxLength: 160 });
  if (PLACEHOLDER_METADATA.test(exact)) {
    throw new Error(`${field} must be an exact attested value, not a placeholder`);
  }
  return exact;
}

function requireSha256(value, field) {
  if (!SHA256.test(value ?? '')) throw new Error(`${field} must be a lowercase SHA-256`);
  return value;
}

function requireIdentifier(value, pattern, field) {
  const identifier = requireString(value, field, { maxLength: 128 });
  if (!pattern.test(identifier)) throw new Error(`${field} has an invalid format`);
  return identifier;
}

function normalizeAuthority(value) {
  assertExactKeys(value, 'Semantic QA authority', ['owner', 'component', 'version']);
  if (value.owner !== RUNNER_AUTHORITY.owner
    || value.component !== RUNNER_AUTHORITY.component
    || value.version !== RUNNER_AUTHORITY.version) {
    throw new Error('Core semantic QA receipts must be owned by the pipeline runner');
  }
  return { ...RUNNER_AUTHORITY };
}

function normalizeEvaluator(value) {
  assertExactKeys(
    value,
    'Semantic QA evaluator',
    ['type', 'provider', 'model', 'version', 'evaluation_id'],
  );
  if (!EVALUATOR_TYPES.has(value.type)) {
    throw new Error('Semantic QA evaluator type is invalid');
  }
  return {
    type: value.type,
    provider: requireExactMetadata(value.provider, 'Semantic QA evaluator provider'),
    model: requireExactMetadata(value.model, 'Semantic QA evaluator model'),
    version: requireExactMetadata(value.version, 'Semantic QA evaluator version'),
    evaluation_id: requireSha256(value.evaluation_id, 'Semantic QA evaluation_id'),
  };
}

function normalizeChecks(checks, { receiptInput = false } = {}) {
  if (!Array.isArray(checks) || checks.length === 0) {
    throw new Error('Semantic QA must include at least one required evidence-backed check');
  }
  const names = new Set();
  return checks.map((check, index) => {
    assertExactKeys(
      check,
      `Semantic QA check ${index}`,
      receiptInput
        ? ['name', 'required', 'pass', 'score', 'evidence']
        : ['name', 'pass', 'score', 'evidence'],
    );
    const name = requireString(check.name, `Semantic QA check ${index}.name`, { maxLength: 100 });
    if (names.has(name)) throw new Error(`Semantic QA contains duplicate check ${name}`);
    names.add(name);
    if (receiptInput && check.required !== true) {
      throw new Error(`Semantic QA check ${name} must remain required`);
    }
    if (typeof check.pass !== 'boolean') {
      throw new Error(`Semantic QA check ${name}.pass must be boolean`);
    }
    if (!Number.isFinite(check.score) || check.score < 0 || check.score > 1) {
      throw new Error(`Semantic QA check ${name}.score must be between 0 and 1`);
    }
    return {
      name,
      required: true,
      pass: check.pass,
      score: check.score,
      evidence: requireString(
        check.evidence,
        `Semantic QA check ${name}.evidence`,
        { maxLength: 500 },
      ),
    };
  });
}

function normalizeDefects(defects) {
  if (!Array.isArray(defects)) throw new Error('Semantic QA defects must be an array');
  const normalized = defects.map((defect, index) => requireString(
    defect,
    `Semantic QA defect ${index}`,
    { maxLength: 300 },
  ));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Semantic QA defects must be unique');
  }
  return normalized;
}

function normalizeSubject(subject) {
  assertExactKeys(subject, 'Semantic QA subject', ['kind', 'sha256', 'media_type']);
  return {
    kind: requireString(subject.kind, 'Semantic QA subject kind', { maxLength: 100 }),
    sha256: requireSha256(subject.sha256, 'Semantic QA subject sha256'),
    media_type: requireString(
      subject.media_type,
      'Semantic QA subject media_type',
      { maxLength: 100 },
    ),
  };
}

function normalizeBinding(binding, index) {
  assertExactKeys(
    binding,
    `Semantic QA evidence binding ${index}`,
    ['order', 'role', 'sha256'],
    [
      'binding_id',
      'reference_pack_sha256',
      'facts_sha256',
      'prepared_sha256',
    ],
  );
  if (!Number.isInteger(binding.order) || binding.order < 1) {
    throw new Error(`Semantic QA evidence binding ${index}.order must be a positive integer`);
  }
  return {
    order: binding.order,
    ...(binding.binding_id === undefined ? {} : {
      binding_id: requireString(
        binding.binding_id,
        `Semantic QA evidence binding ${index}.binding_id`,
        { maxLength: 180 },
      ),
    }),
    role: requireString(
      binding.role,
      `Semantic QA evidence binding ${index}.role`,
      { maxLength: 100 },
    ),
    sha256: requireSha256(
      binding.sha256,
      `Semantic QA evidence binding ${index}.sha256`,
    ),
    ...(binding.reference_pack_sha256 === undefined ? {} : {
      reference_pack_sha256: requireSha256(
        binding.reference_pack_sha256,
        `Semantic QA evidence binding ${index}.reference_pack_sha256`,
      ),
    }),
    ...(binding.facts_sha256 === undefined ? {} : {
      facts_sha256: requireSha256(
        binding.facts_sha256,
        `Semantic QA evidence binding ${index}.facts_sha256`,
      ),
    }),
    ...(binding.prepared_sha256 === undefined ? {} : {
      prepared_sha256: requireSha256(
        binding.prepared_sha256,
        `Semantic QA evidence binding ${index}.prepared_sha256`,
      ),
    }),
  };
}

function normalizeEvidence(evidence) {
  assertExactKeys(
    evidence,
    'Semantic QA evidence manifest',
    [
      'phase',
      'attempt',
      'job_hash',
      'execution_hash',
      'subject',
      'prompt_sha256',
      'bindings',
    ],
    ['schema_version', 'manifest_sha256'],
  );
  if (!Array.isArray(evidence.bindings) || evidence.bindings.length === 0) {
    throw new Error('Semantic QA evidence manifest must contain ordered bindings');
  }
  if (evidence.schema_version !== undefined && evidence.schema_version !== '1.0.0') {
    throw new Error('Semantic QA evidence schema version is unsupported');
  }
  const bindings = evidence.bindings.map(normalizeBinding);
  const bindingIds = new Set();
  for (const [index, binding] of bindings.entries()) {
    if (binding.order !== index + 1) {
      throw new Error('Semantic QA evidence binding order must be contiguous from 1');
    }
    if (binding.binding_id !== undefined) {
      if (bindingIds.has(binding.binding_id)) {
        throw new Error(`Semantic QA evidence repeats binding_id ${binding.binding_id}`);
      }
      bindingIds.add(binding.binding_id);
    }
  }
  const manifestCore = {
    schema_version: '1.0.0',
    phase: evidence.phase,
    attempt: evidence.attempt,
    job_hash: requireSha256(evidence.job_hash, 'Semantic QA evidence job_hash'),
    execution_hash: requireSha256(
      evidence.execution_hash,
      'Semantic QA evidence execution_hash',
    ),
    subject: normalizeSubject(evidence.subject),
    prompt_sha256: evidence.prompt_sha256 === null
      ? null
      : requireSha256(evidence.prompt_sha256, 'Semantic QA evidence prompt_sha256'),
    bindings,
  };
  if (!PHASES.has(manifestCore.phase)) throw new Error('Semantic QA evidence phase is invalid');
  if (!Number.isInteger(manifestCore.attempt) || manifestCore.attempt < 0) {
    throw new Error('Semantic QA evidence attempt is invalid');
  }
  const manifestSha256 = sha256Object(manifestCore);
  if (evidence.manifest_sha256 !== undefined
    && requireSha256(
      evidence.manifest_sha256,
      'Semantic QA evidence manifest_sha256',
    ) !== manifestSha256) {
    throw new Error('Semantic QA evidence manifest SHA-256 does not match its bindings');
  }
  return { ...manifestCore, manifest_sha256: manifestSha256 };
}

function normalizeResponse(response, { receiptInput = false } = {}) {
  assertExactKeys(
    response,
    'Semantic QA response',
    ['decision', 'reason', 'checks', 'defects', 'evaluator'],
  );
  if (!DECISIONS.has(response.decision)) throw new Error('Semantic QA decision is invalid');
  const checks = normalizeChecks(response.checks, { receiptInput });
  const defects = normalizeDefects(response.defects);
  if (response.decision === 'PASS' && checks.some((check) => !check.pass)) {
    throw new Error('Semantic QA PASS contains a failed required check');
  }
  if (response.decision === 'PASS' && defects.length > 0) {
    throw new Error('Semantic QA PASS contains blocking defects');
  }
  return {
    evaluator: normalizeEvaluator(response.evaluator),
    decision: response.decision,
    reason: requireString(response.reason, 'Semantic QA reason', { maxLength: 1_000 }),
    checks,
    defects,
  };
}

function buildReceipt({
  phase,
  attempt,
  jobId,
  runId,
  evidence,
  response,
  receiptInput = false,
}) {
  if (!PHASES.has(phase)) throw new Error(`Unsupported semantic QA phase: ${phase}`);
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error('Semantic QA attempt is invalid');
  const normalizedEvidence = normalizeEvidence(evidence);
  if (normalizedEvidence.phase !== phase || normalizedEvidence.attempt !== attempt) {
    throw new Error('Semantic QA evidence does not belong to this phase and attempt');
  }
  const normalizedResponse = normalizeResponse(response, { receiptInput });
  const core = {
    schema_version: '1.0.0',
    receipt_type: 'CORE_SEMANTIC_QA',
    authority: { ...RUNNER_AUTHORITY },
    phase,
    attempt,
    job_id: requireIdentifier(jobId, JOB_ID, 'Semantic QA job_id'),
    run_id: requireIdentifier(runId, RUN_ID, 'Semantic QA run_id'),
    subject: { ...normalizedEvidence.subject },
    evidence: normalizedEvidence,
    ...normalizedResponse,
  };
  return {
    ...core,
    receipt_id: sha256Object(core),
  };
}

export function createCoreQaReceipt({
  phase,
  attempt,
  jobId,
  runId,
  evidence,
  response,
}) {
  return buildReceipt({
    phase,
    attempt,
    jobId,
    runId,
    evidence,
    response,
    receiptInput: false,
  });
}

export function verifyCoreQaReceipt(document, {
  phase,
  attempt,
  jobId,
  runId,
  evidence,
  receiptId,
  requirePass = false,
} = {}) {
  assertExactKeys(document, 'Core semantic QA receipt', RECEIPT_KEYS);
  if (document.schema_version !== '1.0.0'
    || document.receipt_type !== 'CORE_SEMANTIC_QA') {
    throw new Error('Core semantic QA receipt type or schema version is invalid');
  }
  normalizeAuthority(document.authority);
  const rebuilt = buildReceipt({
    phase: document.phase,
    attempt: document.attempt,
    jobId: document.job_id,
    runId: document.run_id,
    evidence: document.evidence,
    response: {
      decision: document.decision,
      reason: document.reason,
      checks: document.checks,
      defects: document.defects,
      evaluator: document.evaluator,
    },
    receiptInput: true,
  });
  if (document.receipt_id !== rebuilt.receipt_id
    || document.subject.kind !== rebuilt.subject.kind
    || document.subject.sha256 !== rebuilt.subject.sha256
    || document.subject.media_type !== rebuilt.subject.media_type) {
    throw new Error('Core semantic QA receipt integrity check failed');
  }
  if (phase !== undefined && rebuilt.phase !== phase) {
    throw new Error('Core semantic QA receipt phase mismatch');
  }
  if (attempt !== undefined && rebuilt.attempt !== attempt) {
    throw new Error('Core semantic QA receipt attempt mismatch');
  }
  if (jobId !== undefined && rebuilt.job_id !== jobId) {
    throw new Error('Core semantic QA receipt job mismatch');
  }
  if (runId !== undefined && rebuilt.run_id !== runId) {
    throw new Error('Core semantic QA receipt run mismatch');
  }
  if (evidence !== undefined) {
    const expected = normalizeEvidence(evidence);
    if (rebuilt.evidence.manifest_sha256 !== expected.manifest_sha256) {
      throw new Error('Core semantic QA receipt is stale for the current evidence');
    }
  }
  if (receiptId !== undefined
    && requireSha256(receiptId, 'Expected core semantic QA receipt_id') !== rebuilt.receipt_id) {
    throw new Error('Core semantic QA receipt no longer matches its immutable receipt binding');
  }
  if (requirePass && rebuilt.decision !== 'PASS') {
    throw new Error('Core semantic QA receipt is not PASS');
  }
  return rebuilt;
}

export function qaResultFromReceipt(receipt, artifact) {
  const verified = verifyCoreQaReceipt(receipt);
  return {
    decision: verified.decision,
    reason: verified.reason,
    checks: verified.checks,
    defects: verified.defects,
    evaluator: verified.evaluator,
    subject_sha256: verified.subject.sha256,
    evidence_manifest_sha256: verified.evidence.manifest_sha256,
    prompt_sha256: verified.evidence.prompt_sha256,
    receipt_id: verified.receipt_id,
    artifact,
  };
}
