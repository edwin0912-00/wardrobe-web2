import { createHash } from 'node:crypto';

export const EDITORIAL_SCHEMA_VERSION = '1.0.0';

export const EDITORIAL_SHOT_SLOTS = Object.freeze([
  'clean_identity_hero',
  'environmental_hero',
  'sculptural_three_quarter',
  'interference_frame',
  'material_or_accessory_detail',
  'wide_campaign_coda',
]);

export const EDITORIAL_HERO_SLOT = EDITORIAL_SHOT_SLOTS[0];

export const EDITORIAL_MODE_IDS = Object.freeze([
  'editorial.edwin_novak.organic_contrast',
  'editorial.edwin_novak.urban_monochrome',
  'editorial.edwin_novak.institutional_modernism',
  'editorial.edwin_novak.luminous_blue_white',
]);

export const EDITORIAL_QA_GATES = Object.freeze([
  'MASTER_LOOK_LOCK',
  'REFERENCE_ROLE_ISOLATION',
  'NEAR_COPY_AND_LEAKAGE',
  'IDENTITY',
  'ITEM_FIDELITY',
  'SCENE_MATCH',
  'LIGHT_AND_CONTACT_SHADOW',
  'FRAMING_AND_ANATOMY',
  'PROVENANCE',
]);

export const EDITORIAL_SHOOT_STATES = Object.freeze({
  BIBLE_PENDING_APPROVAL: 'BIBLE_PENDING_APPROVAL',
  HERO_RUNNING: 'HERO_RUNNING',
  HERO_PENDING_APPROVAL: 'HERO_PENDING_APPROVAL',
  SERIES_RUNNING: 'SERIES_RUNNING',
  NEEDS_RETRY: 'NEEDS_RETRY',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});

export const EDITORIAL_SHOT_STATES = Object.freeze({
  BLOCKED: 'BLOCKED',
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  QA_PASSED: 'QA_PASSED',
  APPROVED: 'APPROVED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

export const EDITORIAL_TERMINAL_SHOOT_STATES = new Set([
  EDITORIAL_SHOOT_STATES.COMPLETED,
  EDITORIAL_SHOOT_STATES.CANCELLED,
]);

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/;
const MODE_IDS = new Set(EDITORIAL_MODE_IDS);
const SOURCE_ROLES = new Set([
  'environment',
  'lighting',
  'composition',
  'pose',
  'palette',
  'optical_device',
  'material_detail',
]);
const FRAMINGS = new Set(['full_body', 'three_quarter', 'detail', 'wide_full_body']);
const IDENTITY_VISIBILITY = new Set(['full_face', 'partial_face', 'not_intended']);
const GATE_IDS = new Set(EDITORIAL_QA_GATES);
const SHOT_STATES = new Set(Object.values(EDITORIAL_SHOT_STATES));
const SHOOT_STATES = new Set(Object.values(EDITORIAL_SHOOT_STATES));

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

export function canonicalJsonBytes(value) {
  return Buffer.from(canonicalJson(value));
}

export function assertEditorialId(value, label = 'id') {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new Error(`${label} must contain only letters, numbers, dots, dashes, or underscores`);
  }
  return value;
}

export function assertEditorialSha256(value, label = 'sha256') {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256`);
  }
  return value;
}

export function assertEditorialIdempotencyKey(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 256) {
    throw new Error('idempotencyKey must contain between 8 and 256 characters');
  }
  return value;
}

function assertTimestamp(value, label) {
  if (typeof value !== 'string' || !TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an RFC 3339 UTC timestamp`);
  }
  return value;
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}`);
  }
}

function nonEmptyText(value, label, maximum = 2_000) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new Error(`${label} must be non-empty text no longer than ${maximum} characters`);
  }
  return value.trim();
}

function uniqueTexts(value, label, { minimum = 1, maximum = 20 } = {}) {
  if (!Array.isArray(value)
    || value.length < minimum
    || value.length > maximum
    || value.some((item) => typeof item !== 'string' || item.trim().length === 0 || item.length > 300)
    || new Set(value).size !== value.length) {
    throw new Error(`${label} must be a unique list of ${minimum}–${maximum} non-empty strings`);
  }
  return value.map((item) => item.trim());
}

export function validateEditorialApprovedLookReference(reference) {
  assertExactKeys(
    reference,
    ['look_id', 'image_sha256', 'receipt_sha256'],
    'approvedLookReference',
  );
  return Object.freeze({
    look_id: assertEditorialId(reference.look_id, 'approvedLookReference.look_id'),
    image_sha256: assertEditorialSha256(
      reference.image_sha256,
      'approvedLookReference.image_sha256',
    ),
    receipt_sha256: assertEditorialSha256(
      reference.receipt_sha256,
      'approvedLookReference.receipt_sha256',
    ),
  });
}

function validateSourceReference(reference, index) {
  const label = `ShootBible source_references[${index}]`;
  assertExactKeys(
    reference,
    ['reference_id', 'sha256', 'role', 'rights_basis', 'expires_at'],
    label,
  );
  if (!SOURCE_ROLES.has(reference.role)) {
    throw new Error(`${label}.role is not an approved reference authority`);
  }
  return {
    reference_id: assertEditorialId(reference.reference_id, `${label}.reference_id`),
    sha256: assertEditorialSha256(reference.sha256, `${label}.sha256`),
    role: reference.role,
    rights_basis: nonEmptyText(reference.rights_basis, `${label}.rights_basis`, 500),
    expires_at: assertTimestamp(reference.expires_at, `${label}.expires_at`),
  };
}

function validateCamera(camera, slot) {
  const label = `ShootBible ${slot} camera`;
  assertExactKeys(
    camera,
    ['lens_mm', 'framing', 'angle', 'subject_height_percent'],
    label,
  );
  if (!Number.isInteger(camera.lens_mm) || camera.lens_mm < 24 || camera.lens_mm > 135) {
    throw new Error(`${label}.lens_mm must be an integer from 24 to 135`);
  }
  if (!FRAMINGS.has(camera.framing)) throw new Error(`${label}.framing is unsupported`);
  nonEmptyText(camera.angle, `${label}.angle`, 300);
  if (!Array.isArray(camera.subject_height_percent)
    || camera.subject_height_percent.length !== 2
    || camera.subject_height_percent.some((item) => !Number.isFinite(item) || item < 20 || item > 95)
    || camera.subject_height_percent[0] >= camera.subject_height_percent[1]) {
    throw new Error(`${label}.subject_height_percent must be an ordered [min,max] percentage`);
  }
  return {
    lens_mm: camera.lens_mm,
    framing: camera.framing,
    angle: camera.angle.trim(),
    subject_height_percent: [...camera.subject_height_percent],
  };
}

function validateShotSpec(shot, index) {
  const expectedSlot = EDITORIAL_SHOT_SLOTS[index];
  const label = `ShootBible shots[${index}]`;
  assertExactKeys(
    shot,
    [
      'slot',
      'title',
      'objective',
      'camera',
      'pose',
      'lighting',
      'environment',
      'palette',
      'identity_visibility',
      'item_evidence',
      'optical_device',
      'negative_constraints',
    ],
    label,
  );
  if (shot.slot !== expectedSlot) {
    throw new Error(`${label}.slot must be ${expectedSlot}`);
  }
  if (!IDENTITY_VISIBILITY.has(shot.identity_visibility)) {
    throw new Error(`${label}.identity_visibility is unsupported`);
  }
  if (expectedSlot === EDITORIAL_HERO_SLOT && shot.identity_visibility !== 'full_face') {
    throw new Error('The clean identity hero must require full-face identity evidence');
  }
  const camera = validateCamera(shot.camera, expectedSlot);
  const requiredFraming = {
    clean_identity_hero: 'full_body',
    environmental_hero: 'full_body',
    sculptural_three_quarter: 'three_quarter',
    material_or_accessory_detail: 'detail',
    wide_campaign_coda: 'wide_full_body',
  }[expectedSlot];
  if (requiredFraming && camera.framing !== requiredFraming) {
    throw new Error(`${expectedSlot} must use ${requiredFraming} framing`);
  }
  if (expectedSlot === 'interference_frame') {
    nonEmptyText(shot.optical_device, `${label}.optical_device`, 300);
  } else if (shot.optical_device !== null) {
    throw new Error('Only the interference frame may declare one optical device');
  }
  return {
    slot: expectedSlot,
    title: nonEmptyText(shot.title, `${label}.title`, 200),
    objective: nonEmptyText(shot.objective, `${label}.objective`, 1_000),
    camera,
    pose: nonEmptyText(shot.pose, `${label}.pose`, 1_000),
    lighting: nonEmptyText(shot.lighting, `${label}.lighting`, 1_000),
    environment: nonEmptyText(shot.environment, `${label}.environment`, 1_000),
    palette: nonEmptyText(shot.palette, `${label}.palette`, 500),
    identity_visibility: shot.identity_visibility,
    item_evidence: uniqueTexts(shot.item_evidence, `${label}.item_evidence`),
    optical_device: shot.optical_device === null ? null : shot.optical_device.trim(),
    negative_constraints: uniqueTexts(
      shot.negative_constraints,
      `${label}.negative_constraints`,
      { minimum: 1, maximum: 30 },
    ),
  };
}

export function validateEditorialShootBible(bible) {
  assertExactKeys(
    bible,
    [
      'schema_version',
      'bible_id',
      'mode_id',
      'mode_version',
      'title',
      'visual_system',
      'source_references',
      'shots',
      'created_at',
    ],
    'ShootBible',
  );
  if (bible.schema_version !== EDITORIAL_SCHEMA_VERSION) {
    throw new Error(`ShootBible schema_version must be ${EDITORIAL_SCHEMA_VERSION}`);
  }
  if (!MODE_IDS.has(bible.mode_id)) throw new Error('ShootBible mode_id is not an Edwin mode');
  if (typeof bible.mode_version !== 'string' || !SEMVER.test(bible.mode_version)) {
    throw new Error('ShootBible mode_version must be an immutable semantic version');
  }
  if (!Array.isArray(bible.source_references)
    || bible.source_references.length < 1
    || bible.source_references.length > 20) {
    throw new Error('ShootBible source_references must contain 1–20 immutable bindings');
  }
  const sourceReferences = bible.source_references.map(validateSourceReference);
  if (new Set(sourceReferences.map((item) => item.reference_id)).size !== sourceReferences.length
    || new Set(sourceReferences.map((item) => item.sha256)).size !== sourceReferences.length) {
    throw new Error('ShootBible source references must have unique IDs and hashes');
  }
  if (!Array.isArray(bible.shots) || bible.shots.length !== EDITORIAL_SHOT_SLOTS.length) {
    throw new Error('ShootBible must contain exactly the six fixed editorial shot slots');
  }
  const normalized = {
    schema_version: EDITORIAL_SCHEMA_VERSION,
    bible_id: assertEditorialId(bible.bible_id, 'ShootBible.bible_id'),
    mode_id: bible.mode_id,
    mode_version: bible.mode_version,
    title: nonEmptyText(bible.title, 'ShootBible.title', 300),
    visual_system: nonEmptyText(bible.visual_system, 'ShootBible.visual_system', 2_000),
    source_references: sourceReferences,
    shots: bible.shots.map(validateShotSpec),
    created_at: assertTimestamp(bible.created_at, 'ShootBible.created_at'),
  };
  return Object.freeze(normalized);
}

function validateGate(gate, index) {
  const label = `shot QA gate[${index}]`;
  assertExactKeys(gate, ['id', 'decision', 'evidence', 'defects'], label);
  const expectedId = EDITORIAL_QA_GATES[index];
  if (gate.id !== expectedId || !GATE_IDS.has(gate.id)) {
    throw new Error(`${label}.id must be ${expectedId}`);
  }
  if (!['PASS', 'FAIL'].includes(gate.decision)) {
    throw new Error(`${label}.decision must be PASS or FAIL`);
  }
  const defects = uniqueTexts(gate.defects, `${label}.defects`, {
    minimum: gate.decision === 'FAIL' ? 1 : 0,
    maximum: 30,
  });
  if (gate.decision === 'PASS' && defects.length !== 0) {
    throw new Error(`${label} cannot declare defects while passing`);
  }
  return {
    id: gate.id,
    decision: gate.decision,
    evidence: nonEmptyText(gate.evidence, `${label}.evidence`, 2_000),
    defects,
  };
}

export function validateEditorialExecutionResult(result, {
  approvedLookSha256,
  bibleSha256,
  shotSpecSha256,
}) {
  assertExactKeys(result, ['decision', 'execution_id', 'output', 'qa'], 'Editorial scene executor result');
  if (!['PASS', 'FAIL'].includes(result.decision)) {
    throw new Error('Editorial scene executor decision must be PASS or FAIL');
  }
  assertExactKeys(
    result.qa,
    [
      'decision',
      'candidate_sha256',
      'approved_look_sha256',
      'bible_sha256',
      'shot_spec_sha256',
      'gates',
      'reviewer',
      'completed_at',
    ],
    'Editorial shot QA',
  );
  if (result.qa.decision !== result.decision) {
    throw new Error('Editorial executor and QA decisions must match');
  }
  assertEditorialSha256(result.qa.candidate_sha256, 'Editorial QA candidate_sha256');
  if (result.qa.approved_look_sha256 !== approvedLookSha256
    || result.qa.bible_sha256 !== bibleSha256
    || result.qa.shot_spec_sha256 !== shotSpecSha256) {
    throw new Error('Editorial QA is not bound to the exact look, ShootBible, and shot spec');
  }
  if (!Array.isArray(result.qa.gates) || result.qa.gates.length !== EDITORIAL_QA_GATES.length) {
    throw new Error('Editorial QA must contain all nine ordered blocking gates');
  }
  const gates = result.qa.gates.map(validateGate);
  const allPass = gates.every((gate) => gate.decision === 'PASS');
  if ((result.decision === 'PASS') !== allPass) {
    throw new Error('Editorial PASS requires all nine gates and FAIL requires a blocking defect');
  }
  assertExactKeys(result.qa.reviewer, ['id', 'version', 'request_id'], 'Editorial QA reviewer');
  const qa = {
    decision: result.decision,
    candidate_sha256: result.qa.candidate_sha256,
    approved_look_sha256: result.qa.approved_look_sha256,
    bible_sha256: result.qa.bible_sha256,
    shot_spec_sha256: result.qa.shot_spec_sha256,
    gates,
    reviewer: {
      id: assertEditorialId(result.qa.reviewer.id, 'Editorial QA reviewer.id'),
      version: nonEmptyText(result.qa.reviewer.version, 'Editorial QA reviewer.version', 200),
      request_id: assertEditorialId(
        result.qa.reviewer.request_id,
        'Editorial QA reviewer.request_id',
      ),
    },
    completed_at: assertTimestamp(result.qa.completed_at, 'Editorial QA completed_at'),
  };
  let output = null;
  if (result.decision === 'PASS') {
    assertExactKeys(
      result.output,
      ['resource_id', 'sha256', 'receipt_sha256', 'width', 'height', 'media_type'],
      'Editorial executor output',
    );
    output = {
      resource_id: assertEditorialId(result.output.resource_id, 'Editorial output.resource_id'),
      sha256: assertEditorialSha256(result.output.sha256, 'Editorial output.sha256'),
      receipt_sha256: assertEditorialSha256(
        result.output.receipt_sha256,
        'Editorial output.receipt_sha256',
      ),
      width: result.output.width,
      height: result.output.height,
      media_type: result.output.media_type,
    };
    if (output.sha256 !== qa.candidate_sha256) {
      throw new Error('Editorial output and QA candidate hashes must match');
    }
    if (output.width !== 1024 || output.height !== 1280 || output.media_type !== 'image/png') {
      throw new Error('Editorial output must be exact 1024×1280 lossless PNG');
    }
  } else if (result.output !== null) {
    throw new Error('A failed editorial shot cannot publish an output');
  }
  return {
    decision: result.decision,
    execution_id: assertEditorialId(result.execution_id, 'Editorial result.execution_id'),
    output,
    qa,
  };
}

export function editorialShotSpecSha256(shotSpec) {
  return sha256(canonicalJsonBytes(shotSpec));
}

export function editorialStateSha256(state) {
  const copy = structuredClone(state);
  delete copy.state_integrity_sha256;
  return sha256(canonicalJsonBytes(copy));
}

export function validatePersistedEditorialShoot(state, expectedShootId = null) {
  assertExactKeys(state, [
    'schema_version',
    'shoot_id',
    'state_revision',
    'state_integrity_sha256',
    'request_fingerprint',
    'idempotency_hash',
    'status',
    'phase',
    'message',
    'created_at',
    'updated_at',
    'event_cursor',
    'bindings',
    'bible_approval',
    'hero_approval',
    'retry_requests',
    'shots',
    'cancellation',
  ], 'Persisted editorial shoot');
  if (state.schema_version !== EDITORIAL_SCHEMA_VERSION) {
    throw new Error('Persisted editorial shoot has an unsupported schema version');
  }
  assertEditorialId(state.shoot_id, 'shoot_id');
  if (expectedShootId && state.shoot_id !== expectedShootId) {
    throw new Error('Persisted editorial shoot ID does not match its directory');
  }
  if (!Number.isInteger(state.state_revision) || state.state_revision < 1) {
    throw new Error('Persisted editorial state_revision must be positive');
  }
  if (!Number.isInteger(state.event_cursor) || state.event_cursor < 1) {
    throw new Error('Persisted editorial event_cursor must be positive');
  }
  assertEditorialSha256(state.request_fingerprint, 'request_fingerprint');
  assertEditorialSha256(state.idempotency_hash, 'idempotency_hash');
  assertEditorialSha256(state.state_integrity_sha256, 'state_integrity_sha256');
  if (state.state_integrity_sha256 !== editorialStateSha256(state)) {
    throw new Error('Persisted editorial shoot state integrity hash does not match');
  }
  if (!SHOOT_STATES.has(state.status)) throw new Error('Persisted editorial shoot status is invalid');
  nonEmptyText(state.phase, 'Persisted editorial phase', 100);
  if (typeof state.message !== 'string' || state.message.length > 500) {
    throw new Error('Persisted editorial message is invalid');
  }
  assertTimestamp(state.created_at, 'created_at');
  assertTimestamp(state.updated_at, 'updated_at');
  assertExactKeys(
    state.bindings,
    ['approved_look', 'shoot_bible'],
    'Persisted editorial bindings',
  );
  validateEditorialApprovedLookReference(state.bindings.approved_look);
  assertExactKeys(
    state.bindings.shoot_bible,
    ['bible_id', 'mode_id', 'mode_version', 'sha256', 'relative_path', 'shot_spec_hashes'],
    'Persisted ShootBible binding',
  );
  assertEditorialId(state.bindings.shoot_bible.bible_id, 'ShootBible binding bible_id');
  if (!MODE_IDS.has(state.bindings.shoot_bible.mode_id)) throw new Error('ShootBible binding mode invalid');
  if (typeof state.bindings.shoot_bible.mode_version !== 'string'
    || !SEMVER.test(state.bindings.shoot_bible.mode_version)) {
    throw new Error('ShootBible binding mode_version is invalid');
  }
  assertEditorialSha256(state.bindings.shoot_bible.sha256, 'ShootBible binding sha256');
  if (state.bindings.shoot_bible.relative_path !== 'inputs/shoot-bible.json') {
    throw new Error('ShootBible must use the private immutable snapshot path');
  }
  const specHashes = state.bindings.shoot_bible.shot_spec_hashes;
  if (!specHashes || Object.keys(specHashes).length !== EDITORIAL_SHOT_SLOTS.length) {
    throw new Error('Persisted ShootBible must bind all six shot spec hashes');
  }
  for (const slot of EDITORIAL_SHOT_SLOTS) {
    assertEditorialSha256(specHashes[slot], `shot spec hash ${slot}`);
  }
  const validateApprovalTimestamp = (approval, label) => {
    if (approval === null) return;
    assertExactKeys(
      approval,
      label === 'bible_approval'
        ? ['idempotency_hash', 'bible_sha256', 'authority', 'approved_at']
        : ['idempotency_hash', 'output_sha256', 'receipt_sha256', 'authority', 'approved_at'],
      `Persisted ${label}`,
    );
    assertEditorialSha256(approval.idempotency_hash, `${label}.idempotency_hash`);
    if (approval.authority !== 'EXPLICIT_API_APPROVAL') {
      throw new Error(`${label}.authority is invalid`);
    }
    assertTimestamp(approval.approved_at, `${label}.approved_at`);
    if (label === 'bible_approval') {
      if (approval.bible_sha256 !== state.bindings.shoot_bible.sha256) {
        throw new Error('Persisted ShootBible approval changed its exact hash');
      }
    } else {
      assertEditorialSha256(approval.output_sha256, `${label}.output_sha256`);
      assertEditorialSha256(approval.receipt_sha256, `${label}.receipt_sha256`);
    }
  };
  validateApprovalTimestamp(state.bible_approval, 'bible_approval');
  validateApprovalTimestamp(state.hero_approval, 'hero_approval');

  if (!Array.isArray(state.retry_requests)) {
    throw new Error('Persisted editorial retry_requests must be an array');
  }
  const retryKeys = new Set();
  for (const [index, request] of state.retry_requests.entries()) {
    assertExactKeys(
      request,
      ['idempotency_hash', 'request_fingerprint', 'slot', 'requested_at'],
      `Persisted retry request[${index}]`,
    );
    assertEditorialSha256(request.idempotency_hash, `retry request[${index}].idempotency_hash`);
    assertEditorialSha256(request.request_fingerprint, `retry request[${index}].request_fingerprint`);
    if (!EDITORIAL_SHOT_SLOTS.includes(request.slot)) {
      throw new Error(`Persisted retry request[${index}] has an invalid slot`);
    }
    assertTimestamp(request.requested_at, `retry request[${index}].requested_at`);
    if (retryKeys.has(request.idempotency_hash)) {
      throw new Error('Persisted editorial retry idempotency hashes must be unique');
    }
    retryKeys.add(request.idempotency_hash);
  }

  const validateOutput = (output, label) => {
    if (output === null) return null;
    assertExactKeys(
      output,
      ['resource_id', 'sha256', 'receipt_sha256', 'width', 'height', 'media_type'],
      label,
    );
    assertEditorialId(output.resource_id, `${label}.resource_id`);
    assertEditorialSha256(output.sha256, `${label}.sha256`);
    assertEditorialSha256(output.receipt_sha256, `${label}.receipt_sha256`);
    if (output.width !== 1024 || output.height !== 1280 || output.media_type !== 'image/png') {
      throw new Error(`${label} must be exact 1024×1280 PNG`);
    }
    return output;
  };

  const validateError = (error, label) => {
    if (error === null) return;
    assertExactKeys(error, ['code', 'message'], label);
    nonEmptyText(error.code, `${label}.code`, 100);
    if (typeof error.message !== 'string' || error.message.length > 500) {
      throw new Error(`${label}.message is invalid`);
    }
  };

  if (!Array.isArray(state.shots) || state.shots.length !== EDITORIAL_SHOT_SLOTS.length) {
    throw new Error('Persisted editorial shoot must retain all six slots');
  }
  for (const [index, shot] of state.shots.entries()) {
    const slot = EDITORIAL_SHOT_SLOTS[index];
    assertExactKeys(
      shot,
      [
        'slot',
        'status',
        'shot_spec_sha256',
        'retry_count',
        'attempts',
        'output',
        'error',
        'lease',
      ],
      `Persisted editorial shot ${slot}`,
    );
    if (shot.slot !== slot || !SHOT_STATES.has(shot.status)) {
      throw new Error(`Persisted editorial shot ${slot} has invalid slot or status`);
    }
    if (shot.shot_spec_sha256 !== specHashes[slot]) {
      throw new Error(`Persisted editorial shot ${slot} changed its ShootBible spec`);
    }
    if (!Number.isInteger(shot.retry_count) || shot.retry_count < 0) {
      throw new Error(`Persisted editorial shot ${slot} retry_count is invalid`);
    }
    validateOutput(shot.output, `Persisted editorial shot ${slot} output`);
    validateError(shot.error, `Persisted editorial shot ${slot} error`);
    if (shot.lease !== null) {
      assertExactKeys(
        shot.lease,
        [
          'owner_id',
          'owner_pid',
          'owner_process_started_at',
          'operation_id',
          'acquired_at',
          'expires_at',
        ],
        `Persisted editorial shot ${slot} lease`,
      );
      assertEditorialId(shot.lease.owner_id, `Persisted editorial ${slot} lease.owner_id`);
      if (!Number.isInteger(shot.lease.owner_pid) || shot.lease.owner_pid < 1) {
        throw new Error(`Persisted editorial ${slot} lease.owner_pid is invalid`);
      }
      assertTimestamp(
        shot.lease.owner_process_started_at,
        `Persisted editorial ${slot} lease.owner_process_started_at`,
      );
      assertEditorialId(shot.lease.operation_id, `Persisted editorial ${slot} lease.operation_id`);
      assertTimestamp(shot.lease.acquired_at, `Persisted editorial ${slot} lease.acquired_at`);
      assertTimestamp(shot.lease.expires_at, `Persisted editorial ${slot} lease.expires_at`);
      if (Date.parse(shot.lease.expires_at) <= Date.parse(shot.lease.acquired_at)) {
        throw new Error(`Persisted editorial ${slot} lease expiry is not after acquisition`);
      }
    }
    if ((shot.status === EDITORIAL_SHOT_STATES.RUNNING) !== (shot.lease !== null)) {
      throw new Error(`Persisted editorial shot ${slot} lease does not match RUNNING state`);
    }
    if (!Array.isArray(shot.attempts)) throw new Error(`Persisted editorial shot ${slot} attempts invalid`);
    for (const [attemptIndex, attempt] of shot.attempts.entries()) {
      assertExactKeys(
        attempt,
        [
          'number',
          'operation_id',
          'execution_idempotency_key',
          'status',
          'started_at',
          'completed_at',
          'execution_id',
          'output',
          'qa',
          'error',
        ],
        `Persisted editorial ${slot} attempt[${attemptIndex}]`,
      );
      if (attempt.number !== attemptIndex + 1) {
        throw new Error(`Persisted editorial shot ${slot} attempt numbering is not contiguous`);
      }
      assertEditorialId(attempt.operation_id, `Persisted editorial ${slot} operation_id`);
      assertEditorialSha256(
        attempt.execution_idempotency_key,
        `Persisted editorial ${slot} execution idempotency key`,
      );
      if (!['RUNNING', 'PASS', 'FAIL', 'CANCELLED'].includes(attempt.status)) {
        throw new Error(`Persisted editorial shot ${slot} attempt status is invalid`);
      }
      assertTimestamp(attempt.started_at, `Persisted editorial ${slot} attempt.started_at`);
      if (attempt.completed_at !== null) {
        assertTimestamp(attempt.completed_at, `Persisted editorial ${slot} attempt.completed_at`);
      }
      if ((attempt.status === 'RUNNING') !== (attempt.completed_at === null)) {
        throw new Error(`Persisted editorial ${slot} attempt completion does not match status`);
      }
      if (attempt.execution_id !== null) {
        assertEditorialId(attempt.execution_id, `Persisted editorial ${slot} attempt.execution_id`);
      }
      validateOutput(attempt.output, `Persisted editorial ${slot} attempt.output`);
      validateError(attempt.error, `Persisted editorial ${slot} attempt.error`);
      if (attempt.qa !== null) {
        validateEditorialExecutionResult({
          decision: attempt.qa.decision,
          execution_id: attempt.execution_id,
          output: attempt.output,
          qa: attempt.qa,
        }, {
          approvedLookSha256: state.bindings.approved_look.image_sha256,
          bibleSha256: state.bindings.shoot_bible.sha256,
          shotSpecSha256: shot.shot_spec_sha256,
        });
        if (attempt.status !== attempt.qa.decision) {
          throw new Error(`Persisted editorial ${slot} attempt status does not match QA decision`);
        }
      } else if (attempt.output !== null) {
        throw new Error(`Persisted editorial ${slot} attempt output lacks exact-hash QA`);
      }
      if (attempt.output && attempt.output.sha256 !== attempt.qa?.candidate_sha256) {
        throw new Error(`Persisted editorial shot ${slot} output is not bound to its QA`);
      }
    }
    if (shot.output !== null
      && shot.output.sha256 !== shot.attempts.at(-1)?.output?.sha256) {
      throw new Error(`Persisted editorial shot ${slot} output differs from its latest attempt`);
    }
    if (['QA_PASSED', 'APPROVED'].includes(shot.status)) {
      const attempt = shot.attempts.at(-1);
      if (!attempt || attempt.status !== 'PASS' || !attempt.output || attempt.qa?.decision !== 'PASS') {
        throw new Error(`Persisted editorial shot ${slot} lacks its exact PASS attempt`);
      }
    }
  }
  const hero = state.shots[0];
  const heroApproved = hero.status === EDITORIAL_SHOT_STATES.APPROVED;
  if (state.hero_approval) {
    if (!heroApproved
      || state.hero_approval.output_sha256 !== hero.output?.sha256
      || state.hero_approval.receipt_sha256 !== hero.output?.receipt_sha256) {
      throw new Error('Persisted hero approval is not bound to the approved hero output');
    }
  }
  if (!heroApproved && state.shots.slice(1).some((shot) => shot.status !== EDITORIAL_SHOT_STATES.BLOCKED
    && shot.status !== EDITORIAL_SHOT_STATES.CANCELLED)) {
    throw new Error('Editorial hero barrier was bypassed in persisted state');
  }
  if (state.status === EDITORIAL_SHOOT_STATES.COMPLETED
    && state.shots.some((shot) => shot.status !== EDITORIAL_SHOT_STATES.APPROVED)) {
    throw new Error('A completed editorial shoot must have six approved exact-hash shots');
  }
  if (state.cancellation !== null) {
    assertExactKeys(
      state.cancellation,
      ['reason', 'cancelled_at'],
      'Persisted editorial cancellation',
    );
    if (typeof state.cancellation.reason !== 'string' || state.cancellation.reason.length > 300) {
      throw new Error('Persisted editorial cancellation reason is invalid');
    }
    assertTimestamp(state.cancellation.cancelled_at, 'Persisted editorial cancellation.cancelled_at');
  }
  if ((state.status === EDITORIAL_SHOOT_STATES.CANCELLED) !== (state.cancellation !== null)) {
    throw new Error('Persisted editorial cancellation does not match shoot status');
  }
  return state;
}
