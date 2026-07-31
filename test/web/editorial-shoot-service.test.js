import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  EDITORIAL_QA_GATES,
  EDITORIAL_SHOT_SLOTS,
  canonicalJsonBytes,
  editorialStateSha256,
  sha256,
} from '../../src/web/editorial-shoot-contract.js';
import {
  EditorialShootService,
  EditorialShootServiceError,
} from '../../src/web/editorial-shoot-service.js';

const LOOK = Object.freeze({
  look_id: 'look_editorial_fixture',
  image_sha256: sha256(Buffer.from('immutable-approved-look')),
  receipt_sha256: sha256(Buffer.from('immutable-approved-look-pass-receipt')),
});

function monotonicClock(start = '2026-07-23T10:00:00.000Z') {
  let milliseconds = Date.parse(start);
  return () => {
    milliseconds += 1_000;
    return new Date(milliseconds);
  };
}

function makeBible(overrides = {}) {
  // No editorial slot requires a full-length figure any more: the crop is the
  // art direction, and demanding footwear made the generator invent a lower half
  // no approved reference could verify. The fixture tracks that contract rather
  // than the retired one; the ranges stay inside each slot's canonical lock.
  const framing = {
    clean_identity_hero: ['three_quarter', [72, 78]],
    environmental_hero: ['three_quarter', [66, 70]],
    sculptural_three_quarter: ['three_quarter', [68, 80]],
    interference_frame: ['three_quarter', [62, 74]],
    material_or_accessory_detail: ['detail', [55, 90]],
    wide_campaign_coda: ['wide_full_body', [52, 64]],
  };
  return {
    schema_version: '1.0.0',
    bible_id: 'bible_edwin_organic_fixture',
    mode_id: 'editorial.edwin_novak.organic_contrast',
    mode_version: '1.0.0',
    title: 'Edwin organic contrast — six-shot program',
    visual_system: 'Deep green environmental weight, tactile off-white surfaces, restrained mustard accents, and one controlled optical interruption.',
    source_references: [
      {
        reference_id: 'reference_environment_01',
        sha256: sha256(Buffer.from('licensed-environment-reference')),
        role: 'environment',
        rights_basis: 'User-provided reference retained privately for this profile project.',
        expires_at: '2026-08-22T10:00:00.000Z',
      },
      {
        reference_id: 'reference_light_01',
        sha256: sha256(Buffer.from('licensed-light-reference')),
        role: 'lighting',
        rights_basis: 'Original internal lighting study.',
        expires_at: '2026-08-22T10:00:00.000Z',
      },
    ],
    shots: EDITORIAL_SHOT_SLOTS.map((slot, index) => ({
      slot,
      title: slot.replaceAll('_', ' '),
      objective: index === 0
        ? 'Establish exact identity and every approved item without obstruction.'
        : `Execute the ${slot} narrative role while preserving the approved person and look.`,
      camera: {
        lens_mm: slot === 'wide_campaign_coda' ? 35 : slot === 'material_or_accessory_detail' ? 85 : 50,
        framing: framing[slot][0],
        angle: index % 2 === 0 ? 'eye level with disciplined verticals' : 'controlled low angle no more than five degrees',
        subject_height_percent: framing[slot][1],
      },
      pose: index === 0
        ? 'Neutral grounded stance with separated hands and unobstructed outfit.'
        : `Slot-specific ${slot} pose with readable anatomy and no accidental occlusion.`,
      lighting: 'Warm early-morning key, soft open-sky fill, coherent contact shadow, and protected face/item detail.',
      environment: 'Original non-identifiable deep-green landscape and restrained pale architectural surface.',
      palette: 'Deep green, warm off-white, restrained mustard, natural skin, exact approved item colors.',
      identity_visibility: slot === 'material_or_accessory_detail' ? 'partial_face' : 'full_face',
      item_evidence: [
        'Every approved garment remains exact in color and construction.',
        'Every visible logo, graphic, text, accessory, and footwear detail remains readable.',
      ],
      optical_device: slot === 'interference_frame'
        ? 'One narrow translucent foreground flare outside the face and critical item evidence.'
        : null,
      negative_constraints: [
        'No identity drift or body redesign.',
        'No added, removed, substituted, or recolored item.',
        'No copied source architecture or hidden critical evidence.',
      ],
    })),
    created_at: '2026-07-23T09:00:00.000Z',
    ...overrides,
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function executionResult(context, {
  decision = 'PASS',
  failGate = 'FRAMING_AND_ANATOMY',
  completedAt = '2026-07-23T10:30:00.000Z',
} = {}) {
  const candidateSha256 = sha256(Buffer.from(
    `${context.shoot_id}:${context.slot}:${context.attempt}:${decision}`,
  ));
  const gates = EDITORIAL_QA_GATES.map((id) => {
    const failed = decision === 'FAIL' && id === failGate;
    return {
      id,
      decision: failed ? 'FAIL' : 'PASS',
      evidence: failed ? `${id} has one measured defect` : `${id} exact-hash evidence passed`,
      defects: failed ? [`${id}_DEFECT`] : [],
    };
  });
  return {
    decision,
    execution_id: `execution_${context.slot}_${context.attempt}`,
    output: decision === 'PASS'
      ? {
        resource_id: `scene_${context.slot}_${context.attempt}`,
        sha256: candidateSha256,
        receipt_sha256: sha256(Buffer.from(`receipt:${candidateSha256}`)),
        width: 1024,
        height: 1280,
        media_type: 'image/png',
      }
      : null,
    qa: {
      decision,
      candidate_sha256: candidateSha256,
      approved_look_sha256: context.approved_look.image_sha256,
      bible_sha256: context.shoot_bible.sha256,
      shot_spec_sha256: context.shot_spec_sha256,
      gates,
      reviewer: {
        id: 'fixture_editorial_judge',
        version: 'fixture-editorial-judge-2026-07-23',
        request_id: `review_${context.slot}_${context.attempt}`,
      },
      completed_at: completedAt,
    },
  };
}

class FakeSceneExecutor {
  constructor({ plans = {}, defaultDelayMs = 10 } = {}) {
    this.plans = plans;
    this.defaultDelayMs = defaultDelayMs;
    this.invocations = [];
    this.providerOperations = new Map();
    this.inFlight = 0;
    this.maxInFlight = 0;
  }

  executeShot(context) {
    this.invocations.push({
      ...context,
      signal: undefined,
    });
    if (this.providerOperations.has(context.idempotency_key)) {
      return this.providerOperations.get(context.idempotency_key);
    }
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const plan = this.plans[context.slot];
    const operation = Promise.resolve()
      .then(async () => {
        if (typeof plan === 'function') return plan(context);
        if (plan?.promise) return plan.promise;
        await wait(this.defaultDelayMs);
        return executionResult(context, plan ?? {});
      })
      .finally(() => {
        this.inFlight -= 1;
      });
    this.providerOperations.set(context.idempotency_key, operation);
    return operation;
  }
}

async function fixture(t, {
  executor = new FakeSceneExecutor(),
  rootDirectory = null,
  clock = monotonicClock(),
  autoRepairBaseDelayMs = 0,
} = {}) {
  const root = rootDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'zeely-editorial-'));
  if (!rootDirectory) t.after(() => rm(root, { recursive: true, force: true }));
  const service = new EditorialShootService({
    rootDirectory: root,
    sceneExecutor: executor,
    clock,
    autoRepairBaseDelayMs,
  });
  await service.initialize();
  const bible = makeBible();
  const request = {
    idempotencyKey: 'create-editorial-shoot-fixture-0001',
    approvedLookReference: LOOK,
    shootBible: bible,
  };
  return { root, service, executor, bible, request };
}

async function createAndApproveBible(current) {
  const created = await current.service.createShoot(current.request);
  await current.service.approveBible(created.shoot_id, {
    idempotencyKey: 'approve-shoot-bible-fixture-0001',
    expectedBibleSha256: created.bindings.shoot_bible.sha256,
  });
  return created;
}

async function waitForState(service, shootId, predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await service.getShoot(shootId);
    if (predicate(state)) return state;
    await wait(5);
  }
  throw new Error(`Timed out waiting for editorial shoot ${shootId}`);
}

async function compileSchemas() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    formats: {
      'date-time': {
        type: 'string',
        validate: (value) => !Number.isNaN(Date.parse(value)),
      },
    },
  });
  const load = async (name) => JSON.parse(await readFile(
    path.resolve('schemas', name),
    'utf8',
  ));
  const bible = await load('editorial-shoot-bible.schema.json');
  const job = await load('editorial-shoot-job.schema.json');
  const event = await load('editorial-shoot-event.schema.json');
  const transaction = await load('editorial-shoot-transaction.schema.json');
  ajv.addSchema(job);
  ajv.addSchema(event);
  return {
    validateBible: ajv.compile(bible),
    validateJob: ajv.getSchema(job.$id),
    validateEvent: ajv.getSchema(event.$id),
    validateTransaction: ajv.compile(transaction),
  };
}

test('strict contracts require the six fixed Edwin slots and accept the service ledger', async (t) => {
  const schemas = await compileSchemas();
  const current = await fixture(t);
  const created = await current.service.createShoot(current.request);
  assert.equal(schemas.validateBible(current.bible), true, JSON.stringify(schemas.validateBible.errors));
  assert.equal(schemas.validateJob(created), true, JSON.stringify(schemas.validateJob.errors));
  const [event] = await current.service.listEvents(created.shoot_id);
  assert.equal(schemas.validateEvent(event), true, JSON.stringify(schemas.validateEvent.errors));
  const transaction = JSON.parse(await readFile(
    current.service.transactionPath(created.shoot_id, 1),
    'utf8',
  ));
  assert.equal(
    schemas.validateTransaction(transaction),
    true,
    JSON.stringify(schemas.validateTransaction.errors),
  );

  const missingSlot = makeBible({ shots: makeBible().shots.slice(0, 5) });
  assert.equal(schemas.validateBible(missingSlot), false);
  await assert.rejects(
    () => current.service.createShoot({
      ...current.request,
      idempotencyKey: 'invalid-editorial-bible-0001',
      shootBible: missingSlot,
    }),
    /exactly the six fixed editorial shot slots/,
  );

  const secondOpticalDevice = makeBible();
  secondOpticalDevice.shots[1].optical_device = 'an unauthorized second optical device';
  assert.equal(schemas.validateBible(secondOpticalDevice), false);
  await assert.rejects(
    () => current.service.createShoot({
      ...current.request,
      idempotencyKey: 'invalid-editorial-bible-0002',
      shootBible: secondOpticalDevice,
    }),
    /Only the interference frame/,
  );
});

test('create is idempotent, snapshots the ShootBible, and binds every event to exact hashes', async (t) => {
  const current = await fixture(t);
  const [first, second] = await Promise.all([
    current.service.createShoot(current.request),
    current.service.createShoot(current.request),
  ]);
  assert.equal(first.shoot_id, second.shoot_id);
  assert.equal(current.executor.invocations.length, 0);
  assert.deepEqual(first.shots.map((shot) => shot.status), Array(6).fill('BLOCKED'));

  const bibleBytes = await readFile(current.service.biblePath(first.shoot_id));
  assert.equal(sha256(bibleBytes), first.bindings.shoot_bible.sha256);
  assert.deepEqual(JSON.parse(bibleBytes), JSON.parse(canonicalJsonBytes(current.bible)));
  assert.equal(first.state_integrity_sha256, editorialStateSha256(first));

  const events = await current.service.listEvents(first.shoot_id);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, 'shoot.created');
  assert.equal(events[0].state_sha256, first.state_integrity_sha256);
  assert.equal(events[0].bindings.approved_look_image_sha256, LOOK.image_sha256);
  assert.equal(events[0].bindings.shoot_bible_sha256, first.bindings.shoot_bible.sha256);

  const changedBible = makeBible({ title: 'A different shoot bound to the same key' });
  await assert.rejects(
    () => current.service.createShoot({ ...current.request, shootBible: changedBible }),
    (error) => error instanceof EditorialShootServiceError
      && error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('Bible and hero approval replays bind both key and expected exact hash', async (t) => {
  const current = await fixture(t);
  const created = await current.service.createShoot(current.request);
  const bibleApproval = {
    idempotencyKey: 'approval-payload-binding-bible-0001',
    expectedBibleSha256: created.bindings.shoot_bible.sha256,
  };
  await current.service.approveBible(created.shoot_id, bibleApproval);
  await assert.rejects(
    () => current.service.approveBible(created.shoot_id, {
      ...bibleApproval,
      expectedBibleSha256: sha256(Buffer.from('different-bible')),
    }),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT',
  );

  const heroPassed = await waitForState(
    current.service,
    created.shoot_id,
    (state) => state.status === 'HERO_PENDING_APPROVAL',
  );
  const heroApproval = {
    idempotencyKey: 'approval-payload-binding-hero-0001',
    expectedOutputSha256: heroPassed.shots[0].output.sha256,
  };
  await current.service.approveHero(created.shoot_id, heroApproval);
  await assert.rejects(
    () => current.service.approveHero(created.shoot_id, {
      ...heroApproval,
      expectedOutputSha256: sha256(Buffer.from('different-hero')),
    }),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT',
  );
  await current.service.waitForIdle(created.shoot_id);
});

test('hero QA and exact-hash approval are hard barriers, then all five customer frames start together', async (t) => {
  const heroDeferred = deferred();
  const postHeroGate = deferred();
  const executor = new FakeSceneExecutor({
    plans: {
      clean_identity_hero: heroDeferred,
      ...Object.fromEntries(EDITORIAL_SHOT_SLOTS.slice(1).map((slot) => [
        slot,
        async (context) => {
          await postHeroGate.promise;
          return executionResult(context);
        },
      ])),
    },
  });
  const current = await fixture(t, { executor });
  const created = await createAndApproveBible(current);

  await waitForState(
    current.service,
    created.shoot_id,
    (state) => state.shots[0].status === 'RUNNING' && executor.invocations.length === 1,
  );
  assert.equal(executor.invocations.length, 1);
  assert.equal(executor.invocations[0].slot, 'clean_identity_hero');
  assert.deepEqual(
    (await current.service.getShoot(created.shoot_id)).shots.slice(1).map((shot) => shot.status),
    Array(5).fill('BLOCKED'),
  );

  heroDeferred.resolve(executionResult(executor.invocations[0]));
  const heroPassed = await waitForState(
    current.service,
    created.shoot_id,
    (state) => state.status === 'HERO_PENDING_APPROVAL',
  );
  assert.equal(heroPassed.shots[0].status, 'QA_PASSED');
  assert.equal(executor.invocations.length, 1, 'post-hero shots must not start from QA PASS alone');
  assert.deepEqual(heroPassed.shots.slice(1).map((shot) => shot.status), Array(5).fill('BLOCKED'));

  await assert.rejects(
    () => current.service.approveHero(created.shoot_id, {
      idempotencyKey: 'approve-editorial-hero-wrong-hash',
      expectedOutputSha256: sha256(Buffer.from('wrong-hero')),
    }),
    (error) => error.code === 'EDITORIAL_HERO_HASH_CONFLICT',
  );
  assert.equal(executor.invocations.length, 1);

  await current.service.approveHero(created.shoot_id, {
    idempotencyKey: 'approve-editorial-hero-correct-hash',
    expectedOutputSha256: heroPassed.shots[0].output.sha256,
  });
  const fivePostHeroShotsRunning = await waitForState(
    current.service,
    created.shoot_id,
    (state) => executor.inFlight === 5
      && state.shots.slice(1).filter((shot) => shot.status === 'RUNNING').length === 5,
  );
  assert.equal(executor.maxInFlight, 5);
  assert.equal(
    fivePostHeroShotsRunning.shots.slice(1).filter((shot) => shot.status === 'RUNNING').length,
    5,
  );
  postHeroGate.resolve();
  const completed = await waitForState(
    current.service,
    created.shoot_id,
    (state) => state.status === 'COMPLETED',
    5_000,
  );
  await current.service.waitForIdle(created.shoot_id);

  assert.equal(executor.maxInFlight, 5);
  assert.equal(executor.providerOperations.size, 6);
  assert.deepEqual(completed.shots.map((shot) => shot.status), Array(6).fill('APPROVED'));
  assert.equal(new Set(completed.shots.map((shot) => shot.output.sha256)).size, 6);
  for (const invocation of executor.invocations) {
    assert.deepEqual(invocation.approved_look, LOOK);
    assert.equal(invocation.shoot_bible.sha256, completed.bindings.shoot_bible.sha256);
    if (invocation.slot !== 'clean_identity_hero') {
      assert.equal(invocation.hero_output.sha256, completed.shots[0].output.sha256);
      assert.equal(invocation.hero_output.receipt_sha256, completed.shots[0].output.receipt_sha256);
    }
  }
});

test('two live service instances enforce one persisted global concurrency limit of five', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-editorial-multi-instance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pending = new Map();
  const executor = new FakeSceneExecutor({
    plans: Object.fromEntries(EDITORIAL_SHOT_SLOTS.slice(1).map((slot) => [
      slot,
      (context) => {
        const operation = deferred();
        pending.set(context.idempotency_key, {
          context,
          operation,
          resolved: false,
        });
        return operation.promise;
      },
    ])),
    defaultDelayMs: 5,
  });
  const first = await fixture(t, {
    executor,
    rootDirectory: root,
    clock: monotonicClock('2026-07-23T13:00:00.000Z'),
  });
  const created = await createAndApproveBible(first);
  const heroPassed = await waitForState(
    first.service,
    created.shoot_id,
    (state) => state.status === 'HERO_PENDING_APPROVAL',
  );
  await first.service.approveHero(created.shoot_id, {
    idempotencyKey: 'approve-hero-multi-instance-0001',
    expectedOutputSha256: heroPassed.shots[0].output.sha256,
  });
  await waitForState(
    first.service,
    created.shoot_id,
    (state) => state.shots.filter((shot) => shot.status === 'RUNNING').length === 5,
  );

  const second = new EditorialShootService({
    rootDirectory: root,
    sceneExecutor: executor,
    clock: monotonicClock('2026-07-23T13:01:00.000Z'),
  });
  await second.initialize();
  await wait(20);
  assert.equal(executor.providerOperations.size, 6, 'hero plus all five post-hero operations');
  assert.equal(executor.maxInFlight, 5);
  const activeKeys = [...pending.values()].filter((entry) => !entry.resolved);
  assert.equal(activeKeys.length, 5);

  while ((await first.service.getShoot(created.shoot_id)).status !== 'COMPLETED') {
    const unresolved = [...pending.values()].filter((entry) => !entry.resolved);
    assert.ok(unresolved.length <= 5, 'no more than five persisted post-hero operations may be active');
    for (const entry of unresolved) {
      entry.resolved = true;
      entry.operation.resolve(executionResult(entry.context));
    }
    await wait(20);
  }
  await Promise.all([
    first.service.waitForIdle(created.shoot_id),
    second.waitForIdle(created.shoot_id),
  ]);
  assert.equal(executor.maxInFlight, 5);
  assert.equal(
    new Set(executor.invocations.map((call) => call.idempotency_key)).size,
    6,
    'each of the six slots dispatches one owned operation',
  );
});

test('one failed shot automatically repairs without regenerating the look, hero, or passed siblings', async (t) => {
  const attemptBySlot = new Map();
  const failedSlot = 'interference_frame';
  const executor = new FakeSceneExecutor({
    plans: {
      [failedSlot]: (context) => {
        const count = (attemptBySlot.get(context.slot) ?? 0) + 1;
        attemptBySlot.set(context.slot, count);
        return executionResult(context, {
          decision: count === 1 ? 'FAIL' : 'PASS',
          failGate: 'NEAR_COPY_AND_LEAKAGE',
        });
      },
    },
    defaultDelayMs: 15,
  });
  const current = await fixture(t, { executor });
  const created = await createAndApproveBible(current);
  const heroPassed = await waitForState(
    current.service,
    created.shoot_id,
    (state) => state.status === 'HERO_PENDING_APPROVAL',
  );
  await current.service.approveHero(created.shoot_id, {
    idempotencyKey: 'approve-hero-for-one-shot-retry',
    expectedOutputSha256: heroPassed.shots[0].output.sha256,
  });
  const completed = await waitForState(
    current.service,
    created.shoot_id,
    (state) => state.status === 'COMPLETED',
    5_000,
  );
  await current.service.waitForIdle(created.shoot_id);

  const hero = completed.shots.find((shot) => shot.slot === 'clean_identity_hero');
  for (const shot of completed.shots) {
    if (shot.slot === failedSlot) {
      assert.equal(shot.attempts.length, 2);
      assert.equal(shot.retry_count, 1);
      assert.equal(shot.status, 'APPROVED');
    } else {
      assert.equal(shot.attempts.length, 1);
      assert.equal(shot.retry_count, 0);
      assert.equal(shot.status, 'APPROVED');
    }
  }
  assert.equal(hero.attempts.length, 1);
  assert.equal(
    executor.invocations.filter((call) => call.slot === 'clean_identity_hero').length,
    1,
  );
  assert.equal(
    executor.providerOperations.size,
    7,
    'six first-attempt operations plus exactly one retry operation',
  );
  assert.ok(executor.invocations.every(
    (call) => call.approved_look.image_sha256 === LOOK.image_sha256,
  ));
  const repairCall = executor.invocations.find(
    (call) => call.slot === failedSlot && call.attempt === 2,
  );
  assert.deepEqual(repairCall.repair.failed_gates.map((gate) => gate.id), [
    'NEAR_COPY_AND_LEAKAGE',
  ]);
});

test('automatic repair continues past three failures and preserves all passed siblings', async (t) => {
  const failedSlot = 'interference_frame';
  let attempts = 0;
  const executor = new FakeSceneExecutor({
    plans: {
      [failedSlot]: (context) => {
        attempts += 1;
        return executionResult(context, attempts <= 4 ? {
          decision: 'FAIL',
          failGate: 'NEAR_COPY_AND_LEAKAGE',
        } : {});
      },
    },
    defaultDelayMs: 10,
  });
  const current = await fixture(t, { executor });
  const created = await createAndApproveBible(current);
  const heroPassed = await waitForState(
    current.service,
    created.shoot_id,
    (state) => state.status === 'HERO_PENDING_APPROVAL',
  );
  await current.service.approveHero(created.shoot_id, {
    idempotencyKey: 'approve-hero-before-continued-auto-repair',
    expectedOutputSha256: heroPassed.shots[0].output.sha256,
  });
  const completed = await waitForState(
    current.service,
    created.shoot_id,
    (state) => state.status === 'COMPLETED',
    5_000,
  );
  await current.service.waitForIdle(created.shoot_id);

  const repaired = completed.shots.find((shot) => shot.slot === failedSlot);
  assert.equal(repaired.status, 'APPROVED');
  assert.equal(repaired.retry_count, 4);
  assert.equal(repaired.attempts.length, 5);
  assert.equal(repaired.error, null);
  for (const shot of completed.shots.filter((item) => item.slot !== failedSlot)) {
    assert.equal(shot.status, 'APPROVED');
    assert.equal(shot.retry_count, 0);
    assert.equal(shot.attempts.length, 1);
  }
  assert.equal(
    executor.invocations.filter((call) => call.slot === failedSlot).length,
    5,
  );
  assert.equal(executor.providerOperations.size, 10);
  const schemas = await compileSchemas();
  const repairEvents = (await current.service.listEvents(created.shoot_id))
    .filter((event) => event.event_type === 'shot.auto_repair_queued');
  assert.equal(repairEvents.length, 4);
  assert.ok(repairEvents.every((event) => schemas.validateEvent(event) === true));
});

test('automatic repair has a persisted server budget and never asks the user to retry', async (t) => {
  const failedSlot = 'interference_frame';
  const executor = new FakeSceneExecutor({
    plans: {
      [failedSlot]: (context) => executionResult(context, {
        decision: 'FAIL',
        failGate: 'NEAR_COPY_AND_LEAKAGE',
      }),
    },
    defaultDelayMs: 5,
  });
  const current = await fixture(t, { executor });
  const created = await createAndApproveBible(current);
  const heroPassed = await waitForState(
    current.service,
    created.shoot_id,
    (state) => state.status === 'HERO_PENDING_APPROVAL',
  );
  await current.service.approveHero(created.shoot_id, {
    idempotencyKey: 'approve-hero-before-server-retry-budget',
    expectedOutputSha256: heroPassed.shots[0].output.sha256,
  });
  const escalated = await waitForState(
    current.service,
    created.shoot_id,
    (state) => state.status === 'NEEDS_RETRY',
    5_000,
  );
  await current.service.waitForIdle(created.shoot_id);
  const exhausted = escalated.shots.find((shot) => shot.slot === failedSlot);
  assert.equal(exhausted.status, 'FAILED');
  assert.equal(exhausted.retry_count, 5);
  assert.equal(exhausted.attempts.length, 6);
  assert.equal(exhausted.error.code, 'BLOCKING_QA_FAILED');
  assert.equal(
    executor.invocations.filter((call) => call.slot === failedSlot).length,
    6,
  );
  assert.ok(
    !(await current.service.listEvents(created.shoot_id))
      .some((event) => event.event_type === 'shot.retry_queued'),
    'automatic recovery never requires a user retry request',
  );
});

test('write-ahead journal restores both state and event after an interrupted commit', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-editorial-wal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executor = new FakeSceneExecutor();
  const first = await fixture(t, {
    executor,
    rootDirectory: root,
    clock: monotonicClock('2026-07-23T14:00:00.000Z'),
  });
  const created = await first.service.createShoot(first.request);
  const transaction = JSON.parse(await readFile(
    first.service.transactionPath(created.shoot_id, 1),
    'utf8',
  ));
  assert.equal(transaction.state_sha256, created.state_integrity_sha256);

  await Promise.all([
    unlink(first.service.statePath(created.shoot_id)),
    unlink(first.service.eventPath(created.shoot_id, 1)),
  ]);
  const restarted = new EditorialShootService({
    rootDirectory: root,
    sceneExecutor: executor,
    clock: monotonicClock('2026-07-23T14:05:00.000Z'),
  });
  await restarted.initialize();
  const recovered = await restarted.getShoot(created.shoot_id);
  assert.deepEqual(recovered, created);
  const [recoveredEvent] = await restarted.listEvents(created.shoot_id);
  assert.equal(recoveredEvent.event_sha256, transaction.event_sha256);
  assert.equal(recoveredEvent.state_sha256, recovered.state_integrity_sha256);
});

test('restart requeues an interrupted shot with the same operation and provider idempotency key', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-editorial-restart-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const heroDeferred = deferred();
  const executor = new FakeSceneExecutor({
    plans: { clean_identity_hero: heroDeferred },
    defaultDelayMs: 5,
  });
  const first = await fixture(t, {
    executor,
    rootDirectory: root,
    clock: monotonicClock('2026-07-23T11:00:00.000Z'),
  });
  const created = await createAndApproveBible(first);
  const running = await waitForState(
    first.service,
    created.shoot_id,
    (state) => state.shots[0].status === 'RUNNING'
      && executor.providerOperations.size === 1,
  );
  const originalAttempt = running.shots[0].attempts[0];
  assert.equal(executor.providerOperations.size, 1);

  const restarted = new EditorialShootService({
    rootDirectory: root,
    sceneExecutor: executor,
    clock: monotonicClock('2026-07-23T12:00:00.000Z'),
  });
  await restarted.initialize();
  await waitForState(
    restarted,
    created.shoot_id,
    (state) => state.shots[0].status === 'RUNNING'
      && executor.invocations.length >= 2,
  );
  assert.equal(executor.providerOperations.size, 1, 'resume must reuse the provider operation');
  const resumeInvocation = executor.invocations.at(-1);
  assert.equal(resumeInvocation.operation_id, originalAttempt.operation_id);
  assert.equal(resumeInvocation.idempotency_key, originalAttempt.execution_idempotency_key);

  heroDeferred.resolve(executionResult(resumeInvocation));
  const recovered = await waitForState(
    restarted,
    created.shoot_id,
    (state) => state.status === 'HERO_PENDING_APPROVAL',
  );
  await Promise.all([
    first.service.waitForIdle(created.shoot_id),
    restarted.waitForIdle(created.shoot_id),
  ]);
  assert.equal(recovered.shots[0].attempts.length, 1);
  assert.equal(recovered.shots[0].attempts[0].operation_id, originalAttempt.operation_id);
  const events = await restarted.listEvents(created.shoot_id);
  assert.ok(events.some((event) => event.event_type === 'shoot.recovery_queued'));
  assert.ok(events.some((event) => event.event_type === 'shot.resumed'));
});

test('a PASS result that still names a defect is rejected, then the hero retries automatically', async (t) => {
  const executor = new FakeSceneExecutor({
    plans: {
      clean_identity_hero: (context) => {
        const result = executionResult(context);
        if (context.attempt === 1) {
          result.qa.gates[0].defects = ['A_PASS_CANNOT_HIDE_THIS_DEFECT'];
        }
        return result;
      },
    },
  });
  const current = await fixture(t, { executor });
  const created = await createAndApproveBible(current);
  const repaired = await waitForState(
    current.service,
    created.shoot_id,
    (state) => state.status === 'HERO_PENDING_APPROVAL',
  );
  assert.equal(repaired.shots[0].status, 'QA_PASSED');
  assert.equal(repaired.shots[0].retry_count, 1);
  assert.equal(repaired.shots[0].attempts.length, 2);
  assert.equal(repaired.shots[0].attempts[0].error.code, 'EXECUTOR_FAILED');
  assert.equal(repaired.shots[0].attempts[1].status, 'PASS');
  assert.deepEqual(repaired.shots.slice(1).map((shot) => shot.status), Array(5).fill('BLOCKED'));
});

test('current state must still match the event head even when polling after the latest cursor', async (t) => {
  const current = await fixture(t);
  const created = await current.service.createShoot(current.request);
  const statePath = current.service.statePath(created.shoot_id);
  const tampered = JSON.parse(await readFile(statePath, 'utf8'));
  tampered.message = 'A recomputed state that has no matching event head';
  tampered.state_integrity_sha256 = editorialStateSha256(tampered);
  await writeFile(statePath, `${JSON.stringify(tampered, null, 2)}\n`);
  await assert.rejects(
    () => current.service.listEvents(created.shoot_id, { after: tampered.event_cursor }),
    (error) => error.code === 'EDITORIAL_EVENT_INTEGRITY_FAILED',
  );
  await assert.rejects(
    () => current.service.getShoot(created.shoot_id),
    (error) => error.code === 'EDITORIAL_EVENT_INTEGRITY_FAILED',
  );
});

test('cancellation aborts active work, preserves passed hero bytes, and is idempotent', async (t) => {
  const postHeroDeferrals = Object.fromEntries(
    EDITORIAL_SHOT_SLOTS.slice(1).map((slot) => [slot, deferred()]),
  );
  const plans = Object.fromEntries(
    Object.entries(postHeroDeferrals).map(([slot, pending]) => [
      slot,
      (context) => {
        context.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          pending.reject(error);
        }, { once: true });
        return pending.promise;
      },
    ]),
  );
  const executor = new FakeSceneExecutor({ plans, defaultDelayMs: 5 });
  const current = await fixture(t, { executor });
  const created = await createAndApproveBible(current);
  const heroPassed = await waitForState(
    current.service,
    created.shoot_id,
    (state) => state.status === 'HERO_PENDING_APPROVAL',
  );
  await current.service.approveHero(created.shoot_id, {
    idempotencyKey: 'approve-hero-before-cancel-0001',
    expectedOutputSha256: heroPassed.shots[0].output.sha256,
  });
  const fiveRunning = await waitForState(
    current.service,
    created.shoot_id,
    (state) => state.shots.filter((shot) => shot.status === 'RUNNING').length === 5,
  );
  const heroBefore = cloneForAssertion(fiveRunning.shots[0].output);
  const cancelled = await current.service.cancelShoot(
    created.shoot_id,
    'User stopped the editorial series',
  );
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.shots[0].status, 'APPROVED');
  assert.deepEqual(cancelled.shots[0].output, heroBefore);
  assert.ok(cancelled.shots.slice(1).every((shot) => shot.status === 'CANCELLED'));
  const cursor = cancelled.event_cursor;

  const replay = await current.service.cancelShoot(created.shoot_id, 'duplicate cancellation');
  assert.equal(replay.event_cursor, cursor);
  await assert.rejects(
    () => current.service.retryShot(created.shoot_id, 'environmental_hero', {
      idempotencyKey: 'cancel-is-terminal-not-a-retry-0001',
    }),
    (error) => error.code === 'EDITORIAL_SHOT_NOT_RETRYABLE',
  );
  await current.service.waitForIdle(created.shoot_id);
  const final = await current.service.getShoot(created.shoot_id);
  assert.equal(final.status, 'CANCELLED');
  assert.deepEqual(final.shots[0].output, heroBefore);
  assert.equal(executor.providerOperations.size, 6, 'hero plus all five launched post-hero shots');
});

test('tampering with the immutable ShootBible or event chain fails closed', async (t) => {
  const current = await fixture(t);
  const created = await current.service.createShoot(current.request);
  const biblePath = current.service.biblePath(created.shoot_id);
  const originalBible = await readFile(biblePath);
  await writeFile(biblePath, Buffer.from(`${originalBible.toString('utf8')} `));
  await assert.rejects(
    () => current.service.getShoot(created.shoot_id),
    (error) => error.code === 'SHOOT_BIBLE_INTEGRITY_FAILED',
  );
  await writeFile(biblePath, originalBible);

  const eventPath = current.service.eventPath(created.shoot_id, 1);
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  event.data.shot_count = 999;
  await writeFile(eventPath, `${JSON.stringify(event)}\n`);
  await assert.rejects(
    () => current.service.listEvents(created.shoot_id),
    (error) => error.code === 'EDITORIAL_EVENT_INTEGRITY_FAILED',
  );
});

/**
 * SceneService's dedupe semantics, which is what an editorial execution key is
 * actually spent against: the scene id is the hash of the key, a key rebound to an
 * identical request replays that scene instead of paying for a second generation,
 * and a key rebound to a different request is refused with SceneService's own
 * message. requestVersion stands for the parts of a scene request no shoot can see
 * from its own state - the anchor set, the resolved preset bytes, the model route.
 * Shoot 24f54a3a met exactly that: the scene stored at its hero's first address,
 * scene_9ac1e693, had been written by a pipeline that sent no anchor set at all.
 */
class SharedSceneStore {
  constructor() {
    this.scenes = new Map();
    this.generations = [];
    this.conflicts = [];
  }

  generationsFor(shootId) {
    return this.generations.filter((generation) => generation.shoot_id === shootId);
  }
}

class SharedSceneStoreExecutor {
  constructor(store, {
    requestVersion = 'blocking-and-hero-anchors',
    delayMs = 5,
    plans = {},
  } = {}) {
    this.store = store;
    this.requestVersion = requestVersion;
    this.delayMs = delayMs;
    this.plans = plans;
    this.invocations = [];
  }

  #sceneRequestFingerprint(context) {
    return sha256(canonicalJsonBytes({
      request_version: this.requestVersion,
      approved_look: context.approved_look,
      preset: `${context.shoot_bible.mode_id}@${context.shoot_bible.mode_version}#${context.slot}`,
      // The hero continuity anchor is the shoot's own approved frame, so two shoots
      // that each generated a hero never send the same request for the five siblings.
      hero_continuity_anchor_sha256: context.hero_output?.sha256 ?? null,
    }));
  }

  executeShot(context) {
    this.invocations.push({ ...context, signal: undefined });
    const fingerprint = this.#sceneRequestFingerprint(context);
    const existing = this.store.scenes.get(context.idempotency_key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        this.store.conflicts.push({
          shoot_id: context.shoot_id,
          slot: context.slot,
          attempt: context.attempt,
          idempotency_key: context.idempotency_key,
          bound_to_shoot_id: existing.shoot_id,
        });
        return Promise.reject(new Error(
          'The idempotency key is already bound to a different scene request',
        ));
      }
      return existing.operation;
    }
    const plan = this.plans[context.slot];
    const operation = Promise.resolve().then(async () => {
      if (typeof plan === 'function') return plan(context);
      if (plan?.promise) return plan.promise;
      await wait(this.delayMs);
      return executionResult(context, plan ?? {});
    });
    this.store.generations.push({
      shoot_id: context.shoot_id,
      slot: context.slot,
      attempt: context.attempt,
      idempotency_key: context.idempotency_key,
    });
    this.store.scenes.set(context.idempotency_key, {
      fingerprint,
      operation,
      shoot_id: context.shoot_id,
    });
    return operation;
  }
}

async function completeSixSlotShoot(service, request, keyPrefix, store) {
  const created = await service.createShoot({
    ...request,
    idempotencyKey: `${keyPrefix}-create-0001`,
  });
  await service.approveBible(created.shoot_id, {
    idempotencyKey: `${keyPrefix}-bible-0001`,
    expectedBibleSha256: created.bindings.shoot_bible.sha256,
  });
  const heroSettled = await waitForState(
    service,
    created.shoot_id,
    (state) => ['HERO_PENDING_APPROVAL', 'NEEDS_RETRY', 'CANCELLED'].includes(state.status),
    5_000,
  );
  assert.equal(
    heroSettled.status,
    'HERO_PENDING_APPROVAL',
    `hero of ${created.shoot_id} did not reach approval: ${JSON.stringify({
      hero: heroSettled.shots[0].error,
      conflicts: store.conflicts,
    })}`,
  );
  await service.approveHero(created.shoot_id, {
    idempotencyKey: `${keyPrefix}-hero-0001`,
    expectedOutputSha256: heroSettled.shots[0].output.sha256,
  });
  const settled = await waitForState(
    service,
    created.shoot_id,
    (state) => ['COMPLETED', 'NEEDS_RETRY', 'CANCELLED'].includes(state.status),
    5_000,
  );
  await service.waitForIdle(created.shoot_id);
  return settled;
}

test('a re-shoot of the same look and mode drives its own six slots, not the earlier shoot scene ids', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-editorial-reshoot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SharedSceneStore();
  const earlier = await fixture(t, {
    executor: new SharedSceneStoreExecutor(store, { requestVersion: 'pre-anchor-pipeline' }),
    rootDirectory: root,
    clock: monotonicClock('2026-07-25T23:59:00.000Z'),
  });
  const first = await completeSixSlotShoot(
    earlier.service,
    earlier.request,
    'earlier-shoot-of-the-same-look',
    store,
  );
  assert.equal(first.status, 'COMPLETED');
  assert.equal(store.generationsFor(first.shoot_id).length, 6);

  const laterExecutor = new SharedSceneStoreExecutor(store);
  const laterService = new EditorialShootService({
    rootDirectory: root,
    sceneExecutor: laterExecutor,
    clock: monotonicClock('2026-07-26T04:27:00.000Z'),
  });
  await laterService.initialize();
  const second = await completeSixSlotShoot(
    laterService,
    earlier.request,
    'later-shoot-of-the-same-look',
    store,
  );

  assert.notEqual(second.shoot_id, first.shoot_id);
  assert.equal(second.status, 'COMPLETED', JSON.stringify(store.conflicts));
  assert.deepEqual(second.shots.map((shot) => shot.status), Array(6).fill('APPROVED'));
  assert.deepEqual(store.conflicts, []);
  assert.equal(store.generationsFor(second.shoot_id).length, 6);

  const firstAddresses = new Set(
    store.generationsFor(first.shoot_id).map((generation) => generation.idempotency_key),
  );
  assert.deepEqual(
    store.generationsFor(second.shoot_id)
      .filter((generation) => firstAddresses.has(generation.idempotency_key)),
    [],
    'no execution address may be spent by two different shoots',
  );
  const heroFrame = second.shots[0].output.sha256;
  assert.ok(
    laterExecutor.invocations
      .filter((call) => call.slot !== 'clean_identity_hero')
      .every((call) => call.hero_output?.sha256 === heroFrame),
    'the five siblings condition on their own shoot hero frame, which is why one address cannot serve both shoots',
  );
  const frames = [...first.shots, ...second.shots].map((shot) => shot.output.sha256);
  assert.equal(new Set(frames).size, 12);
  const rereadFirst = await laterService.getShoot(first.shoot_id);
  assert.deepEqual(
    rereadFirst.shots.map((shot) => shot.output.sha256),
    first.shots.map((shot) => shot.output.sha256),
  );
});

test('a resumed attempt and an automatic repair each spend one generation, not two', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-editorial-replay-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SharedSceneStore();
  const heroDeferred = deferred();
  const failedSlot = 'interference_frame';
  const executor = new SharedSceneStoreExecutor(store, {
    plans: {
      clean_identity_hero: heroDeferred,
      [failedSlot]: (context) => executionResult(context, {
        decision: context.attempt === 1 ? 'FAIL' : 'PASS',
        failGate: 'NEAR_COPY_AND_LEAKAGE',
      }),
    },
  });
  const current = await fixture(t, {
    executor,
    rootDirectory: root,
    clock: monotonicClock('2026-07-26T05:00:00.000Z'),
  });
  const created = await current.service.createShoot(current.request);
  await current.service.approveBible(created.shoot_id, {
    idempotencyKey: 'approve-bible-before-the-replayed-retry',
    expectedBibleSha256: created.bindings.shoot_bible.sha256,
  });
  const running = await waitForState(
    current.service,
    created.shoot_id,
    (state) => state.shots[0].status === 'RUNNING' && store.generations.length === 1,
  );
  const heroAttempt = running.shots[0].attempts[0];

  const restarted = new EditorialShootService({
    rootDirectory: root,
    sceneExecutor: executor,
    clock: monotonicClock('2026-07-26T06:00:00.000Z'),
  });
  await restarted.initialize();
  await waitForState(
    restarted,
    created.shoot_id,
    (state) => state.shots[0].status === 'RUNNING' && executor.invocations.length >= 2,
  );
  const resumed = executor.invocations.at(-1);
  assert.equal(resumed.idempotency_key, heroAttempt.execution_idempotency_key);
  assert.equal(store.generations.length, 1, 'the resumed hero attempt must not be charged twice');

  heroDeferred.resolve(executionResult(resumed));
  const heroPassed = await waitForState(
    restarted,
    created.shoot_id,
    (state) => state.status === 'HERO_PENDING_APPROVAL',
  );
  await restarted.approveHero(created.shoot_id, {
    idempotencyKey: 'approve-hero-before-the-replayed-retry',
    expectedOutputSha256: heroPassed.shots[0].output.sha256,
  });
  const completed = await waitForState(
    restarted,
    created.shoot_id,
    (state) => state.status === 'COMPLETED',
    5_000,
  );
  await Promise.all([
    current.service.waitForIdle(created.shoot_id),
    restarted.waitForIdle(created.shoot_id),
  ]);
  assert.equal(completed.shots.find((shot) => shot.slot === failedSlot).status, 'APPROVED');
  assert.equal(completed.shots.find((shot) => shot.slot === failedSlot).attempts.length, 2);
  assert.equal(
    store.generations.length,
    7,
    'the automatic repair must spend exactly one new generation',
  );
  assert.deepEqual(store.conflicts, []);

  const replayedCreate = await restarted.createShoot(current.request);
  assert.equal(replayedCreate.shoot_id, created.shoot_id);
  assert.equal(store.generations.length, 7);
  assert.equal(new Set(store.generations.map((item) => item.idempotency_key)).size, 7);
});

function cloneForAssertion(value) {
  return JSON.parse(JSON.stringify(value));
}
