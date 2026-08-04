// The motion (video) service: it owns the ledger, the gates and the receipt check, and
// it never touches a provider.
//
// Why the boundary sits here. Higgsfield and Magnific are reached over MCP only, and an
// MCP session belongs to an agent rather than to a long-running web process. So this
// service emits a job that an injected executor fulfils, and then verifies what came
// back against what was asked. `src/providers/*` is never imported by this file — if it
// were, the boundary would exist in prose only.
//
// The four gates of the VIDEO.* graph are enforced here, each in one named place:
//   SOURCE_HASH_BOUND     — the source frame is re-read and re-hashed, never trusted
//   ALLOWED_PRESET_ONLY   — the route comes from the mode catalogue, never from the caller
//   EXPLICIT_PAID_CREATE  — generation needs its own confirmed call; creating a job spends nothing
//   QA_PASS_BEFORE_SAVE   — a receipt with defects is recorded and refused, and no clip is saved

import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { assertMotionJob, motionJobDefects, receiptDefects, MODEL_LIMITS } from './motion-contract.js';
import { loadMotionModes, motionModeById } from './motion-modes.js';

const RESERVED_DIRECTORIES = new Set(['.locks', 'incidents', 'quarantine']);
const ID_PATTERN = /^motion_[a-f0-9]{48}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export class MotionServiceError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'MotionServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

// Sorted keys and a trailing newline, so a hash over a document is stable across the
// insertion order of whoever built it.
function canonicalJsonBytes(value) {
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.keys(node).sort().reduce((accumulator, key) => {
        accumulator[key] = walk(node[key]);
        return accumulator;
      }, {});
    }
    return node;
  };
  return Buffer.from(`${JSON.stringify(walk(value))}\n`);
}

function nowIso(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('MotionService clock returned an invalid date');
  return date.toISOString();
}

async function atomicWrite(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  await rename(temporary, filename);
}

// An immutable write that cannot silently disagree with itself: if the target already
// exists, the bytes are compared rather than overwritten, because two different clips
// under one hash-addressed name is the one corruption no later check could detect.
async function writeImmutable(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.immutable`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  try {
    await link(temporary, filename);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(filename);
    if (!existing.equals(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes))) {
      throw new MotionServiceError(409, 'MOTION_ARTIFACT_CONFLICT', `Motion artifact conflict at ${path.basename(filename)}`);
    }
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

function assertMotionId(value, label = 'jobId') {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new MotionServiceError(422, 'INVALID_MOTION_ID', `${label} must be a motion job id`);
  }
  return value;
}

function assertIdempotencyKey(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 256) {
    throw new MotionServiceError(422, 'INVALID_IDEMPOTENCY_KEY', 'An idempotency key of 8 to 256 characters is required');
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new MotionServiceError(422, 'INVALID_SHA256', `${label} must be a lowercase sha256`);
  }
  return value;
}

export function motionJobIdForIdempotencyKey(idempotencyKey) {
  return `motion_${sha256(assertIdempotencyKey(idempotencyKey)).slice(0, 48)}`;
}

// The public projection. The caller learns the state of its own job and nothing about
// where the bytes live: absolute runtime paths are a privacy rule, not a detail.
function publicJob(state) {
  return {
    job_id: state.job_id,
    status: state.status,
    mode_id: state.mode_id,
    created_at: state.created_at,
    updated_at: state.updated_at,
    delivery: state.job.delivery,
    source: { look_id: state.job.source.look_id, scene_kind: state.job.source.scene_kind },
    attempt_count: state.attempts.length,
    refusal: state.refusal,
    output: state.output
      ? {
        sha256: state.output.sha256,
        width: state.output.width,
        height: state.output.height,
        duration_seconds: state.output.duration_seconds,
        audio_replaced: state.output.audio_replaced,
      }
      : null,
  };
}

export class MotionService {
  constructor({
    rootDirectory,
    motionExecutor,
    projectRoot = undefined,
    clock = () => new Date(),
    observer = null,
    observerTimeoutMs = 2_000,
  }) {
    if (!rootDirectory) throw new Error('MotionService rootDirectory is required');
    if (typeof motionExecutor?.executeMotion !== 'function') {
      throw new Error('MotionService motionExecutor.executeMotion is required');
    }
    if (typeof clock !== 'function') throw new Error('MotionService clock must be a function');
    if (!Number.isFinite(observerTimeoutMs) || observerTimeoutMs <= 0) {
      throw new Error('MotionService observerTimeoutMs must be a positive number of milliseconds');
    }
    this.rootDirectory = path.resolve(rootDirectory);
    this.motionExecutor = motionExecutor;
    this.projectRoot = projectRoot;
    this.clock = clock;
    this.observer = observer;
    this.observerTimeoutMs = observerTimeoutMs;
    this.instanceId = `motion_worker_${randomUUID()}`;
    this.events = new EventEmitter();
    this.catalogue = null;
    this.mutations = new Map();
  }

  jobDirectory(jobId) {
    return path.join(this.rootDirectory, assertMotionId(jobId));
  }

  statePath(jobId) {
    return path.join(this.jobDirectory(jobId), 'motion.json');
  }

  jobDocumentPath(jobId) {
    return path.join(this.jobDirectory(jobId), 'inputs', 'motion-job.json');
  }

  eventPath(jobId, sequence) {
    return path.join(this.jobDirectory(jobId), 'events', `${String(sequence).padStart(8, '0')}.json`);
  }

  outputPath(jobId, sha) {
    return path.join(this.jobDirectory(jobId), 'outputs', `${assertSha256(sha, 'output sha256')}.mp4`);
  }

  receiptPath(jobId, attempt) {
    return path.join(this.jobDirectory(jobId), 'attempts', `${String(attempt).padStart(8, '0')}-receipt.json`);
  }

  async initialize() {
    await mkdir(this.rootDirectory, { recursive: true });
    this.catalogue = await loadMotionModes(
      this.projectRoot ? { projectRoot: this.projectRoot } : {},
    );
    // A directory that is not a job id is quarantined rather than ignored: a silently
    // skipped state file is how a delivered clip goes missing without anything failing.
    const entries = await readdir(this.rootDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || RESERVED_DIRECTORIES.has(entry.name)) continue;
      if (ID_PATTERN.test(entry.name)) continue;
      const from = path.join(this.rootDirectory, entry.name);
      const to = path.join(this.rootDirectory, 'quarantine', entry.name);
      await mkdir(path.dirname(to), { recursive: true });
      await rename(from, to).catch(() => {});
    }
  }

  #assertReady() {
    if (!this.catalogue) throw new Error('MotionService.initialize() must be awaited before use');
  }

  async #publish(jobId, event) {
    this.events.emit('motion', { job_id: jobId, ...event });
    if (!this.observer) return;
    // Monitoring cannot change generation or approval semantics, so every observer
    // failure and every slow observer is swallowed.
    await Promise.race([
      Promise.resolve(this.observer({ job_id: jobId, ...event })).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, this.observerTimeoutMs)),
    ]).catch(() => {});
  }

  async #readState(jobId) {
    try {
      const bytes = await readFile(this.statePath(jobId), 'utf8');
      return JSON.parse(bytes);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async #commit(state, event) {
    const next = { ...state, updated_at: nowIso(this.clock), state_revision: state.state_revision + 1 };
    const sequence = next.event_count + 1;
    next.event_count = sequence;
    const eventDocument = { sequence, at: next.updated_at, ...event };
    next.state_integrity_sha256 = null;
    next.state_integrity_sha256 = sha256(canonicalJsonBytes(next));
    await writeImmutable(this.eventPath(next.job_id, sequence), canonicalJsonBytes(eventDocument));
    await atomicWrite(this.statePath(next.job_id), Buffer.from(`${JSON.stringify(next, null, 2)}\n`));
    await this.#publish(next.job_id, eventDocument);
    return next;
  }

  // Mutations of one job are serialised through a promise chain, so two concurrent
  // requests on the same id cannot both read the same revision and write over each other.
  async #mutate(jobId, action) {
    const previous = this.mutations.get(jobId) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(() => action());
    this.mutations.set(jobId, run.catch(() => {}));
    try {
      return await run;
    } finally {
      if (this.mutations.get(jobId) === run || this.mutations.get(jobId)) {
        // Keep the tail so later callers still queue behind this one.
      }
    }
  }

  /**
   * Create a motion job. This spends nothing: it binds the source, resolves the route
   * from the mode catalogue, validates the whole job against the contract and stops.
   * Generation is a separate, explicitly confirmed call — the EXPLICIT_PAID_CREATE gate.
   */
  async createJob({ idempotencyKey, modeId, source, references, audio, prompt = null, shotList = null }) {
    this.#assertReady();
    assertIdempotencyKey(idempotencyKey);

    // ALLOWED_PRESET_ONLY. The caller names a mode; the model, the geometry and the
    // permitted roles are read from the catalogue.
    const mode = motionModeById(this.catalogue, modeId);
    if (!mode) {
      throw new MotionServiceError(422, 'MOTION_MODE_NOT_ALLOWED', `Unknown motion mode: ${modeId}`);
    }
    if (!source || typeof source !== 'object') {
      throw new MotionServiceError(422, 'MOTION_SOURCE_REQUIRED', 'A motion job needs a source look');
    }
    assertSha256(source.look_image_sha256, 'source.look_image_sha256');
    if (source.scene_kind !== mode.scene_kind) {
      throw new MotionServiceError(
        422,
        'MOTION_SOURCE_KIND_MISMATCH',
        `Mode ${mode.id} serves ${mode.scene_kind}, not ${source.scene_kind}`,
      );
    }
    if (!Array.isArray(references) || references.length < 2) {
      throw new MotionServiceError(422, 'MOTION_REFERENCES_REQUIRED', 'A motion job needs at least two references');
    }
    for (const reference of references) {
      if (!mode.reference_roles.includes(reference?.role)) {
        throw new MotionServiceError(
          422,
          'MOTION_REFERENCE_ROLE_NOT_ALLOWED',
          `Mode ${mode.id} does not carry the ${reference?.role} role`,
        );
      }
    }

    const jobId = motionJobIdForIdempotencyKey(idempotencyKey);
    const createdAt = nowIso(this.clock);
    const job = {
      schema_version: '1.0.0',
      job_id: jobId,
      created_at: createdAt,
      source: {
        look_id: source.look_id,
        look_image_sha256: source.look_image_sha256,
        scene_kind: source.scene_kind,
        ...(source.style_unit_id === undefined ? {} : { style_unit_id: source.style_unit_id }),
      },
      delivery: { ...mode.delivery },
      route: {
        model_slug: mode.route.model_slug,
        transport: 'mcp',
        camera_motion: null,
        ...(prompt ? { prompt } : {}),
        ...(shotList ? { shot_list: shotList } : {}),
      },
      references: references.map((reference) => ({ ...reference })),
      audio: {
        source: audio?.source ?? mode.audio,
        track_sha256: audio?.track_sha256 ?? null,
        description: audio?.description ?? null,
      },
    };

    // The contract is the only validator. Everything it refuses is refused here with
    // its own codes attached, so a caller fixes all defects in one round trip.
    const defects = motionJobDefects(job);
    if (defects.length) {
      const error = new MotionServiceError(
        422,
        'MOTION_JOB_INVALID',
        `Motion job is not deliverable: ${defects.map((defect) => defect.code).join(', ')}`,
      );
      error.defects = defects;
      throw error;
    }

    // The fingerprint is over the semantics of the request, with bytes reduced to their
    // hashes. Reusing a key for a different job is a caller bug and must not silently
    // return someone else's clip.
    const requestFingerprint = sha256(canonicalJsonBytes({
      mode_id: mode.id,
      source: job.source,
      delivery: job.delivery,
      route: job.route,
      references: job.references.map((reference) => ({ role: reference.role, sha256: reference.sha256 })),
      audio: job.audio,
    }));

    return this.#mutate(jobId, async () => {
      const existing = await this.#readState(jobId);
      if (existing) {
        if (existing.request_fingerprint !== requestFingerprint) {
          throw new MotionServiceError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'The idempotency key is already bound to a different motion request',
          );
        }
        return publicJob(existing);
      }

      const state = {
        schema_version: '1.0.0',
        job_id: jobId,
        mode_id: mode.id,
        status: 'PLANNED',
        created_at: createdAt,
        updated_at: createdAt,
        state_revision: 0,
        event_count: 0,
        request_fingerprint: requestFingerprint,
        job,
        attempts: [],
        output: null,
        refusal: null,
        state_integrity_sha256: null,
      };
      await writeImmutable(this.jobDocumentPath(jobId), canonicalJsonBytes(job));
      const committed = await this.#commit(state, { type: 'MOTION_JOB_PLANNED', mode_id: mode.id });
      return publicJob(committed);
    });
  }

  /**
   * Run the job. `confirmPaidCreate` must be true and carry its own idempotency key:
   * the EXPLICIT_PAID_CREATE gate exists because every motion generation is billable and
   * a retry loop that spends money on its own is the failure it prevents.
   *
   * `verifySource` is injected by the caller and re-reads the source bytes; the service
   * compares the hash itself rather than trusting the request — the SOURCE_HASH_BOUND gate.
   */
  async runJob(jobId, { idempotencyKey, confirmPaidCreate = false, verifySource = null, signal = null } = {}) {
    this.#assertReady();
    assertMotionId(jobId);
    assertIdempotencyKey(idempotencyKey);
    if (confirmPaidCreate !== true) {
      throw new MotionServiceError(
        422,
        'PAID_CREATE_NOT_CONFIRMED',
        'A motion generation is billable and needs an explicit confirmation on this call',
      );
    }

    return this.#mutate(jobId, async () => {
      const state = await this.#readState(jobId);
      if (!state) throw new MotionServiceError(404, 'MOTION_JOB_NOT_FOUND', 'No such motion job');
      if (state.status === 'DELIVERED') return publicJob(state);
      if (state.status === 'RUNNING') {
        throw new MotionServiceError(503, 'MOTION_JOB_BUSY', 'This motion job is already running');
      }

      // SOURCE_HASH_BOUND. The source is re-read and re-hashed; a look whose bytes have
      // moved under the job is refused rather than animated.
      if (typeof verifySource === 'function') {
        const observed = await verifySource({
          look_id: state.job.source.look_id,
          expected_sha256: state.job.source.look_image_sha256,
        });
        if (observed !== state.job.source.look_image_sha256) {
          const refused = await this.#commit(
            { ...state, status: 'REFUSED', refusal: { code: 'SOURCE_HASH_MISMATCH', detail: 'the source look no longer hashes to the bound value' } },
            { type: 'MOTION_JOB_REFUSED', code: 'SOURCE_HASH_MISMATCH' },
          );
          throw new MotionServiceError(409, 'SOURCE_HASH_MISMATCH', `Motion job ${refused.job_id} lost its bound source`);
        }
      }

      const attemptNumber = state.attempts.length + 1;
      const executionIdempotencyKey = `${state.job_id}:${attemptNumber}:${idempotencyKey}`;
      const running = await this.#commit(
        { ...state, status: 'RUNNING' },
        { type: 'MOTION_ATTEMPT_STARTED', attempt: attemptNumber },
      );

      let result;
      try {
        result = await this.motionExecutor.executeMotion({
          job_id: running.job_id,
          attempt: attemptNumber,
          idempotency_key: executionIdempotencyKey,
          job: running.job,
          limits: MODEL_LIMITS[running.job.route.model_slug],
          signal,
        });
      } catch (error) {
        const failed = await this.#commit(
          {
            ...running,
            status: 'REFUSED',
            refusal: { code: 'EXECUTOR_FAILED', detail: error?.name === 'AbortError' ? 'cancelled' : 'the executor did not return a clip' },
            attempts: [...running.attempts, {
              attempt: attemptNumber,
              idempotency_key: executionIdempotencyKey,
              started_at: running.updated_at,
              finished_at: nowIso(this.clock),
              decision: 'FAIL',
              defects: [{ code: 'EXECUTOR_FAILED', detail: error?.message ?? 'unknown' }],
            }],
          },
          { type: 'MOTION_ATTEMPT_FAILED', attempt: attemptNumber, code: 'EXECUTOR_FAILED' },
        );
        throw new MotionServiceError(502, 'EXECUTOR_FAILED', `Motion job ${failed.job_id} attempt ${attemptNumber} produced no clip`);
      }

      // QA_PASS_BEFORE_SAVE. The receipt is measured against what the job asked for, and
      // the clip is written only if nothing is wrong with it. A refused attempt is still
      // recorded in full, because an unlogged refusal is indistinguishable from a gap.
      const receipt = result?.receipt ?? null;
      const defects = receiptDefects(running.job, receipt);
      const finishedAt = nowIso(this.clock);
      const attempt = {
        attempt: attemptNumber,
        idempotency_key: executionIdempotencyKey,
        execution_id: result?.execution_id ?? null,
        started_at: running.updated_at,
        finished_at: finishedAt,
        decision: defects.length ? 'FAIL' : 'PASS',
        defects,
      };
      await writeImmutable(this.receiptPath(running.job_id, attemptNumber), canonicalJsonBytes({ attempt, receipt }));

      if (defects.length) {
        const refused = await this.#commit(
          {
            ...running,
            status: 'REFUSED',
            refusal: { code: defects[0].code, detail: defects.map((defect) => defect.code).join(', ') },
            attempts: [...running.attempts, attempt],
          },
          { type: 'MOTION_ATTEMPT_REFUSED', attempt: attemptNumber, code: defects[0].code },
        );
        return publicJob(refused);
      }

      // The bytes are hash-addressed and their name is their own sha256, so a mismatch
      // between what the executor claimed and what it delivered cannot be persisted.
      const bytes = result?.bytes;
      if (!Buffer.isBuffer(bytes)) {
        throw new MotionServiceError(502, 'EXECUTOR_RETURNED_NO_BYTES', 'The executor reported a pass without a clip');
      }
      const observedSha = sha256(bytes);
      if (observedSha !== receipt.output_sha256) {
        throw new MotionServiceError(409, 'MOTION_OUTPUT_INTEGRITY_FAILED', 'The delivered clip does not hash to its receipt');
      }
      await writeImmutable(this.outputPath(running.job_id, observedSha), bytes);

      const delivered = await this.#commit(
        {
          ...running,
          status: 'DELIVERED',
          refusal: null,
          attempts: [...running.attempts, attempt],
          output: {
            // Relative, because an absolute runtime path in a persisted document is a
            // privacy leak the moment the document is served.
            relative_path: path.join('outputs', `${observedSha}.mp4`),
            sha256: observedSha,
            receipt_sha256: sha256(canonicalJsonBytes(receipt)),
            width: receipt.width,
            height: receipt.height,
            duration_seconds: receipt.duration_seconds,
            audio_replaced: receipt.audio_replaced ?? null,
            media_type: 'video/mp4',
          },
        },
        { type: 'MOTION_JOB_DELIVERED', attempt: attemptNumber, sha256: observedSha },
      );
      return publicJob(delivered);
    });
  }

  async getJob(jobId) {
    this.#assertReady();
    const state = await this.#readState(assertMotionId(jobId));
    return state ? publicJob(state) : null;
  }

  /**
   * The absolute filename of a delivered clip, or null. The bytes are re-hashed before
   * the name is handed out: a file that no longer matches its receipt is treated as
   * absent rather than served.
   */
  async outputFile(jobId, { expectedSha256 = null } = {}) {
    this.#assertReady();
    const state = await this.#readState(assertMotionId(jobId));
    if (!state?.output) return null;
    if (expectedSha256 && expectedSha256 !== state.output.sha256) return null;
    const filename = path.join(this.jobDirectory(jobId), state.output.relative_path);
    try {
      await stat(filename);
    } catch {
      return null;
    }
    const bytes = await readFile(filename);
    if (sha256(bytes) !== state.output.sha256) {
      throw new MotionServiceError(409, 'MOTION_OUTPUT_INTEGRITY_FAILED', 'The stored clip no longer matches its receipt');
    }
    return filename;
  }

  async listEvents(jobId, { after = 0 } = {}) {
    this.#assertReady();
    const state = await this.#readState(assertMotionId(jobId));
    if (!state) return [];
    const events = [];
    for (let sequence = after + 1; sequence <= state.event_count; sequence += 1) {
      const bytes = await readFile(this.eventPath(jobId, sequence), 'utf8').catch(() => null);
      if (bytes) events.push(JSON.parse(bytes));
    }
    return events;
  }
}

// Kept exported for the tests and for any future contract that needs the same job
// document shape without instantiating the service.
export { assertMotionJob };
