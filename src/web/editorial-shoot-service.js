import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  EDITORIAL_HERO_SLOT,
  EDITORIAL_SCHEMA_VERSION,
  EDITORIAL_SHOOT_STATES,
  EDITORIAL_SHOT_SLOTS,
  EDITORIAL_SHOT_STATES,
  EDITORIAL_TERMINAL_SHOOT_STATES,
  assertEditorialId,
  assertEditorialIdempotencyKey,
  assertEditorialSha256,
  canonicalJsonBytes,
  editorialShotSpecSha256,
  editorialStateSha256,
  sha256,
  validateEditorialApprovedLookReference,
  validateEditorialExecutionResult,
  validateEditorialShootBible,
  validatePersistedEditorialShoot,
} from './editorial-shoot-contract.js';

const ZERO_SHA256 = '0'.repeat(64);
const NO_CHANGE = Symbol('NO_CHANGE');
const RESERVED_DIRECTORIES = new Set(['.locks', 'incidents', 'quarantine']);
const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 20;
const AUTO_REPAIR_MAX_RETRIES = 3;
// Fashion Shoot is a five-frame product. Its internal style pack and approved
// master-look are sufficient conditioning for each frame, so it does not make
// the customer wait for a hidden hero approval. This is a global ceiling across
// all Fashion Shoots, not a per-shoot multiplier.
const FASHION_SHOOT_GLOBAL_MAX_CONCURRENCY = 8;
const FASHION_SHOOT_FRAME_CONCURRENCY = 5;
const PROCESS_STARTED_AT_MS = Date.now() - Math.round(process.uptime() * 1_000);
const PROCESS_STARTED_AT_ISO = new Date(PROCESS_STARTED_AT_MS).toISOString();

function nowIso(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('EditorialShootService clock must return a valid Date or timestamp');
  }
  return date.toISOString();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function exists(filename) {
  try {
    await access(filename, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  await rename(temporary, filename);
}

async function writeImmutable(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.immutable`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  try {
    try {
      await link(temporary, filename);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const current = await readFile(filename);
      if (!current.equals(bytes)) {
        throw new Error(`Immutable editorial artifact conflict: ${path.basename(filename)}`);
      }
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function lockOwnerIsAlive(owner) {
  if (!owner || !Number.isInteger(owner.pid) || owner.pid < 1 || typeof owner.acquired_at !== 'string') {
    return false;
  }
  const acquiredAt = Date.parse(owner.acquired_at);
  if (!Number.isFinite(acquiredAt)) return false;
  if (owner.pid === process.pid) return acquiredAt >= PROCESS_STARTED_AT_MS - 5_000;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function executionLeaseIsLive(lease, observedAt) {
  if (!lease
    || !Number.isInteger(lease.owner_pid)
    || lease.owner_pid < 1
    || typeof lease.owner_process_started_at !== 'string'
    || typeof lease.expires_at !== 'string') {
    return false;
  }
  if (Date.parse(lease.expires_at) <= Date.parse(observedAt)) return false;
  if (lease.owner_pid === process.pid) {
    return lease.owner_process_started_at === PROCESS_STARTED_AT_ISO;
  }
  try {
    process.kill(lease.owner_pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function acquireFilesystemLock(filename, {
  waitMs = LOCK_WAIT_MS,
  pollMs = LOCK_POLL_MS,
} = {}) {
  await mkdir(path.dirname(filename), { recursive: true });
  const token = randomUUID();
  const deadline = Date.now() + waitMs;
  while (true) {
    let handle;
    try {
      handle = await open(filename, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({
        schema_version: EDITORIAL_SCHEMA_VERSION,
        token,
        pid: process.pid,
        acquired_at: new Date().toISOString(),
      })}\n`);
      await handle.sync();
      await handle.close();
      handle = null;
      return async () => {
        try {
          const current = JSON.parse(await readFile(filename, 'utf8'));
          if (current.token === token) await unlink(filename);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        stale = !lockOwnerIsAlive(JSON.parse(await readFile(filename, 'utf8')));
      } catch {
        stale = false;
      }
      if (stale) {
        await unlink(filename).catch((unlinkError) => {
          if (unlinkError.code !== 'ENOENT') throw unlinkError;
        });
        continue;
      }
      if (Date.now() >= deadline) return null;
      await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    }
  }
}

function safeErrorMessage(error) {
  const message = typeof error?.message === 'string' && error.message.trim()
    ? error.message.trim()
    : 'Editorial scene executor failed';
  if (/(?:\/Users\/|\/home\/|\/tmp\/|\.local\/share|runtime\/runs|[A-Za-z]:\\)/i.test(message)) {
    return 'Editorial scene executor failed at a protected local boundary';
  }
  return message.slice(0, 500);
}

function clone(value) {
  return structuredClone(value);
}

function isParallelFashionShoot(state) {
  return typeof state?.bindings?.shoot_bible?.mode_id === 'string'
    && state.bindings.shoot_bible.mode_id.startsWith('shoot.');
}

function shotConcurrencyLimit(state) {
  if (isParallelFashionShoot(state)) return FASHION_SHOOT_FRAME_CONCURRENCY;
  return state.shots[0].status === EDITORIAL_SHOT_STATES.APPROVED ? 2 : 1;
}

function repairInstructions(attempt) {
  if (!attempt) return null;
  const failedGates = Array.isArray(attempt.qa?.gates)
    ? attempt.qa.gates
      .filter((gate) => gate.decision === 'FAIL')
      .map((gate) => ({
        id: gate.id,
        defects: Array.isArray(gate.defects) ? [...gate.defects] : [],
      }))
    : [];
  return {
    source_attempt: attempt.number,
    failure_code: attempt.error?.code ?? null,
    failed_gates: failedGates,
  };
}

function canAutoRepair(shot, failureCode) {
  return failureCode !== 'EXECUTION_CANCELLED'
    && shot.retry_count < AUTO_REPAIR_MAX_RETRIES;
}

function eventHash(event) {
  const copy = clone(event);
  delete copy.event_sha256;
  return sha256(canonicalJsonBytes(copy));
}

function transactionHash(transaction) {
  const copy = clone(transaction);
  delete copy.transaction_sha256;
  return sha256(canonicalJsonBytes(copy));
}

function publicShoot(state) {
  return clone(state);
}

function stateAfterShotMutation(state, shots) {
  const hero = shots[0];
  if (isParallelFashionShoot(state)) {
    const customerFrames = shots.slice(1);
    if (customerFrames.every((shot) => shot.status === EDITORIAL_SHOT_STATES.APPROVED)) {
      return {
        ...state,
        shots,
        status: EDITORIAL_SHOOT_STATES.COMPLETED,
        phase: 'COMPLETED',
        message: 'All five Fashion Shoot frames passed',
      };
    }
    if (customerFrames.some((shot) => [
      EDITORIAL_SHOT_STATES.QUEUED,
      EDITORIAL_SHOT_STATES.RUNNING,
    ].includes(shot.status))) {
      return {
        ...state,
        shots,
        status: EDITORIAL_SHOOT_STATES.SERIES_RUNNING,
        phase: 'FASHION_SHOOT_GENERATION',
        message: 'Generating all five Fashion Shoot frames',
      };
    }
    return {
      ...state,
      shots,
      status: EDITORIAL_SHOOT_STATES.NEEDS_RETRY,
      phase: 'SHOT_RETRY',
      message: 'Passed Fashion Shoot frames are preserved; only failed frames need retry',
    };
  }
  if ([EDITORIAL_SHOT_STATES.QUEUED, EDITORIAL_SHOT_STATES.RUNNING].includes(hero.status)) {
    return {
      ...state,
      shots,
      status: EDITORIAL_SHOOT_STATES.HERO_RUNNING,
      phase: 'HERO_GENERATION',
      message: 'The clean identity hero is the only runnable editorial slot',
    };
  }
  if (hero.status === EDITORIAL_SHOT_STATES.QA_PASSED) {
    return {
      ...state,
      shots,
      status: EDITORIAL_SHOOT_STATES.HERO_PENDING_APPROVAL,
      phase: 'HERO_APPROVAL',
      message: 'The exact-hash clean identity hero passed QA and awaits approval',
    };
  }
  if (hero.status !== EDITORIAL_SHOT_STATES.APPROVED) {
    return {
      ...state,
      shots,
      status: EDITORIAL_SHOOT_STATES.NEEDS_RETRY,
      phase: 'HERO_NEEDS_RETRY',
      message: 'The clean identity hero failed a blocking gate and can be retried independently',
    };
  }
  const remaining = shots.slice(1);
  if (remaining.every((shot) => shot.status === EDITORIAL_SHOT_STATES.APPROVED)) {
    return {
      ...state,
      shots,
      status: EDITORIAL_SHOOT_STATES.COMPLETED,
      phase: 'COMPLETED',
      message: 'All six exact-hash editorial shots passed',
    };
  }
  if (remaining.some((shot) => [
    EDITORIAL_SHOT_STATES.QUEUED,
    EDITORIAL_SHOT_STATES.RUNNING,
  ].includes(shot.status))) {
    return {
      ...state,
      shots,
      status: EDITORIAL_SHOOT_STATES.SERIES_RUNNING,
      phase: 'SERIES_GENERATION',
      message: 'Generating the five post-hero editorial shots with concurrency two',
    };
  }
  return {
    ...state,
    shots,
    status: EDITORIAL_SHOOT_STATES.NEEDS_RETRY,
    phase: 'SHOT_RETRY',
    message: 'Passed shots are preserved; only failed or cancelled shots need retry',
  };
}

// One runtime root has to govern a whole shoot, and for two live shoots it did not:
// shoot.json, the event chain and the journal were written under
// <projectRoot>/runtime/editorial-shoots while every scene.png, QA receipt and manifest
// belonging to the same shoots went to the configured ZEELY_RUNTIME_ROOT. A healthy 5
// of 6 shoot then read as lost data, and the user was told frames were unrecoverable
// while they sat on disk in the other root. start.js now derives both paths from one
// root and calls this first, because a resolver that merely stops reading the old
// location orphans exactly the state whose disappearance caused the incident.
export async function adoptLegacyEditorialShootRoot({ from, to }) {
  const legacyRoot = path.resolve(from);
  const root = path.resolve(to);
  if (legacyRoot === root) return [];
  let entries;
  try {
    entries = await readdir(legacyRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const adopted = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || RESERVED_DIRECTORIES.has(entry.name)) continue;
    try {
      assertEditorialId(entry.name, 'persisted shoot directory');
    } catch {
      continue;
    }
    // A shoot id is the hash of its creation key, so the same id in both roots is the
    // same request. The configured root is the one the running service reads, so it
    // wins, and the legacy copy is left untouched rather than deleted or merged.
    const target = path.join(root, entry.name);
    if (await exists(target)) continue;
    await mkdir(root, { recursive: true });
    await rename(path.join(legacyRoot, entry.name), target);
    adopted.push(entry.name);
  }
  return adopted;
}

export class EditorialShootServiceError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'EditorialShootServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Durable Edwin six-shot orchestration core.
 *
 * sceneExecutor.executeShot(context) must be idempotent by
 * context.idempotency_key, which addresses one shoot's own execution and is never
 * shared with another shoot, and return:
 * {
 *   decision: "PASS" | "FAIL",
 *   execution_id,
 *   output: null | {
 *     resource_id, sha256, receipt_sha256,
 *     width: 1024, height: 1280, media_type: "image/png"
 *   },
 *   qa: {
 *     decision, candidate_sha256, approved_look_sha256, bible_sha256,
 *     shot_spec_sha256, gates: nine ordered blocking gates,
 *     reviewer: { id, version, request_id }, completed_at
 *   }
 * }
 *
 * The executor owns scene generation. This service owns only the immutable
 * ShootBible, hero transaction barrier, two-wide scheduler, shot retries,
 * cancellation, and hash-bound orchestration ledger.
 */
export class EditorialShootService {
  constructor({
    rootDirectory,
    sceneExecutor,
    clock = () => new Date(),
    observer = null,
    observerTimeoutMs = 2_000,
    leaseDurationMs = 30 * 60 * 1_000,
  }) {
    if (!rootDirectory) throw new Error('EditorialShootService rootDirectory is required');
    if (typeof sceneExecutor?.executeShot !== 'function') {
      throw new Error('EditorialShootService sceneExecutor.executeShot is required');
    }
    if (observer !== null && typeof observer !== 'function') {
      throw new Error('EditorialShootService observer must be a function');
    }
    if (!Number.isFinite(observerTimeoutMs) || observerTimeoutMs < 10 || observerTimeoutMs > 30_000) {
      throw new Error('EditorialShootService observerTimeoutMs must be between 10 and 30000 milliseconds');
    }
    if (!Number.isFinite(leaseDurationMs) || leaseDurationMs < 10_000 || leaseDurationMs > 3_600_000) {
      throw new Error('EditorialShootService leaseDurationMs must be between 10000 and 3600000 milliseconds');
    }
    this.rootDirectory = path.resolve(rootDirectory);
    this.sceneExecutor = sceneExecutor;
    this.clock = clock;
    this.observer = observer;
    this.observerTimeoutMs = observerTimeoutMs;
    this.leaseDurationMs = leaseDurationMs;
    this.instanceId = `editorial_worker_${randomUUID()}`;
    this.events = new EventEmitter();
    this.mutations = new Map();
    this.schedulers = new Map();
    this.runningShots = new Map();
    this.controllers = new Map();
  }

  shootDirectory(shootId) {
    assertEditorialId(shootId, 'shootId');
    return path.join(this.rootDirectory, shootId);
  }

  statePath(shootId) {
    return path.join(this.shootDirectory(shootId), 'shoot.json');
  }

  biblePath(shootId) {
    return path.join(this.shootDirectory(shootId), 'inputs', 'shoot-bible.json');
  }

  eventPath(shootId, eventId) {
    return path.join(
      this.shootDirectory(shootId),
      'events',
      `${String(eventId).padStart(8, '0')}.json`,
    );
  }

  transactionPath(shootId, stateRevision) {
    return path.join(
      this.shootDirectory(shootId),
      'journal',
      `${String(stateRevision).padStart(8, '0')}.json`,
    );
  }

  lockPath(shootId, kind) {
    if (!['create', 'state'].includes(kind)) {
      throw new Error('Unsupported EditorialShootService lock kind');
    }
    return path.join(this.rootDirectory, '.locks', `${shootId}.${kind}.lock`);
  }

  globalSchedulerLockPath() {
    return path.join(this.rootDirectory, '.locks', 'fashion-shoot-global-scheduler.lock');
  }

  async #runningFashionFrameCount() {
    const entries = await readdir(this.rootDirectory, { withFileTypes: true });
    let running = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || RESERVED_DIRECTORIES.has(entry.name)) continue;
      try {
        assertEditorialId(entry.name, 'persisted shoot directory');
      } catch {
        continue;
      }
      const state = await this.#read(entry.name);
      if (!state || !isParallelFashionShoot(state)) continue;
      running += state.shots.slice(1).filter(
        (shot) => shot.status === EDITORIAL_SHOT_STATES.RUNNING,
      ).length;
    }
    return running;
  }

  async #withLock(shootId, kind, action) {
    const release = await acquireFilesystemLock(this.lockPath(shootId, kind));
    if (!release) {
      throw new EditorialShootServiceError(
        503,
        'EDITORIAL_SHOOT_BUSY',
        `Editorial shoot ${kind} lock is held by another service instance`,
      );
    }
    try {
      return await action();
    } finally {
      await release();
    }
  }

  async #publish(state, event) {
    const publicState = publicShoot(state);
    try {
      this.events.emit(state.shoot_id, publicState, clone(event));
    } catch {
      // Live listeners cannot change durable orchestration.
    }
    if (this.observer) {
      let timeout;
      try {
        await Promise.race([
          Promise.resolve(this.observer(publicState, clone(event))),
          new Promise((resolve) => {
            timeout = setTimeout(resolve, this.observerTimeoutMs);
          }),
        ]);
      } catch {
        // Monitoring cannot change generation or approval semantics.
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
  }

  async #readBible(shootId, binding = null) {
    const bytes = await readFile(this.biblePath(shootId));
    const bible = validateEditorialShootBible(JSON.parse(bytes.toString('utf8')));
    if (binding) {
      if (sha256(bytes) !== binding.sha256
        || bible.bible_id !== binding.bible_id
        || bible.mode_id !== binding.mode_id
        || bible.mode_version !== binding.mode_version) {
        throw new EditorialShootServiceError(
          409,
          'SHOOT_BIBLE_INTEGRITY_FAILED',
          'The immutable ShootBible no longer matches its persisted hash binding',
        );
      }
      for (const shot of bible.shots) {
        if (editorialShotSpecSha256(shot) !== binding.shot_spec_hashes[shot.slot]) {
          throw new EditorialShootServiceError(
            409,
            'SHOOT_BIBLE_INTEGRITY_FAILED',
            `The immutable ShootBible shot spec ${shot.slot} no longer matches`,
          );
        }
      }
    }
    return { bible, bytes };
  }

  async #read(shootId) {
    try {
      const state = validatePersistedEditorialShoot(
        JSON.parse(await readFile(this.statePath(shootId), 'utf8')),
        shootId,
      );
      await this.#readBible(shootId, state.bindings.shoot_bible);
      return state;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async #previousEventSha256(shootId, eventId) {
    if (eventId === 1) return ZERO_SHA256;
    const previous = JSON.parse(await readFile(this.eventPath(shootId, eventId - 1), 'utf8'));
    if (previous.event_id !== eventId - 1 || eventHash(previous) !== previous.event_sha256) {
      throw new Error('Editorial event chain is corrupt before the next state transition');
    }
    return previous.event_sha256;
  }

  async #buildEvent(state, eventType, {
    slot = null,
    shotOutputSha256 = null,
    data = {},
  } = {}) {
    const eventId = state.event_cursor;
    const event = {
      schema_version: EDITORIAL_SCHEMA_VERSION,
      shoot_id: state.shoot_id,
      event_id: eventId,
      event_type: eventType,
      created_at: state.updated_at,
      previous_event_sha256: await this.#previousEventSha256(state.shoot_id, eventId),
      state_sha256: state.state_integrity_sha256,
      bindings: {
        approved_look_image_sha256: state.bindings.approved_look.image_sha256,
        approved_look_receipt_sha256: state.bindings.approved_look.receipt_sha256,
        shoot_bible_sha256: state.bindings.shoot_bible.sha256,
      },
      slot,
      shot_output_sha256: shotOutputSha256,
      data,
      event_sha256: '',
    };
    event.event_sha256 = eventHash(event);
    return event;
  }

  async #commitTransition(state, eventType, eventData, { baseStateRevision }) {
    const event = await this.#buildEvent(state, eventType, eventData);
    const transaction = {
      schema_version: EDITORIAL_SCHEMA_VERSION,
      transaction_type: 'EDITORIAL_STATE_EVENT_COMMIT',
      shoot_id: state.shoot_id,
      base_state_revision: baseStateRevision,
      target_state_revision: state.state_revision,
      state_sha256: state.state_integrity_sha256,
      event_sha256: event.event_sha256,
      state,
      event,
      transaction_sha256: '',
    };
    transaction.transaction_sha256 = transactionHash(transaction);
    await writeImmutable(
      this.transactionPath(state.shoot_id, state.state_revision),
      canonicalJsonBytes(transaction),
    );
    await writeImmutable(
      this.eventPath(state.shoot_id, state.event_cursor),
      canonicalJsonBytes(event),
    );
    await atomicWrite(
      this.statePath(state.shoot_id),
      Buffer.from(`${JSON.stringify(state, null, 2)}\n`),
    );
    await this.#publish(state, event);
    return state;
  }

  async #persistInitial(state, eventType, eventData) {
    state.state_integrity_sha256 = editorialStateSha256(state);
    validatePersistedEditorialShoot(state, state.shoot_id);
    return this.#commitTransition(state, eventType, eventData, { baseStateRevision: 0 });
  }

  async #recoverTransactions(shootId) {
    const journalDirectory = path.join(this.shootDirectory(shootId), 'journal');
    let entries;
    try {
      entries = await readdir(journalDirectory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    let current = null;
    try {
      current = JSON.parse(await readFile(this.statePath(shootId), 'utf8'));
      validatePersistedEditorialShoot(current, shootId);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const transactions = entries
      .filter((entry) => entry.isFile() && /^\d{8}\.json$/.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of transactions) {
      const transaction = JSON.parse(
        await readFile(path.join(journalDirectory, entry.name), 'utf8'),
      );
      if (transaction.transaction_sha256 !== transactionHash(transaction)
        || transaction.schema_version !== EDITORIAL_SCHEMA_VERSION
        || transaction.transaction_type !== 'EDITORIAL_STATE_EVENT_COMMIT'
        || transaction.shoot_id !== shootId
        || transaction.target_state_revision !== transaction.state?.state_revision
        || transaction.target_state_revision !== transaction.event?.event_id
        || transaction.state_sha256 !== transaction.state?.state_integrity_sha256
        || transaction.state_sha256 !== editorialStateSha256(transaction.state)
        || transaction.event_sha256 !== transaction.event?.event_sha256
        || transaction.event_sha256 !== eventHash(transaction.event)
        || transaction.event?.state_sha256 !== transaction.state_sha256) {
        throw new EditorialShootServiceError(
          409,
          'EDITORIAL_TRANSACTION_INTEGRITY_FAILED',
          'An editorial transition journal entry failed exact-hash validation',
        );
      }
      validatePersistedEditorialShoot(transaction.state, shootId);
      const currentRevision = current?.state_revision ?? 0;
      if (transaction.target_state_revision > currentRevision + 1
        || (transaction.target_state_revision === currentRevision + 1
          && transaction.base_state_revision !== currentRevision)) {
        throw new EditorialShootServiceError(
          409,
          'EDITORIAL_TRANSACTION_GAP',
          'Editorial transition journal contains a non-contiguous state revision',
        );
      }
      if (transaction.target_state_revision <= currentRevision) {
        if (transaction.target_state_revision === currentRevision
          && current.state_integrity_sha256 !== transaction.state_sha256) {
          throw new EditorialShootServiceError(
            409,
            'EDITORIAL_TRANSACTION_INTEGRITY_FAILED',
            'Current editorial state differs from its exact write-ahead transaction',
          );
        }
        await writeImmutable(
          this.eventPath(shootId, transaction.event.event_id),
          canonicalJsonBytes(transaction.event),
        );
        continue;
      }
      const expectedPrevious = await this.#previousEventSha256(
        shootId,
        transaction.event.event_id,
      );
      if (transaction.event.previous_event_sha256 !== expectedPrevious) {
        throw new EditorialShootServiceError(
          409,
          'EDITORIAL_TRANSACTION_INTEGRITY_FAILED',
          'Editorial transition journal does not continue the event hash chain',
        );
      }
      await writeImmutable(
        this.eventPath(shootId, transaction.event.event_id),
        canonicalJsonBytes(transaction.event),
      );
      await atomicWrite(
        this.statePath(shootId),
        Buffer.from(`${JSON.stringify(transaction.state, null, 2)}\n`),
      );
      current = transaction.state;
    }
    if (current && Number(transactions.at(-1)?.name.slice(0, 8) ?? 0) < current.state_revision) {
      throw new EditorialShootServiceError(
        409,
        'EDITORIAL_TRANSACTION_GAP',
        'Current editorial state has no matching write-ahead transaction',
      );
    }
  }

  async #mutate(shootId, action) {
    const previous = this.mutations.get(shootId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.#withLock(shootId, 'state', async () => {
        await this.#recoverTransactions(shootId);
        const current = await this.#read(shootId);
        if (!current) {
          throw new EditorialShootServiceError(404, 'EDITORIAL_SHOOT_NOT_FOUND', 'Editorial shoot not found');
        }
        const mutation = await action(clone(current));
        if (mutation === NO_CHANGE) return current;
        const next = mutation.state;
        next.state_revision = current.state_revision + 1;
        next.event_cursor = current.event_cursor + 1;
        next.updated_at = nowIso(this.clock);
        next.state_integrity_sha256 = editorialStateSha256(next);
        validatePersistedEditorialShoot(next, shootId);
        await this.#commitTransition(next, mutation.event_type, {
          slot: mutation.slot ?? null,
          shotOutputSha256: mutation.shot_output_sha256 ?? null,
          data: mutation.data ?? {},
        }, {
          baseStateRevision: current.state_revision,
        });
        return next;
      }));
    this.mutations.set(shootId, operation);
    try {
      return await operation;
    } finally {
      if (this.mutations.get(shootId) === operation) this.mutations.delete(shootId);
    }
  }

  async initialize() {
    await mkdir(this.rootDirectory, { recursive: true });
    const entries = await readdir(this.rootDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || RESERVED_DIRECTORIES.has(entry.name)) continue;
      try {
        assertEditorialId(entry.name, 'persisted shoot directory');
      } catch {
        continue;
      }
      // One unloadable shoot must cost that shoot, never the process. Before
      // this guard, a contract change (58dd637 re-locking wide_campaign_coda to
      // wide_full_body) made every pre-change persisted shoot fail validation
      // here, initialize() threw, and the whole app refused to boot — the same
      // disease the scene service already cures with its malformed-scene
      // quarantine, so this is that exact pattern applied to editorial shoots.
      let state;
      try {
        await this.#withLock(entry.name, 'state', () => this.#recoverTransactions(entry.name));
        state = await this.#read(entry.name);
        if (!state) continue;
        await this.listEvents(entry.name);
      } catch (error) {
        await this.#quarantineMalformedShoot(entry.name, error);
        continue;
      }
      if (EDITORIAL_TERMINAL_SHOOT_STATES.has(state.status)
        || [
          EDITORIAL_SHOOT_STATES.BIBLE_PENDING_APPROVAL,
          EDITORIAL_SHOOT_STATES.HERO_PENDING_APPROVAL,
        ].includes(state.status)) {
        continue;
      }
      const observedAt = nowIso(this.clock);
      const interruptedSlots = state.shots
        .filter((shot) => shot.status === EDITORIAL_SHOT_STATES.RUNNING
          && !executionLeaseIsLive(shot.lease, observedAt))
        .map((shot) => shot.slot);
      const hasInterruptedShot = interruptedSlots.length > 0;
      if (hasInterruptedShot) {
        await this.#mutate(entry.name, (current) => {
          const shots = current.shots.map((shot) => interruptedSlots.includes(shot.slot)
            ? {
              ...shot,
              status: EDITORIAL_SHOT_STATES.QUEUED,
              lease: null,
            }
            : shot);
          const next = stateAfterShotMutation(current, shots);
          return {
            state: {
              ...next,
              phase: 'RECOVERY_QUEUED',
              message: 'Interrupted editorial operations were requeued with their original idempotency keys',
            },
            event_type: 'shoot.recovery_queued',
            data: {
              resumed_slots: interruptedSlots,
            },
          };
        });
      }
      this.start(entry.name);
    }
  }

  async #quarantineMalformedShoot(shootId, error) {
    const createdAt = nowIso(this.clock);
    const suffix = `${createdAt.replaceAll(/[^0-9]/g, '')}-${randomUUID()}`;
    const quarantinePath = path.join(this.rootDirectory, 'quarantine', `malformed-${shootId}-${suffix}`);
    await mkdir(path.dirname(quarantinePath), { recursive: true });
    await rename(this.shootDirectory(shootId), quarantinePath);
    const incident = {
      schema_version: EDITORIAL_SCHEMA_VERSION,
      incident_id: `incident_${randomUUID()}`,
      shoot_id: shootId,
      status: 'QUARANTINED',
      code: 'MALFORMED_PERSISTED_EDITORIAL_SHOOT',
      message: `Persisted editorial shoot failed strict validation at boot: ${error?.message ?? error}`,
      quarantine_relative_path: `quarantine/${path.basename(quarantinePath)}`,
      created_at: createdAt,
    };
    const incidentDirectory = path.join(this.rootDirectory, 'incidents');
    await mkdir(incidentDirectory, { recursive: true });
    await writeFile(
      path.join(incidentDirectory, `${shootId}-${suffix}.json`),
      `${JSON.stringify(incident, null, 2)}\n`,
    );
  }

  async createShoot({
    idempotencyKey,
    approvedLookReference,
    shootBible,
  }) {
    assertEditorialIdempotencyKey(idempotencyKey);
    const approvedLook = validateEditorialApprovedLookReference(approvedLookReference);
    const bible = validateEditorialShootBible(shootBible);
    const bibleBytes = canonicalJsonBytes(bible);
    const bibleSha256 = sha256(bibleBytes);
    const idempotencyHash = sha256(idempotencyKey);
    const shootId = `shoot_${idempotencyHash.slice(0, 48)}`;
    const shotSpecHashes = Object.fromEntries(
      bible.shots.map((shot) => [shot.slot, editorialShotSpecSha256(shot)]),
    );
    const requestFingerprint = sha256(canonicalJsonBytes({
      approved_look: approvedLook,
      bible_sha256: bibleSha256,
      shot_spec_hashes: shotSpecHashes,
      scheduler_max_concurrency: 2,
    }));

    const existing = await this.#read(shootId);
    if (existing) {
      if (existing.request_fingerprint !== requestFingerprint) {
        throw new EditorialShootServiceError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'The idempotency key is already bound to a different editorial shoot request',
        );
      }
      return publicShoot(existing);
    }

    return this.#withLock(shootId, 'create', async () => {
      await this.#withLock(shootId, 'state', () => this.#recoverTransactions(shootId));
      const raced = await this.#read(shootId);
      if (raced) {
        if (raced.request_fingerprint !== requestFingerprint) {
          throw new EditorialShootServiceError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'The idempotency key is already bound to a different editorial shoot request',
          );
        }
        return publicShoot(raced);
      }
      await mkdir(this.shootDirectory(shootId), { recursive: true });
      await writeImmutable(this.biblePath(shootId), bibleBytes);
      const createdAt = nowIso(this.clock);
      const state = {
        schema_version: EDITORIAL_SCHEMA_VERSION,
        shoot_id: shootId,
        state_revision: 1,
        state_integrity_sha256: ZERO_SHA256,
        request_fingerprint: requestFingerprint,
        idempotency_hash: idempotencyHash,
        status: EDITORIAL_SHOOT_STATES.BIBLE_PENDING_APPROVAL,
        phase: 'BIBLE_REVIEW',
        message: 'ShootBible is persisted and awaits explicit approval',
        created_at: createdAt,
        updated_at: createdAt,
        event_cursor: 1,
        bindings: {
          approved_look: approvedLook,
          shoot_bible: {
            bible_id: bible.bible_id,
            mode_id: bible.mode_id,
            mode_version: bible.mode_version,
            sha256: bibleSha256,
            relative_path: 'inputs/shoot-bible.json',
            shot_spec_hashes: shotSpecHashes,
          },
        },
        bible_approval: null,
        hero_approval: null,
        retry_requests: [],
        shots: EDITORIAL_SHOT_SLOTS.map((slot) => ({
          slot,
          status: EDITORIAL_SHOT_STATES.BLOCKED,
          shot_spec_sha256: shotSpecHashes[slot],
          retry_count: 0,
          attempts: [],
          output: null,
          error: null,
          lease: null,
        })),
        cancellation: null,
      };
      await this.#persistInitial(state, 'shoot.created', {
        data: {
          mode_id: bible.mode_id,
          shot_count: EDITORIAL_SHOT_SLOTS.length,
          scheduler_max_concurrency: 2,
        },
      });
      return publicShoot(state);
    });
  }

  async approveBible(shootId, {
    idempotencyKey,
    expectedBibleSha256,
  }) {
    assertEditorialId(shootId, 'shootId');
    assertEditorialIdempotencyKey(idempotencyKey);
    assertEditorialSha256(expectedBibleSha256, 'expectedBibleSha256');
    const approvalHash = sha256(idempotencyKey);
    const state = await this.#mutate(shootId, (current) => {
      if (current.bible_approval?.idempotency_hash === approvalHash) {
        if (current.bible_approval.bible_sha256 !== expectedBibleSha256) {
          throw new EditorialShootServiceError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'The ShootBible approval key is already bound to another expected hash',
          );
        }
        return NO_CHANGE;
      }
      if (current.bible_approval) {
        throw new EditorialShootServiceError(
          409,
          'SHOOT_BIBLE_ALREADY_APPROVED',
          'ShootBible was already approved with a different idempotency key',
        );
      }
      if (current.status !== EDITORIAL_SHOOT_STATES.BIBLE_PENDING_APPROVAL) {
        throw new EditorialShootServiceError(
          409,
          'SHOOT_BIBLE_NOT_APPROVABLE',
          'ShootBible can only be approved before editorial generation starts',
        );
      }
      if (current.bindings.shoot_bible.sha256 !== expectedBibleSha256) {
        throw new EditorialShootServiceError(
          409,
          'SHOOT_BIBLE_HASH_CONFLICT',
          'ShootBible approval did not bind the exact persisted hash',
        );
      }
      const approvedAt = nowIso(this.clock);
      const parallelFashionShoot = isParallelFashionShoot(current);
      const shots = current.shots.map((shot) => {
        if (!parallelFashionShoot) {
          return shot.slot === EDITORIAL_HERO_SLOT
            ? { ...shot, status: EDITORIAL_SHOT_STATES.QUEUED }
            : shot;
        }
        // `clean_identity_hero` is a legacy technical slot. Fashion Shoot
        // delivers the other five frames immediately from the master-look and
        // style pack; no hidden first generation blocks the user.
        if (shot.slot === EDITORIAL_HERO_SLOT) {
          return { ...shot, status: EDITORIAL_SHOT_STATES.CANCELLED };
        }
        return { ...shot, status: EDITORIAL_SHOT_STATES.QUEUED };
      });
      return {
        state: {
          ...current,
          ...(parallelFashionShoot
            ? stateAfterShotMutation(current, shots)
            : {
              status: EDITORIAL_SHOOT_STATES.HERO_RUNNING,
              phase: 'HERO_GENERATION',
              message: 'ShootBible approved; only the clean identity hero is queued',
              shots,
            }),
          bible_approval: {
            idempotency_hash: approvalHash,
            bible_sha256: expectedBibleSha256,
            authority: 'EXPLICIT_API_APPROVAL',
            approved_at: approvedAt,
          },
          shots,
          cancellation: null,
        },
        event_type: 'shoot.bible_approved',
        data: {
          bible_sha256: expectedBibleSha256,
          queued_slots: parallelFashionShoot
            ? EDITORIAL_SHOT_SLOTS.slice(1)
            : [EDITORIAL_HERO_SLOT],
          scheduler_max_concurrency: parallelFashionShoot
            ? FASHION_SHOOT_GLOBAL_MAX_CONCURRENCY
            : 2,
        },
      };
    });
    this.start(shootId);
    return publicShoot(state);
  }

  async approveHero(shootId, {
    idempotencyKey,
    expectedOutputSha256,
  }) {
    assertEditorialId(shootId, 'shootId');
    assertEditorialIdempotencyKey(idempotencyKey);
    assertEditorialSha256(expectedOutputSha256, 'expectedOutputSha256');
    const approvalHash = sha256(idempotencyKey);
    const state = await this.#mutate(shootId, (current) => {
      if (current.hero_approval?.idempotency_hash === approvalHash) {
        if (current.hero_approval.output_sha256 !== expectedOutputSha256) {
          throw new EditorialShootServiceError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'The hero approval key is already bound to another expected output hash',
          );
        }
        return NO_CHANGE;
      }
      if (current.hero_approval) {
        throw new EditorialShootServiceError(
          409,
          'EDITORIAL_HERO_ALREADY_APPROVED',
          'The clean identity hero was already approved with another key',
        );
      }
      const hero = current.shots[0];
      if (current.status !== EDITORIAL_SHOOT_STATES.HERO_PENDING_APPROVAL
        || hero.status !== EDITORIAL_SHOT_STATES.QA_PASSED
        || !hero.output) {
        throw new EditorialShootServiceError(
          409,
          'EDITORIAL_HERO_NOT_APPROVABLE',
          'The clean identity hero must pass exact-hash QA before approval',
        );
      }
      if (hero.output.sha256 !== expectedOutputSha256) {
        throw new EditorialShootServiceError(
          409,
          'EDITORIAL_HERO_HASH_CONFLICT',
          'Hero approval did not bind the exact QA-passed output hash',
        );
      }
      const approvedAt = nowIso(this.clock);
      const shots = current.shots.map((shot, index) => {
        if (index === 0) return { ...shot, status: EDITORIAL_SHOT_STATES.APPROVED };
        return shot.status === EDITORIAL_SHOT_STATES.BLOCKED
          ? { ...shot, status: EDITORIAL_SHOT_STATES.QUEUED }
          : shot;
      });
      const base = {
        ...current,
        hero_approval: {
          idempotency_hash: approvalHash,
          output_sha256: expectedOutputSha256,
          receipt_sha256: hero.output.receipt_sha256,
          authority: 'EXPLICIT_API_APPROVAL',
          approved_at: approvedAt,
        },
        shots,
        cancellation: null,
      };
      return {
        state: {
          ...stateAfterShotMutation(base, shots),
          ...(shots.slice(1).some((shot) => shot.status === EDITORIAL_SHOT_STATES.QUEUED)
            ? {
              phase: 'SERIES_GENERATION',
              message: 'Hero approved; five remaining shots are queued with concurrency two',
            }
            : {}),
        },
        event_type: 'shoot.hero_approved',
        slot: EDITORIAL_HERO_SLOT,
        shot_output_sha256: expectedOutputSha256,
        data: {
          queued_slots: EDITORIAL_SHOT_SLOTS.slice(1),
          scheduler_max_concurrency: 2,
        },
      };
    });
    this.start(shootId);
    return publicShoot(state);
  }

  #runningForShoot(shootId) {
    return [...this.runningShots.entries()]
      .filter(([key]) => key.startsWith(`${shootId}:`))
      .map(([, promise]) => promise);
  }

  #runnableSlots(state) {
    const hero = state.shots[0];
    if (!state.bible_approval) return [];
    if (isParallelFashionShoot(state)) {
      return state.shots
        .slice(1)
        .filter((shot) => shot.status === EDITORIAL_SHOT_STATES.QUEUED)
        .map((shot) => shot.slot);
    }
    if (hero.status !== EDITORIAL_SHOT_STATES.APPROVED) {
      return hero.status === EDITORIAL_SHOT_STATES.QUEUED ? [EDITORIAL_HERO_SLOT] : [];
    }
    return state.shots
      .slice(1)
      .filter((shot) => shot.status === EDITORIAL_SHOT_STATES.QUEUED)
      .map((shot) => shot.slot);
  }

  start(shootId) {
    assertEditorialId(shootId, 'shootId');
    if (this.schedulers.has(shootId)) return this.schedulers.get(shootId);
    let scheduler;
    scheduler = (async () => {
      while (true) {
        const state = await this.#read(shootId);
        if (!state
          || EDITORIAL_TERMINAL_SHOOT_STATES.has(state.status)
          || [
            EDITORIAL_SHOOT_STATES.BIBLE_PENDING_APPROVAL,
            EDITORIAL_SHOOT_STATES.HERO_PENDING_APPROVAL,
          ].includes(state.status)) {
          break;
        }
        const maxConcurrency = shotConcurrencyLimit(state);
        const persistedRunning = state.shots.filter(
          (shot) => shot.status === EDITORIAL_SHOT_STATES.RUNNING,
        ).length;
        const capacity = Math.max(0, maxConcurrency - persistedRunning);
        const slots = this.#runnableSlots(state).slice(0, capacity);
        for (const slot of slots) {
          const key = `${shootId}:${slot}`;
          if (this.runningShots.has(key)) continue;
          const promise = this.#runShot(shootId, slot)
            .catch(() => undefined)
            .finally(() => {
              if (this.runningShots.get(key) === promise) this.runningShots.delete(key);
            });
          this.runningShots.set(key, promise);
        }
        const active = this.#runningForShoot(shootId);
        if (active.length === 0) break;
        await Promise.race(active);
      }
    })().finally(() => {
      if (this.schedulers.get(shootId) === scheduler) this.schedulers.delete(shootId);
    });
    this.schedulers.set(shootId, scheduler);
    return scheduler;
  }

  async #runShot(shootId, slot) {
    let operationId;
    let claimed = false;
    let reusingExistingExecution = false;
    let runningState;
    const releaseGlobalScheduler = await acquireFilesystemLock(this.globalSchedulerLockPath());
    if (!releaseGlobalScheduler) return;
    try {
      const globalRunningFashionFrames = await this.#runningFashionFrameCount();
      runningState = await this.#mutate(shootId, (current) => {
      const index = EDITORIAL_SHOT_SLOTS.indexOf(slot);
      const shot = current.shots[index];
      if (!shot || shot.status !== EDITORIAL_SHOT_STATES.QUEUED) return NO_CHANGE;
      if (isParallelFashionShoot(current)
        && globalRunningFashionFrames >= FASHION_SHOOT_GLOBAL_MAX_CONCURRENCY) {
        return NO_CHANGE;
      }
      const persistedRunning = current.shots.filter(
        (item) => item.status === EDITORIAL_SHOT_STATES.RUNNING,
      ).length;
      const concurrencyLimit = shotConcurrencyLimit(current);
      if (persistedRunning >= concurrencyLimit) return NO_CHANGE;
      const resumedAttempt = shot.attempts.at(-1)?.status === 'RUNNING'
        ? shot.attempts.at(-1)
        : null;
      reusingExistingExecution = resumedAttempt !== null;
      const number = resumedAttempt?.number ?? shot.attempts.length + 1;
      operationId = resumedAttempt?.operation_id
        ?? `editorial_${shootId.slice(-24)}_${slot}_${number}`;
      const attempt = resumedAttempt ?? {
        number,
        operation_id: operationId,
        // An execution address has to belong to one shoot. Derived from the look and
        // bible alone it did not, so shoot 24f54a3a re-derived shoot b1a8468c's six
        // scene ids; because each shoot conditions its five siblings on its own
        // approved hero frame, those requests could never match the fingerprint
        // already stored at that address, and interference_frame,
        // material_or_accessory_detail and wide_campaign_coda were recorded FAILED
        // on a 409 without ever reaching QA. The shoot id is the hash of the caller's
        // own creation key, so the address stays deterministic per shoot, slot and
        // attempt: a resumed or replayed attempt still pays for its scene once.
        execution_idempotency_key: sha256(
          `${shootId}:${current.request_fingerprint}:${slot}:${number}:execute`,
        ),
        status: 'RUNNING',
        started_at: nowIso(this.clock),
        completed_at: null,
        execution_id: null,
        output: null,
        qa: null,
        error: null,
      };
      const shots = [...current.shots];
      const acquiredAt = nowIso(this.clock);
      shots[index] = {
        ...shot,
        status: EDITORIAL_SHOT_STATES.RUNNING,
        attempts: resumedAttempt ? shot.attempts : [...shot.attempts, attempt],
        error: null,
        lease: {
          owner_id: this.instanceId,
          owner_pid: process.pid,
          owner_process_started_at: PROCESS_STARTED_AT_ISO,
          operation_id: operationId,
          acquired_at: acquiredAt,
          expires_at: new Date(Date.parse(acquiredAt) + this.leaseDurationMs).toISOString(),
        },
      };
      claimed = true;
      return {
        state: {
          ...current,
          status: slot === EDITORIAL_HERO_SLOT
            ? EDITORIAL_SHOOT_STATES.HERO_RUNNING
            : EDITORIAL_SHOOT_STATES.SERIES_RUNNING,
          phase: slot === EDITORIAL_HERO_SLOT ? 'HERO_GENERATION' : 'SERIES_GENERATION',
          message: `Executing editorial slot ${slot}`,
          shots,
        },
        event_type: resumedAttempt ? 'shot.resumed' : 'shot.started',
        slot,
        data: {
          attempt: number,
          operation_id: operationId,
          execution_idempotency_key: attempt.execution_idempotency_key,
        },
      };
      });
    } finally {
      await releaseGlobalScheduler();
    }
    if (!claimed) return;
    const shot = runningState.shots.find((item) => item.slot === slot);
    if (!shot
      || shot.status !== EDITORIAL_SHOT_STATES.RUNNING
      || shot.lease?.owner_id !== this.instanceId) return;
    const attempt = shot.attempts.at(-1);
    operationId = attempt.operation_id;
    const controller = new AbortController();
    this.controllers.set(`${shootId}:${slot}`, controller);
    try {
      const latest = await this.#read(shootId);
      const latestShot = latest?.shots.find((item) => item.slot === slot);
      if (latest?.status === EDITORIAL_SHOOT_STATES.CANCELLED
        || latestShot?.status !== EDITORIAL_SHOT_STATES.RUNNING
        || latestShot?.lease?.owner_id !== this.instanceId
        || latestShot?.lease?.operation_id !== operationId) {
        controller.abort();
        return;
      }
      const { bible } = await this.#readBible(shootId, runningState.bindings.shoot_bible);
      const shotSpec = bible.shots.find((item) => item.slot === slot);
      const heroOutput = slot === EDITORIAL_HERO_SLOT || isParallelFashionShoot(runningState)
        ? null
        : runningState.shots[0].output;
      const rawResult = await this.sceneExecutor.executeShot({
        shoot_id: shootId,
        slot,
        attempt: attempt.number,
        operation_id: operationId,
        idempotency_key: attempt.execution_idempotency_key,
        reuse_existing_execution: reusingExistingExecution,
        approved_look: clone(runningState.bindings.approved_look),
        shoot_bible: {
          bible_id: bible.bible_id,
          mode_id: bible.mode_id,
          mode_version: bible.mode_version,
          sha256: runningState.bindings.shoot_bible.sha256,
        },
        shot_spec: clone(shotSpec),
        shot_spec_sha256: shot.shot_spec_sha256,
        hero_output: heroOutput ? clone(heroOutput) : null,
        repair: repairInstructions(shot.attempts.at(-2)),
        delivery: {
          aspect_ratio: '3:4',
          width: 1536,
          height: 2048,
          media_type: 'image/png',
        },
        signal: controller.signal,
      });
      const result = validateEditorialExecutionResult(rawResult, {
        approvedLookSha256: runningState.bindings.approved_look.image_sha256,
        bibleSha256: runningState.bindings.shoot_bible.sha256,
        shotSpecSha256: shot.shot_spec_sha256,
      });
      await this.#mutate(shootId, (current) => {
        const index = EDITORIAL_SHOT_SLOTS.indexOf(slot);
        const currentShot = current.shots[index];
        const currentAttempt = currentShot.attempts.at(-1);
        if (currentShot.status !== EDITORIAL_SHOT_STATES.RUNNING
          || currentAttempt?.operation_id !== operationId
          || currentShot.lease?.owner_id !== this.instanceId) {
          return NO_CHANGE;
        }
        const completedAttempt = {
          ...currentAttempt,
          status: result.decision,
          completed_at: result.qa.completed_at,
          execution_id: result.execution_id,
          output: result.output,
          qa: result.qa,
          error: result.decision === 'PASS'
            ? null
            : {
              code: 'BLOCKING_QA_FAILED',
              message: result.qa.gates
                .filter((gate) => gate.decision === 'FAIL')
                .map((gate) => gate.id)
                .join(', '),
            },
        };
        const attempts = [...currentShot.attempts];
        attempts[attempts.length - 1] = completedAttempt;
        const failure = result.decision === 'PASS' ? null : completedAttempt.error;
        const autoRepair = failure !== null && canAutoRepair(currentShot, failure.code);
        const nextShot = {
          ...currentShot,
          status: result.decision === 'PASS'
            ? (slot === EDITORIAL_HERO_SLOT
              ? EDITORIAL_SHOT_STATES.QA_PASSED
              : EDITORIAL_SHOT_STATES.APPROVED)
            : (autoRepair ? EDITORIAL_SHOT_STATES.QUEUED : EDITORIAL_SHOT_STATES.FAILED),
          retry_count: autoRepair ? currentShot.retry_count + 1 : currentShot.retry_count,
          attempts,
          output: result.decision === 'PASS' ? result.output : null,
          error: autoRepair ? null : failure,
          lease: null,
        };
        const shots = [...current.shots];
        shots[index] = nextShot;
        return {
          state: stateAfterShotMutation(current, shots),
          event_type: result.decision === 'PASS'
            ? 'shot.qa_passed'
            : (autoRepair ? 'shot.auto_repair_queued' : 'shot.qa_failed'),
          slot,
          shot_output_sha256: result.output?.sha256 ?? null,
          data: {
            attempt: completedAttempt.number,
            operation_id: operationId,
            decision: result.decision,
            candidate_sha256: result.qa.candidate_sha256,
            receipt_sha256: result.output?.receipt_sha256 ?? null,
            auto_repair: autoRepair,
            retry_count: nextShot.retry_count,
            failed_gates: result.qa.gates
              .filter((gate) => gate.decision === 'FAIL')
              .map((gate) => gate.id),
          },
        };
      });
    } catch (error) {
      await this.#mutate(shootId, (current) => {
        const index = EDITORIAL_SHOT_SLOTS.indexOf(slot);
        const currentShot = current.shots[index];
        const currentAttempt = currentShot.attempts.at(-1);
        if (currentShot.status !== EDITORIAL_SHOT_STATES.RUNNING
          || currentAttempt?.operation_id !== operationId
          || currentShot.lease?.owner_id !== this.instanceId) {
          return NO_CHANGE;
        }
        const completedAt = nowIso(this.clock);
        const failure = {
          code: error?.name === 'AbortError' ? 'EXECUTION_CANCELLED' : 'EXECUTOR_FAILED',
          message: safeErrorMessage(error),
        };
        const attempts = [...currentShot.attempts];
        attempts[attempts.length - 1] = {
          ...currentAttempt,
          status: 'FAIL',
          completed_at: completedAt,
          error: failure,
        };
        const autoRepair = canAutoRepair(currentShot, failure.code);
        const shots = [...current.shots];
        shots[index] = {
          ...currentShot,
          status: autoRepair ? EDITORIAL_SHOT_STATES.QUEUED : EDITORIAL_SHOT_STATES.FAILED,
          retry_count: autoRepair ? currentShot.retry_count + 1 : currentShot.retry_count,
          attempts,
          output: null,
          error: autoRepair ? null : failure,
          lease: null,
        };
        return {
          state: stateAfterShotMutation(current, shots),
          event_type: autoRepair ? 'shot.auto_repair_queued' : 'shot.executor_failed',
          slot,
          data: {
            attempt: currentAttempt.number,
            operation_id: operationId,
            code: failure.code,
            auto_repair: autoRepair,
            retry_count: shots[index].retry_count,
          },
        };
      });
    } finally {
      const key = `${shootId}:${slot}`;
      if (this.controllers.get(key) === controller) this.controllers.delete(key);
    }
  }

  async retryShot(shootId, slot, { idempotencyKey }) {
    assertEditorialId(shootId, 'shootId');
    if (!EDITORIAL_SHOT_SLOTS.includes(slot)) {
      throw new EditorialShootServiceError(422, 'EDITORIAL_SLOT_INVALID', 'Unknown editorial shot slot');
    }
    assertEditorialIdempotencyKey(idempotencyKey);
    const idempotencyHash = sha256(idempotencyKey);
    const state = await this.#mutate(shootId, (current) => {
      const existing = current.retry_requests.find(
        (request) => request.idempotency_hash === idempotencyHash,
      );
      if (existing) {
        if (existing.slot !== slot) {
          throw new EditorialShootServiceError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'The retry idempotency key is bound to another editorial slot',
          );
        }
        return NO_CHANGE;
      }
      const index = EDITORIAL_SHOT_SLOTS.indexOf(slot);
      const shot = current.shots[index];
      if (shot.status !== EDITORIAL_SHOT_STATES.FAILED) {
        throw new EditorialShootServiceError(
          409,
          'EDITORIAL_SHOT_NOT_RETRYABLE',
          'Only one failed editorial shot can be retried',
        );
      }
      if (!isParallelFashionShoot(current)
        && slot !== EDITORIAL_HERO_SLOT
        && current.shots[0].status !== EDITORIAL_SHOT_STATES.APPROVED) {
        throw new EditorialShootServiceError(
          409,
          'EDITORIAL_HERO_BARRIER',
          'Post-hero shots cannot run before exact-hash hero approval',
        );
      }
      const previousAttempt = shot.attempts.at(-1) ?? null;
      // An executor can fail after its child SceneService has already finished
      // and persisted a valid output (for example, when this parent still
      // expected the legacy 4:5 canvas). A manual retry must replay the exact
      // execution address so SceneService can return that immutable result; a
      // new attempt number would create a new provider job for no new pixels.
      const resumeExecutorFailure = previousAttempt?.status === 'FAIL'
        && previousAttempt?.error?.code === 'EXECUTOR_FAILED'
        && previousAttempt?.execution_id === null;
      const requestFingerprint = sha256(canonicalJsonBytes({
        shoot_id: shootId,
        slot,
        previous_attempt: previousAttempt?.number ?? 0,
        previous_candidate_sha256: previousAttempt?.qa?.candidate_sha256 ?? null,
      }));
      const shots = [...current.shots];
      const attempts = resumeExecutorFailure
        ? [
            ...shot.attempts.slice(0, -1),
            {
              ...previousAttempt,
              status: 'RUNNING',
              completed_at: null,
              output: null,
              qa: null,
              error: null,
            },
          ]
        : shot.attempts;
      shots[index] = {
        ...shot,
        status: EDITORIAL_SHOT_STATES.QUEUED,
        retry_count: shot.retry_count + 1,
        attempts,
        output: null,
        error: null,
        lease: null,
      };
      return {
        state: {
          ...current,
          status: slot === EDITORIAL_HERO_SLOT
            ? EDITORIAL_SHOOT_STATES.HERO_RUNNING
            : EDITORIAL_SHOOT_STATES.SERIES_RUNNING,
          phase: slot === EDITORIAL_HERO_SLOT ? 'HERO_RETRY' : 'SHOT_RETRY',
          message: `Only ${slot} was queued for retry; all sibling outputs remain immutable`,
          hero_approval: slot === EDITORIAL_HERO_SLOT ? null : current.hero_approval,
          retry_requests: [
            ...current.retry_requests,
            {
              idempotency_hash: idempotencyHash,
              request_fingerprint: requestFingerprint,
              slot,
              requested_at: nowIso(this.clock),
            },
          ],
          shots,
          cancellation: null,
        },
        event_type: 'shot.retry_queued',
        slot,
        data: {
          retry_count: shot.retry_count + 1,
          request_fingerprint: requestFingerprint,
          resumed_executor_failure: resumeExecutorFailure,
        },
      };
    });
    this.start(shootId);
    return publicShoot(state);
  }

  async cancelShoot(shootId, reason = 'Cancelled by request') {
    assertEditorialId(shootId, 'shootId');
    const state = await this.#mutate(shootId, (current) => {
      if (current.status === EDITORIAL_SHOOT_STATES.CANCELLED) return NO_CHANGE;
      if (current.status === EDITORIAL_SHOOT_STATES.COMPLETED) {
        throw new EditorialShootServiceError(
          409,
          'EDITORIAL_SHOOT_NOT_CANCELLABLE',
          'A completed editorial shoot cannot be cancelled',
        );
      }
      const cancelledAt = nowIso(this.clock);
      const shots = current.shots.map((shot) => {
        if (![EDITORIAL_SHOT_STATES.BLOCKED, EDITORIAL_SHOT_STATES.QUEUED, EDITORIAL_SHOT_STATES.RUNNING]
          .includes(shot.status)) {
          return shot;
        }
        const attempts = [...shot.attempts];
        const active = attempts.at(-1);
        if (active?.status === 'RUNNING') {
          attempts[attempts.length - 1] = {
            ...active,
            status: 'CANCELLED',
            completed_at: cancelledAt,
            error: {
              code: 'EXECUTION_CANCELLED',
              message: 'Cancelled by editorial shoot request',
            },
          };
        }
        return {
          ...shot,
          status: EDITORIAL_SHOT_STATES.CANCELLED,
          attempts,
          output: null,
          error: null,
          lease: null,
        };
      });
      return {
        state: {
          ...current,
          status: EDITORIAL_SHOOT_STATES.CANCELLED,
          phase: 'CANCELLED',
          message: 'Editorial shoot generation cancelled; passed shots remain preserved',
          shots,
          cancellation: {
            reason: String(reason).slice(0, 300),
            cancelled_at: cancelledAt,
          },
        },
        event_type: 'shoot.cancelled',
        data: {
          preserved_slots: shots
            .filter((shot) => [EDITORIAL_SHOT_STATES.QA_PASSED, EDITORIAL_SHOT_STATES.APPROVED]
              .includes(shot.status))
            .map((shot) => shot.slot),
        },
      };
    });
    for (const [key, controller] of this.controllers.entries()) {
      if (key.startsWith(`${shootId}:`)) controller.abort();
    }
    return publicShoot(state);
  }

  async getShoot(shootId) {
    assertEditorialId(shootId, 'shootId');
    const state = await this.#read(shootId);
    if (!state) return null;
    await this.listEvents(shootId, { after: state.event_cursor });
    return publicShoot(state);
  }

  async getShootBible(shootId) {
    assertEditorialId(shootId, 'shootId');
    const state = await this.#read(shootId);
    if (!state) return null;
    return clone((await this.#readBible(shootId, state.bindings.shoot_bible)).bible);
  }

  async outputFile(shootId, slot) {
    assertEditorialId(shootId, 'shootId');
    if (!EDITORIAL_SHOT_SLOTS.includes(slot)) {
      throw new EditorialShootServiceError(
        422,
        'EDITORIAL_SLOT_INVALID',
        'Unknown editorial shot slot',
      );
    }
    const state = await this.#read(shootId);
    if (!state) return null;
    const shot = state.shots.find((item) => item.slot === slot);
    if (!shot?.output
      || ![EDITORIAL_SHOT_STATES.QA_PASSED, EDITORIAL_SHOT_STATES.APPROVED]
        .includes(shot.status)
      || typeof this.sceneExecutor.outputFile !== 'function') {
      return null;
    }
    return this.sceneExecutor.outputFile({
      resourceId: shot.output.resource_id,
      expectedSha256: shot.output.sha256,
      expectedReceiptSha256: shot.output.receipt_sha256,
    });
  }

  async deleteShoot(shootId) {
    assertEditorialId(shootId, 'shootId');
    let state = await this.#read(shootId);
    if (!state) return false;
    if (!EDITORIAL_TERMINAL_SHOOT_STATES.has(state.status)) {
      try {
        await this.cancelShoot(shootId, 'Editorial shoot resource deleted');
      } catch (error) {
        if (error?.code !== 'EDITORIAL_SHOOT_NOT_CANCELLABLE') throw error;
      }
      state = await this.waitForIdle(shootId);
    }
    const executions = new Map();
    for (const shot of state.shots) {
      for (const attempt of shot.attempts) {
        executions.set(
          attempt.execution_id ?? `idempotency:${attempt.execution_idempotency_key}`,
          {
            executionId: attempt.execution_id,
            idempotencyKey: attempt.execution_idempotency_key,
          },
        );
      }
    }
    if (typeof this.sceneExecutor.deleteExecution === 'function') {
      for (const execution of executions.values()) {
        await this.sceneExecutor.deleteExecution(execution);
      }
    }
    const directory = this.shootDirectory(shootId);
    if (!directory.startsWith(`${this.rootDirectory}${path.sep}`)) {
      throw new Error('Unsafe editorial shoot directory');
    }
    await rm(directory, { recursive: true, force: true });
    return true;
  }

  async listEvents(shootId, { after = 0 } = {}) {
    assertEditorialId(shootId, 'shootId');
    if (!Number.isInteger(after) || after < 0) {
      throw new Error('Editorial event cursor must be a non-negative integer');
    }
    const state = await this.#read(shootId);
    if (!state) return [];
    const result = [];
    let previousSha256 = ZERO_SHA256;
    let latestSeenEvent = null;
    const firstPassedOutputBySlot = new Map();
    for (let eventId = 1; eventId <= state.event_cursor; eventId += 1) {
      const event = JSON.parse(await readFile(this.eventPath(shootId, eventId), 'utf8'));
      if (event.event_id !== eventId
        || event.shoot_id !== shootId
        || event.previous_event_sha256 !== previousSha256
        || event.event_sha256 !== eventHash(event)
        || event.bindings.approved_look_image_sha256 !== state.bindings.approved_look.image_sha256
        || event.bindings.approved_look_receipt_sha256 !== state.bindings.approved_look.receipt_sha256
        || event.bindings.shoot_bible_sha256 !== state.bindings.shoot_bible.sha256) {
        throw new EditorialShootServiceError(
          409,
          'EDITORIAL_EVENT_INTEGRITY_FAILED',
          'The editorial event chain no longer matches its exact hash bindings',
        );
      }
      previousSha256 = event.event_sha256;
      latestSeenEvent = event;
      if (event.event_type === 'shot.qa_passed'
        && event.slot
        && event.shot_output_sha256
        && !firstPassedOutputBySlot.has(event.slot)) {
        firstPassedOutputBySlot.set(event.slot, event.shot_output_sha256);
      }
      if (eventId > after) result.push(clone(event));
    }
    if (!latestSeenEvent
      || latestSeenEvent.event_id !== state.event_cursor
      || latestSeenEvent.state_sha256 !== state.state_integrity_sha256) {
      throw new EditorialShootServiceError(
        409,
        'EDITORIAL_EVENT_INTEGRITY_FAILED',
        'The latest editorial event is not bound to the current state hash',
      );
    }
    for (const shot of state.shots) {
      if ([EDITORIAL_SHOT_STATES.QA_PASSED, EDITORIAL_SHOT_STATES.APPROVED].includes(shot.status)
        && firstPassedOutputBySlot.get(shot.slot) !== shot.output?.sha256) {
        throw new EditorialShootServiceError(
          409,
          'EDITORIAL_EVENT_INTEGRITY_FAILED',
          `The approved editorial slot ${shot.slot} changed after its first exact-hash PASS event`,
        );
      }
    }
    return result;
  }

  subscribe(shootId, listener) {
    assertEditorialId(shootId, 'shootId');
    this.events.on(shootId, listener);
    return () => this.events.off(shootId, listener);
  }

  async waitForIdle(shootId) {
    assertEditorialId(shootId, 'shootId');
    while (true) {
      const scheduler = this.schedulers.get(shootId);
      const running = this.#runningForShoot(shootId);
      if (!scheduler && running.length === 0) return this.getShoot(shootId);
      await Promise.allSettled([...(scheduler ? [scheduler] : []), ...running]);
    }
  }
}
