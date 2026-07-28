import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MotionService, MotionServiceError, motionJobIdForIdempotencyKey } from '../../src/web/motion-service.js';
import { loadMotionModes, motionModeById, publicMotionModes } from '../../src/web/motion-modes.js';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const LOOK_SHA = sha256(Buffer.from('immutable-approved-look'));
const REF_SHA = sha256(Buffer.from('cut-out-on-white'));
const CLIP = Buffer.from('a fifteen second vertical clip');
const TRACK_SHA = sha256(Buffer.from('trippy downtempo bed'));

function monotonicClock(start) {
  let current = new Date(start).getTime();
  return () => {
    const value = new Date(current);
    current += 1_000;
    return value;
  };
}

function references(roles) {
  return roles.map((role) => ({
    role,
    kind: role === 'environment_motion' ? 'video' : 'image',
    sha256: REF_SHA,
    background_free: role !== 'environment_motion',
    ...(role === 'environment_motion' ? { excludes_foreign_footwear: true, seconds: 3 } : {}),
  }));
}

// The executor stands in for an MCP-capable agent. It memoises on the idempotency key the
// service hands it, because that key is the only thing preventing a retry from paying twice.
class FakeMotionExecutor {
  constructor({ receiptFor = null, throwOnce = false } = {}) {
    this.invocations = [];
    this.byKey = new Map();
    this.receiptFor = receiptFor;
    this.throwOnce = throwOnce;
  }

  async executeMotion(context) {
    this.invocations.push(context);
    if (this.throwOnce) {
      this.throwOnce = false;
      throw new Error('the provider session dropped');
    }
    if (this.byKey.has(context.idempotency_key)) return this.byKey.get(context.idempotency_key);
    const receipt = this.receiptFor
      ? this.receiptFor(context)
      : {
        output_sha256: sha256(CLIP),
        width: 1080,
        height: 1920,
        duration_seconds: context.job.delivery.duration_seconds + 0.07,
        fulfilled_at: '2026-07-28T12:05:00.000Z',
        provider: 'magnific-mcp',
        cut_count: 19,
        audio_replaced: true,
      };
    const result = { execution_id: `exec_${context.attempt}`, receipt, bytes: CLIP };
    this.byKey.set(context.idempotency_key, result);
    return result;
  }
}

async function fixture(t, { executor = new FakeMotionExecutor() } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-motion-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new MotionService({
    rootDirectory: root,
    motionExecutor: executor,
    projectRoot,
    clock: monotonicClock('2026-07-28T12:00:00.000Z'),
  });
  await service.initialize();
  return { root, service, executor };
}

function artRequest(overrides = {}) {
  return {
    idempotencyKey: 'motion-art-0001',
    modeId: 'motion.art_fashion_shoot.default',
    source: {
      look_id: 'look-abcdef12',
      look_image_sha256: LOOK_SHA,
      scene_kind: 'art_fashion_shoot',
      style_unit_id: 'shoot.zayn_institutional',
    },
    references: references(['identity', 'face', 'footwear_detail', 'environment_motion']),
    audio: { source: 'muxed_in_post', track_sha256: TRACK_SHA },
    ...overrides,
  };
}

test('the catalogue loads, validates against its schema and passes its own invariants', async () => {
  const catalogue = await loadMotionModes({ projectRoot });
  assert.equal(catalogue.route_policy.transport, 'MCP');
  assert.ok(catalogue.modes.length >= 2);
  for (const mode of catalogue.modes) {
    assert.equal(mode.billable, true);
    assert.ok(mode.reference_roles.includes('footwear_detail'));
  }
  // The public projection must not publish a model slug — a client that learns it will
  // eventually try to send one.
  const projected = JSON.stringify(publicMotionModes(catalogue));
  assert.ok(!projected.includes('seedance'));
  assert.ok(!projected.includes('gemini'));
});

test('creating a job spends nothing and is idempotent by key', async (t) => {
  const current = await fixture(t);
  const created = await current.service.createJob(artRequest());
  assert.equal(created.status, 'PLANNED');
  assert.equal(created.job_id, motionJobIdForIdempotencyKey('motion-art-0001'));
  assert.equal(created.attempt_count, 0);
  assert.equal(current.executor.invocations.length, 0);

  const again = await current.service.createJob(artRequest());
  assert.deepEqual(again, created);
  assert.equal(current.executor.invocations.length, 0);
});

test('one key cannot be reused for a different job', async (t) => {
  const current = await fixture(t);
  await current.service.createJob(artRequest());
  await assert.rejects(
    () => current.service.createJob(artRequest({
      source: { ...artRequest().source, style_unit_id: 'shoot.terracotta_hardlight' },
    })),
    (error) => error instanceof MotionServiceError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('the route comes from the mode and a caller cannot name a model', async (t) => {
  const current = await fixture(t);
  await assert.rejects(
    () => current.service.createJob(artRequest({ modeId: 'motion.art_fashion_shoot.whatever' })),
    (error) => error.code === 'MOTION_MODE_NOT_ALLOWED',
  );

  const created = await current.service.createJob(artRequest());
  const persisted = JSON.parse(await readFile(current.service.statePath(created.job_id), 'utf8'));
  assert.equal(persisted.job.route.model_slug, 'bytedance-seedance-pro-2.0');
  assert.equal(persisted.job.route.transport, 'mcp');
  assert.equal(persisted.job.delivery.duration_seconds, 15);
  assert.equal(persisted.job.delivery.resolution, '1080p');
});

test('a mode refuses a scene kind it does not serve, and a role it does not carry', async (t) => {
  const current = await fixture(t);
  await assert.rejects(
    () => current.service.createJob(artRequest({
      source: { ...artRequest().source, scene_kind: 'standard_background' },
    })),
    (error) => error.code === 'MOTION_SOURCE_KIND_MISMATCH',
  );

  const catalogue = await loadMotionModes({ projectRoot });
  const omni = motionModeById(catalogue, 'motion.standard_background.default');
  assert.ok(!omni.reference_roles.includes('hem_detail'));
  await assert.rejects(
    () => current.service.createJob({
      idempotencyKey: 'motion-omni-0001',
      modeId: 'motion.standard_background.default',
      source: { look_id: 'look-abcdef12', look_image_sha256: LOOK_SHA, scene_kind: 'standard_background', style_unit_id: null },
      references: references(['identity', 'hem_detail', 'footwear_detail', 'environment_motion']),
      audio: { source: 'muxed_in_post', track_sha256: TRACK_SHA },
    }),
    (error) => error.code === 'MOTION_REFERENCE_ROLE_NOT_ALLOWED',
  );
});

test('contract defects surface as one refusal carrying every code', async (t) => {
  const current = await fixture(t);
  // A person reference that brought its own environment. Half a fifteen-second reel once
  // relocated to a garden because of exactly this.
  const leaky = references(['identity', 'footwear_detail', 'environment_motion']);
  leaky[0].background_free = false;
  await assert.rejects(
    () => current.service.createJob(artRequest({ references: leaky })),
    (error) => error.code === 'MOTION_JOB_INVALID'
      && error.defects.some((defect) => defect.code === 'PERSON_REFERENCE_CARRIES_BACKGROUND'),
  );
});

test('generation refuses to run without an explicit paid confirmation', async (t) => {
  const current = await fixture(t);
  const created = await current.service.createJob(artRequest());
  await assert.rejects(
    () => current.service.runJob(created.job_id, { idempotencyKey: 'run-key-0001' }),
    (error) => error.code === 'PAID_CREATE_NOT_CONFIRMED',
  );
  assert.equal(current.executor.invocations.length, 0);
});

test('a confirmed run delivers a hash-addressed clip and the events to match', async (t) => {
  const current = await fixture(t);
  const created = await current.service.createJob(artRequest());
  const delivered = await current.service.runJob(created.job_id, {
    idempotencyKey: 'run-key-0001',
    confirmPaidCreate: true,
  });

  assert.equal(delivered.status, 'DELIVERED');
  assert.equal(delivered.output.sha256, sha256(CLIP));
  assert.equal(delivered.output.width, 1080);
  assert.equal(delivered.output.height, 1920);
  assert.equal(delivered.output.audio_replaced, true);

  const filename = await current.service.outputFile(created.job_id, { expectedSha256: sha256(CLIP) });
  assert.ok(filename);
  assert.ok((await readFile(filename)).equals(CLIP));
  // A wrong hash is a miss, not a redirect to whatever is stored.
  assert.equal(await current.service.outputFile(created.job_id, { expectedSha256: sha256(Buffer.from('other')) }), null);

  const events = await current.service.listEvents(created.job_id);
  assert.deepEqual(events.map((event) => event.type), [
    'MOTION_JOB_PLANNED',
    'MOTION_ATTEMPT_STARTED',
    'MOTION_JOB_DELIVERED',
  ]);

  // State stores a relative path only: an absolute runtime path in a persisted document
  // leaks the host layout the moment the document is served.
  const persisted = JSON.parse(await readFile(current.service.statePath(created.job_id), 'utf8'));
  assert.equal(persisted.output.relative_path, path.join('outputs', `${sha256(CLIP)}.mp4`));
  assert.ok(!JSON.stringify(persisted).includes(os.tmpdir()));
});

test('a receipt that misses the delivery is refused and no clip is saved', async (t) => {
  const executor = new FakeMotionExecutor({
    receiptFor: () => ({
      output_sha256: sha256(CLIP),
      width: 1248,
      height: 1664,
      duration_seconds: 6,
      fulfilled_at: '2026-07-28T12:05:00.000Z',
      provider: 'magnific-mcp',
      cut_count: 4,
      audio_replaced: false,
    }),
  });
  const current = await fixture(t, { executor });
  const created = await current.service.createJob(artRequest());
  const refused = await current.service.runJob(created.job_id, {
    idempotencyKey: 'run-key-0001',
    confirmPaidCreate: true,
  });

  assert.equal(refused.status, 'REFUSED');
  assert.equal(refused.output, null);
  assert.equal(await current.service.outputFile(created.job_id), null);

  // Every defect is on the record, including the invented audio track that must never ship.
  const persisted = JSON.parse(await readFile(current.service.statePath(created.job_id), 'utf8'));
  const codes = persisted.attempts[0].defects.map((defect) => defect.code);
  assert.ok(codes.includes('DELIVERED_GEOMETRY_NOT_VERTICAL'));
  assert.ok(codes.includes('DELIVERED_DURATION_OFF_TARGET'));
  assert.ok(codes.includes('MODEL_AUDIO_WOULD_SHIP'));
  const receipt = JSON.parse(await readFile(current.service.receiptPath(created.job_id, 1), 'utf8'));
  assert.equal(receipt.attempt.decision, 'FAIL');
});

test('a source whose bytes moved under the job is refused rather than animated', async (t) => {
  const current = await fixture(t);
  const created = await current.service.createJob(artRequest());
  await assert.rejects(
    () => current.service.runJob(created.job_id, {
      idempotencyKey: 'run-key-0001',
      confirmPaidCreate: true,
      verifySource: async () => sha256(Buffer.from('a different look entirely')),
    }),
    (error) => error.code === 'SOURCE_HASH_MISMATCH',
  );
  assert.equal(current.executor.invocations.length, 0);
  assert.equal((await current.service.getJob(created.job_id)).status, 'REFUSED');
});

test('an executor failure is recorded as an attempt rather than swallowed', async (t) => {
  const current = await fixture(t, { executor: new FakeMotionExecutor({ throwOnce: true }) });
  const created = await current.service.createJob(artRequest());
  await assert.rejects(
    () => current.service.runJob(created.job_id, { idempotencyKey: 'run-key-0001', confirmPaidCreate: true }),
    (error) => error.code === 'EXECUTOR_FAILED',
  );
  const persisted = JSON.parse(await readFile(current.service.statePath(created.job_id), 'utf8'));
  assert.equal(persisted.attempts.length, 1);
  assert.equal(persisted.attempts[0].decision, 'FAIL');

  // The retry is a new attempt with its own key, so the fake cannot answer it from cache
  // and a real provider would be paid exactly once per attempt.
  const delivered = await current.service.runJob(created.job_id, { idempotencyKey: 'run-key-0002', confirmPaidCreate: true });
  assert.equal(delivered.status, 'DELIVERED');
  assert.equal(delivered.attempt_count, 2);
});

test('a delivered job is not generated twice', async (t) => {
  const current = await fixture(t);
  const created = await current.service.createJob(artRequest());
  await current.service.runJob(created.job_id, { idempotencyKey: 'run-key-0001', confirmPaidCreate: true });
  const again = await current.service.runJob(created.job_id, { idempotencyKey: 'run-key-0009', confirmPaidCreate: true });
  assert.equal(again.status, 'DELIVERED');
  assert.equal(current.executor.invocations.length, 1);
});

test('the service refuses to be used before initialize, and a stray directory is quarantined', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-motion-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new MotionService({ rootDirectory: root, motionExecutor: new FakeMotionExecutor(), projectRoot });
  await assert.rejects(() => service.getJob(motionJobIdForIdempotencyKey('motion-art-0001')), /initialize/);

  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(root, 'not-a-job-id'), { recursive: true });
  await service.initialize();
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual((await readdir(path.join(root, 'quarantine'))).sort(), ['not-a-job-id']);
});

test('the constructor refuses a wiring mistake outright', () => {
  assert.throws(() => new MotionService({ motionExecutor: new FakeMotionExecutor() }), /rootDirectory is required/);
  assert.throws(() => new MotionService({ rootDirectory: '/tmp/x' }), /motionExecutor\.executeMotion is required/);
});
