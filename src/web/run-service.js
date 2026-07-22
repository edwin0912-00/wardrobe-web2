import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { PipelineRunner } from '../runner/pipeline-runner.js';
import { IMAGE_MODEL_ROUTE } from '../runner/model-policy.js';
import { normalizeWhitePngBytes } from '../qa/white-normalizer.mjs';
import { GarmentNeedsInputError, GarmentConditioner } from './garment-conditioner.js';
import { compileFullLookText, garmentLocks, groupGarmentViews } from './garment-passport.js';

const MIME_EXTENSION = Object.freeze({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' });
const TERMINAL = new Set(['COMPLETED', 'NEEDS_INPUT', 'FAILED']);
const RESTARTABLE = new Set(['QUEUED', 'RUNNING']);
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CHECKPOINT_MESSAGES = Object.freeze({
  RECEIVED: 'Задачу прийнято',
  VALIDATING: 'Перевіряємо контракт і файли',
  CONDITIONING_IDENTITY: 'Перевіряємо матеріали людини',
  CONDITIONING_OUTFIT: 'Перевіряємо матеріали образу',
  CONDITIONING_QA: 'Перевіряємо підготовлені матеріали',
  REFERENCES_READY: 'Матеріали затверджено',
  GENERATING_AVATAR: 'Генеруємо базовий аватар',
  AVATAR_RETRY: 'Повторно генеруємо аватар',
  AVATAR_QA: 'Перевіряємо схожість і якість аватара',
  AVATAR_READY: 'Базовий аватар затверджено',
  GENERATING_OUTFIT: 'Генеруємо повний образ',
  OUTFIT_RETRY: 'Повторно генеруємо образ',
  OUTFIT_QA: 'Перевіряємо образ і схожість',
  OUTFIT_READY: 'Образ затверджено',
  EXPORTING: 'Зберігаємо затверджений результат',
  COMPLETED: 'Результат готовий',
});
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function resolveRunId(runId) {
  const resolved = runId ?? randomUUID();
  if (typeof resolved !== 'string' || !SAFE_RUN_ID.test(resolved)) {
    throw new Error('runId must be a safe identifier of at most 128 letters, numbers, dashes, or underscores');
  }
  return resolved;
}

async function atomicJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, filename);
}

async function validateUpload(upload, field) {
  if (!upload || !Buffer.isBuffer(upload.buffer) || upload.buffer.length === 0) throw new Error(`${field} is required`);
  const extension = MIME_EXTENSION[upload.mimetype];
  if (!extension) throw new Error(`${field} must be PNG, JPEG, or WEBP`);
  if (upload.buffer.length > 20 * 1024 * 1024) throw new Error(`${field} exceeds 20 MB`);
  let metadata;
  try { metadata = await sharp(upload.buffer).metadata(); } catch { throw new Error(`${field} is not a decodable image`); }
  if (!metadata.width || !metadata.height || metadata.width < 256 || metadata.height < 256) throw new Error(`${field} must be at least 256×256`);
  if (metadata.pages && metadata.pages > 1) throw new Error(`${field} must be a still image`);
  return { extension, metadata };
}

function publicRun(state) {
  return {
    run_id: state.run_id,
    status: state.status,
    phase: state.phase,
    inner_state: state.inner_state ?? null,
    terminal_stage: state.terminal_stage ?? null,
    message: state.message,
    created_at: state.created_at,
    updated_at: state.updated_at,
    garments: (state.garments ?? []).map((item) => ({
      ...item,
      preview_url: `/api/runs/${state.run_id}/garments/${item.source_index}`,
    })),
    conflicts: state.conflicts ?? [],
    qa: state.qa ?? {},
    outputs: state.outputs ?? {},
    execution_route: {
      garment_images_supplied: Boolean(state.inputs?.garments?.length),
      garment_source_image_count: state.inputs?.garments?.length ?? 0,
      avatar_reuse: Boolean(state.inputs?.approved_avatar),
      optional_scene_requested: Boolean(state.inputs?.generate_scene),
    },
    ...(state.inputs?.approved_avatar ? { avatar_reuse: {
      purpose: 'NEW_LOOK',
      source_run_id: state.inputs.approved_avatar.source_run_id,
    } } : {}),
    error: state.error ?? null,
  };
}

export class RunService {
  constructor({ rootDirectory, provider, vlm, assetGenerator, projectRoot = path.resolve(import.meta.dirname, '..', '..'), clock = () => new Date(), observer = null }) {
    this.rootDirectory = path.resolve(rootDirectory);
    this.provider = provider;
    this.vlm = vlm;
    this.assetGenerator = assetGenerator;
    this.projectRoot = projectRoot;
    this.clock = clock;
    this.observer = observer;
    this.events = new EventEmitter();
    this.running = new Map();
    this.creating = new Map();
  }

  async initialize() {
    await mkdir(this.rootDirectory, { recursive: true });
    const entries = await readdir(this.rootDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !SAFE_RUN_ID.test(entry.name)) continue;
      let state;
      try { state = await this.#read(entry.name); } catch { continue; }
      if (state?.run_id === entry.name && RESTARTABLE.has(state.status)) this.start(entry.name);
    }
  }
  runDirectory(runId) { return path.join(this.rootDirectory, runId); }
  statePath(runId) { return path.join(this.runDirectory(runId), 'run.json'); }

  async #read(runId) {
    try { return JSON.parse(await readFile(this.statePath(runId), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async #write(state, update = {}) {
    Object.assign(state, update, { updated_at: this.clock().toISOString() });
    await atomicJson(this.statePath(state.run_id), state);
    const publicState = publicRun(state);
    this.events.emit(state.run_id, publicState);
    if (this.observer) {
      try { await this.observer(publicState); } catch { /* monitoring must never break a run */ }
    }
    return state;
  }

  async createRun({ person, identityDetail, garments = [], outfitText = '', generateScene = false, runId: requestedRunId, approvedAvatarReference = null }) {
    const runId = resolveRunId(requestedRunId);
    const pending = this.creating.get(runId);
    if (pending) return pending;
    const existing = await this.#read(runId);
    if (existing) {
      if (RESTARTABLE.has(existing.status) && !this.running.has(runId)) this.start(runId);
      return publicRun(existing);
    }
    const raced = this.creating.get(runId);
    if (raced) return raced;
    const creation = this.#createNewRun({ runId, person, identityDetail, garments, outfitText, generateScene, approvedAvatarReference })
      .finally(() => this.creating.delete(runId));
    this.creating.set(runId, creation);
    return creation;
  }

  async #createNewRun({ runId, person, identityDetail, garments, outfitText, generateScene, approvedAvatarReference }) {
    if (garments.length > 5) throw new Error('At most five garment images are allowed');
    if (garments.length === 0 && outfitText.trim() === '') throw new Error('Provide outfit text or at least one garment image');
    await validateUpload(person, 'person_photo');
    if (identityDetail) await validateUpload(identityDetail, 'identity_detail');
    for (const [index, garment] of garments.entries()) await validateUpload(garment, `garment_images[${index}]`);
    const approvedAvatar = approvedAvatarReference
      ? await this.#verifyApprovedAvatarReference(approvedAvatarReference, runId)
      : null;
    const runDirectory = this.runDirectory(runId);
    const inputsDirectory = path.join(runDirectory, 'inputs');
    await mkdir(inputsDirectory, { recursive: true });
    const save = async (upload, stem) => {
      const { extension } = await validateUpload(upload, stem);
      const filename = path.join(inputsDirectory, `${stem}${extension}`);
      await writeFile(filename, upload.buffer, { flag: 'wx' });
      return filename;
    };
    const personPath = await save(person, 'person');
    const identityDetailPath = identityDetail ? await save(identityDetail, 'identity-detail') : null;
    const garmentPaths = [];
    for (const [index, garment] of garments.entries()) garmentPaths.push(await save(garment, `garment-${String(index + 1).padStart(2, '0')}`));
    let importedApprovedAvatar = null;
    if (approvedAvatar) {
      const avatarPath = path.join(inputsDirectory, 'approved-avatar.png');
      const receiptPath = path.join(inputsDirectory, 'approved-avatar-qa-receipt.json');
      await writeFile(avatarPath, approvedAvatar.avatarBytes, { flag: 'wx' });
      await writeFile(receiptPath, approvedAvatar.receiptBytes, { flag: 'wx' });
      importedApprovedAvatar = {
        path: avatarPath,
        sha256: approvedAvatar.avatarSha256,
        source_run_id: approvedAvatar.sourceRunId,
        qa_receipt: { path: receiptPath, sha256: approvedAvatar.receiptSha256, decision: 'PASS' },
      };
    }
    const now = this.clock().toISOString();
    const state = {
      schema_version: '1.0.0', run_id: runId, status: 'QUEUED', phase: 'UPLOADED', message: 'Inputs accepted',
      created_at: now, updated_at: now, inputs: { person: personPath, identity_detail: identityDetailPath, garments: garmentPaths, outfit_text: outfitText.trim(), generate_scene: Boolean(generateScene), ...(importedApprovedAvatar ? { approved_avatar: importedApprovedAvatar } : {}) },
      garments: [], conflicts: [], qa: {}, outputs: {}, error: null,
    };
    const preparation = {
      person: person.preparation ?? null,
      identity_detail: identityDetail?.preparation ?? null,
      garments: garments.map((item) => item.preparation ?? null),
    };
    if (preparation.person || preparation.identity_detail || preparation.garments.some(Boolean)) {
      state.inputs.preparation = preparation;
    }
    await this.#write(state);
    this.start(runId);
    return publicRun(state);
  }

  async #verifyApprovedAvatarReference(reference, targetRunId) {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) throw new Error('approvedAvatarReference must be an object');
    const sourceRunId = reference.source_run_id;
    if (typeof sourceRunId !== 'string' || !SAFE_RUN_ID.test(sourceRunId)) throw new Error('approvedAvatarReference.source_run_id is invalid');
    if (sourceRunId === targetRunId) throw new Error('A run cannot reuse its own avatar');
    const sourceState = await this.#read(sourceRunId);
    if (!sourceState || sourceState.status !== 'COMPLETED') throw new Error('Approved avatar source run must exist and be completed');
    const expectedAvatarPath = path.join(this.runDirectory(sourceRunId), 'outputs', 'avatar.png');
    const expectedReceiptPath = path.join(this.runDirectory(sourceRunId), 'outputs', 'run-manifest.json');
    if (path.resolve(reference.path ?? '') !== expectedAvatarPath) throw new Error('Approved avatar path must belong to the declared source run');
    if (path.resolve(reference.qa_receipt?.path ?? '') !== expectedReceiptPath) throw new Error('Approved avatar QA receipt must belong to the declared source run');
    const [avatarBytes, receiptBytes] = await Promise.all([readFile(expectedAvatarPath), readFile(expectedReceiptPath)]);
    const avatarSha256 = sha256(avatarBytes);
    const receiptSha256 = sha256(receiptBytes);
    if (reference.sha256 !== avatarSha256) throw new Error('Approved avatar SHA-256 mismatch');
    if (reference.qa_receipt?.sha256 !== receiptSha256) throw new Error('Approved avatar QA receipt SHA-256 mismatch');
    if (reference.qa_receipt?.decision !== 'PASS') throw new Error('Approved avatar QA receipt must declare PASS');
    let manifest;
    try { manifest = JSON.parse(receiptBytes.toString('utf8')); } catch { throw new Error('Approved avatar QA receipt is invalid JSON'); }
    if (manifest.job_id !== `web-${sourceRunId}` || manifest.state !== 'COMPLETED') throw new Error('Approved avatar QA receipt does not match the declared source run');
    if (manifest.qa?.avatar?.decision !== 'PASS') throw new Error('Source avatar did not pass avatar QA');
    if (manifest.outputs?.avatar?.sha256 !== avatarSha256) throw new Error('Source QA receipt is not bound to the approved avatar hash');
    return { sourceRunId, avatarBytes, receiptBytes, avatarSha256, receiptSha256 };
  }

  start(runId) {
    if (this.running.has(runId)) return this.running.get(runId);
    const promise = this.#execute(runId).finally(() => this.running.delete(runId));
    this.running.set(runId, promise);
    return promise;
  }

  async #execute(runId) {
    const state = await this.#read(runId);
    if (!state || TERMINAL.has(state.status)) return state;
    try {
      let conditioned = await this.#restoreConditionedGarments(state);
      if (state.inputs.garments.length) {
        if (!conditioned) {
          await this.#write(state, { status: 'RUNNING', phase: 'GARMENT_CONDITIONING', message: 'Фіксуємо характеристики речей і готуємо еталонні референси' });
          const conditioner = new GarmentConditioner({ vlm: this.vlm, generator: this.assetGenerator, clock: this.clock });
          conditioned = await conditioner.condition({
            imagePaths: state.inputs.garments,
            outputDirectory: path.join(this.runDirectory(runId), 'conditioned', 'garments'),
            runId,
            passport: state.inputs.garment_passport ?? null,
            selections: state.inputs.garment_selections ?? {},
            onProgress: async (innerState, message) => this.#write(state, { inner_state: innerState, message }),
          });
          await this.#write(state, { garments: conditioned.items.map((item) => ({ source_index: item.source_index, source_indexes: item.source_indexes, reference_set_id: item.reference_set_id, category: item.category, confidence: item.confidence, observed: item.observed, reference_card: item.reference_card.path, cutout: item.cutout.path })), conflicts: conditioned.conflicts });
        }
      }
      const jobPath = await this.#buildJob(state, conditioned);
      await this.#write(state, { status: 'RUNNING', phase: 'CORE_PIPELINE', inner_state: null, terminal_stage: null, message: 'Генеруємо й перевіряємо аватар та образ', job_path: jobPath });
      const runner = new PipelineRunner({ provider: this.provider });
      const progressTimer = setInterval(() => { this.#syncRunnerProgress(state).catch(() => {}); }, 1000);
      let result;
      try { result = await runner.runJobFile(jobPath); } finally { clearInterval(progressTimer); }
      state.runner = result;
      if (result.status !== 'COMPLETED') {
        let qaReason = null;
        let terminalDetails = null;
        try {
          const checkpoint = JSON.parse(await readFile(result.checkpointPath, 'utf8'));
          qaReason = checkpoint.qa?.outfit?.reason ?? checkpoint.qa?.avatar?.reason ?? checkpoint.qa?.conditioning?.reason ?? null;
        } catch { /* checkpoint details are optional in an infrastructure failure */ }
        try {
          const events = (await readFile(result.eventsPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
          terminalDetails = events.reverse().find((event) => event.type === 'STATE_TRANSITION' && ['FAILED', 'NEEDS_INPUT'].includes(event.state))?.data ?? null;
        } catch { /* event details are optional in an infrastructure failure */ }
        const error = result.lastError ?? terminalDetails?.error ?? null;
        const terminalStage = terminalDetails?.from ?? state.inner_state ?? state.phase;
        return this.#write(state, { status: result.status === 'NEEDS_INPUT' ? 'NEEDS_INPUT' : 'FAILED', phase: 'CORE_PIPELINE', terminal_stage: terminalStage, message: error?.message ?? terminalDetails?.reason ?? qaReason ?? `Pipeline ended with ${result.status}`, error });
      }
      const outputs = {
        avatar: `/api/runs/${runId}/files/avatar.png`,
        avatar_outfit: `/api/runs/${runId}/files/avatar_outfit.png`,
        manifest: `/api/runs/${runId}/files/run-manifest.json`,
      };
      const manifest = JSON.parse(await readFile(result.outputs.manifest, 'utf8'));
      state.qa = manifest.qa;
      state.outputs = outputs;
      if (state.inputs.generate_scene) await this.#generateScene(state, result.outputs.avatar_outfit);
      return this.#write(state, { status: 'COMPLETED', phase: 'COMPLETED', inner_state: null, terminal_stage: null, message: 'Аватар і образ готові', outputs: state.outputs });
    } catch (error) {
      if (error instanceof GarmentNeedsInputError) {
        const passport = error.details.passport;
        const garments = passport?.items ? groupGarmentViews(passport.items, passport.reference_sets) : state.garments;
        return this.#write(state, { status: 'NEEDS_INPUT', phase: 'GARMENT_CONDITIONING', terminal_stage: state.inner_state ?? state.phase, message: error.message, garments, conflicts: error.details.conflicts ?? [], error: { name: error.name, message: error.message, details: error.details } });
      }
      return this.#write(state, { status: 'FAILED', phase: state.phase, terminal_stage: state.inner_state ?? state.phase, message: error.message, error: { name: error.name, message: error.message } });
    }
  }

  async #syncRunnerProgress(state) {
    const checkpointPath = path.join(this.runDirectory(state.run_id), 'outputs', '.zeely-run', 'checkpoint.json');
    try {
      const checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'));
      if (checkpoint.state !== state.inner_state) await this.#write(state, { inner_state: checkpoint.state, message: CHECKPOINT_MESSAGES[checkpoint.state] ?? checkpoint.state.replaceAll('_', ' ').toLowerCase() });
    } catch { /* checkpoint may not exist yet */ }
  }

  async #restoreConditionedGarments(state) {
    if (!state.inputs.garments.length || !state.garments?.length) return null;
    const packPath = path.join(this.runDirectory(state.run_id), 'conditioned', 'garments', 'reference-pack.json');
    try {
      const document = JSON.parse(await readFile(packPath, 'utf8'));
      const items = state.garments.map((item) => {
        const sourceIndexes = item.source_indexes?.length ? item.source_indexes : [item.source_index];
        return {
          ...item,
          source_indexes: sourceIndexes,
          source_path: state.inputs.garments[sourceIndexes[0]],
          source_paths: sourceIndexes.map((index) => state.inputs.garments[index]),
          reference_card: { path: item.reference_card },
          cutout: { path: item.cutout },
        };
      });
      for (const item of items) {
        await access(item.reference_card.path);
        await access(item.cutout.path);
      }
      return {
        items,
        conflicts: state.conflicts ?? [],
        pack: { path: packPath, document },
        outfitText: compileFullLookText(items),
      };
    } catch {
      return null;
    }
  }

  async #buildJob(state, conditioned) {
    const outfitText = conditioned?.outfitText
      ? [state.inputs.outfit_text, conditioned.outfitText].filter(Boolean).join('\n')
      : state.inputs.outfit_text;
    const hasReference = Boolean(conditioned);
    const outfit = {
      mode: hasReference ? (outfitText ? 'reference_image_plus_text' : 'reference_image') : 'text',
      ...(outfitText ? { text: outfitText } : {}),
      ...(hasReference ? {
        reference: conditioned.items[0].source_path,
        reference_pack: { path: conditioned.pack.path },
        target_region: 'complete_outfit',
        must_match: conditioned.items.flatMap(garmentLocks),
      } : {}),
    };
    const identityPack = await this.#buildIdentityPack(state);
    const job = {
      job_id: `web-${state.run_id}`, identity_reference: state.inputs.person,
      identity_reference_pack: { path: identityPack },
      output_directory: path.join(this.runDirectory(state.run_id), 'outputs'),
      prompts: {
        avatar: path.join(this.projectRoot, 'prompts', 'avatar.txt'),
        outfit: path.join(this.projectRoot, 'prompts', hasReference ? 'outfit-reference.txt' : 'outfit-text.txt'),
        repair: path.join(this.projectRoot, 'prompts', 'repair.txt'),
      },
      outfit,
      quality_references: ['output1.png', 'output2.png', 'output3.png'].map((filename) => path.join(this.projectRoot, 'inputs', 'zeely-test', 'quality-references', filename)),
      model_route: [...IMAGE_MODEL_ROUTE], max_attempts: 3, conditioning_max_attempts: 2,
      ...(state.inputs.approved_avatar ? { approved_avatar_reference: state.inputs.approved_avatar } : {}),
    };
    const jobPath = path.join(this.runDirectory(state.run_id), 'job.json');
    await atomicJson(jobPath, job);
    return jobPath;
  }

  async #buildIdentityPack(state) {
    const directory = path.join(this.runDirectory(state.run_id), 'conditioned', 'identity');
    const filename = path.join(directory, 'reference-pack.json');
    try {
      JSON.parse(await readFile(filename, 'utf8'));
      return filename;
    } catch { /* a missing or incomplete pack is rebuilt from the immutable upload */ }
    await mkdir(directory, { recursive: true });
    const sources = [state.inputs.person, state.inputs.identity_detail].filter(Boolean);
    const bindings = [];
    for (const [index, source] of sources.entries()) {
      const image = await sharp(source).rotate().toColourspace('srgb').png().toBuffer();
      const filename = path.join(directory, index === 0 ? 'primary.png' : 'detail.png');
      await writeFile(filename, image);
      bindings.push({ order: index + 1, role: index === 0 ? 'IDENTITY_PRIMARY' : 'FACE_DETAIL', path: filename, sha256: sha256(image) });
    }
    const raw = await readFile(state.inputs.person);
    const document = {
      schema_version: '1.0.0', asset_id: `${state.run_id}-identity`, kind: 'HUMAN',
      source: { path: path.resolve(state.inputs.person), sha256: sha256(raw), immutable: true },
      extraction: { method: 'user_upload_plus_deterministic_normalization', provenance: 'OBSERVED', unknowns: [] },
      readiness: { decision: 'READY', reasons: ['PRIMARY_IDENTITY_IMAGE_DECODES'], actions: [], terminal: false },
      generation_bindings: bindings, created_at: this.clock().toISOString(),
    };
    await atomicJson(filename, document);
    return filename;
  }

  async #generateScene(state, approvedOutfitPath) {
    await this.#write(state, { phase: 'OPTIONAL_SCENE', inner_state: null, message: 'Генеруємо додатковий редакційний кадр' });
    const sceneDirectory = path.join(this.runDirectory(state.run_id), 'scene');
    for (const [index, model] of IMAGE_MODEL_ROUTE.entries()) {
      const response = await this.assetGenerator.generateScene({
        approvedOutfitPath, model, workDirectory: sceneDirectory, operationId: `${state.run_id}-scene-${index + 1}`,
        prompt: 'Create one memorable high-fashion editorial photograph using the exact same approved person and complete outfit from the reference. Preserve identity, face, hair, body proportions, every garment color, texture, logo, text and fit. Place the subject in a bold contemporary Vogue-style studio environment with sculptural light and a confident editorial pose. No text overlay, no brand invention, no wardrobe changes.',
      });
      const candidatePath = path.join(sceneDirectory, `candidate-${index + 1}.png`);
      await mkdir(sceneDirectory, { recursive: true });
      await writeFile(candidatePath, response.image);
      const qa = await this.vlm.evaluateQa({ phase: 'scene', evidence: { avatar: { artifact: { path: approvedOutfitPath } }, candidate: { artifact: { path: candidatePath } } } });
      if (qa.decision === 'PASS') {
        const finalPath = path.join(this.runDirectory(state.run_id), 'outputs', 'art_director_scene.png');
        await writeFile(finalPath, response.image, { flag: 'wx' });
        state.outputs.art_director_scene = `/api/runs/${state.run_id}/files/art_director_scene.png`;
        state.qa.scene = qa;
        return;
      }
      if (qa.decision === 'NEEDS_INPUT' || qa.decision === 'REJECT') break;
    }
    state.qa.scene = { decision: 'SKIPPED', reason: 'Bonus scene did not pass; core outputs remain valid' };
  }

  async getRun(runId) { const state = await this.#read(runId); return state ? publicRun(state) : null; }
  subscribe(runId, listener) { this.events.on(runId, listener); return () => this.events.off(runId, listener); }

  async approvedAvatarReferenceForRun(runId) {
    const state = await this.#read(runId);
    if (!state || state.status !== 'COMPLETED') throw new Error('Approved avatar source run must exist and be completed');
    const avatarPath = path.join(this.runDirectory(runId), 'outputs', 'avatar.png');
    const receiptPath = path.join(this.runDirectory(runId), 'outputs', 'run-manifest.json');
    const [avatarBytes, receiptBytes] = await Promise.all([readFile(avatarPath), readFile(receiptPath)]);
    return {
      path: avatarPath,
      sha256: sha256(avatarBytes),
      source_run_id: runId,
      qa_receipt: { path: receiptPath, sha256: sha256(receiptBytes), decision: 'PASS' },
    };
  }

  async outputFile(runId, name) {
    const allowed = new Set(['avatar.png', 'avatar_outfit.png', 'art_director_scene.png', 'run-manifest.json']);
    if (!allowed.has(name)) return null;
    const filename = path.join(this.runDirectory(runId), 'outputs', name);
    try { await access(filename); return filename; } catch { return null; }
  }

  async garmentSourceFile(runId, sourceIndex) {
    const state = await this.#read(runId);
    const index = Number(sourceIndex);
    if (!state || !Number.isInteger(index) || index < 0 || index >= state.inputs.garments.length) return null;
    const filename = state.inputs.garments[index];
    try { await access(filename); return filename; } catch { return null; }
  }

  async selectGarments(runId, selections) {
    const state = await this.#read(runId);
    if (!state) return null;
    if (state.status !== 'NEEDS_INPUT' || state.error?.name !== 'GarmentNeedsInputError') throw new Error('This run is not waiting for a garment selection');
    const duplicateConflicts = (state.conflicts ?? []).filter((conflict) => conflict.type === 'DUPLICATE_SLOT');
    if (!duplicateConflicts.length) throw new Error('This garment conflict cannot be resolved by slot selection');
    const normalized = {};
    for (const conflict of duplicateConflicts) {
      const selected = selections?.[conflict.category];
      if (!conflict.reference_set_ids.includes(selected)) throw new Error(`Select exactly one ${conflict.category} option`);
      normalized[conflict.category] = selected;
    }
    await rm(path.join(this.runDirectory(runId), 'conditioned', 'garments'), { recursive: true, force: true });
    await rm(path.join(this.runDirectory(runId), 'outputs'), { recursive: true, force: true });
    state.inputs.garment_passport = state.error.details.passport;
    state.inputs.garment_selections = normalized;
    await this.#write(state, { status: 'QUEUED', phase: 'UPLOADED', inner_state: null, terminal_stage: null, message: 'Вибір речі збережено — продовжуємо цей запуск', garments: [], conflicts: [], error: null, outputs: {}, qa: {} });
    this.start(runId);
    return publicRun(state);
  }

  async retry(runId) {
    const state = await this.#read(runId);
    if (!state) return null;
    const orphanedAfterRestart = RESTARTABLE.has(state.status) && !this.running.has(runId);
    if (!['NEEDS_INPUT', 'FAILED'].includes(state.status) && !orphanedAfterRestart) throw new Error('Only failed, needs-input, or interrupted runs can be retried');
    if (orphanedAfterRestart) {
      await this.#write(state, { status: 'QUEUED', message: 'Interrupted run queued from its existing checkpoint', error: null });
      this.start(runId);
      return publicRun(state);
    }
    await rm(path.join(this.runDirectory(runId), 'outputs'), { recursive: true, force: true });
    await this.#write(state, { status: 'QUEUED', phase: 'UPLOADED', inner_state: null, terminal_stage: null, message: 'Retry queued', garments: [], conflicts: [], error: null, outputs: {}, qa: {} });
    this.start(runId);
    return publicRun(state);
  }

  async deleteRun(runId) {
    if (this.running.has(runId)) throw new Error('Cannot delete a running job');
    const directory = this.runDirectory(runId);
    if (!directory.startsWith(`${this.rootDirectory}${path.sep}`)) throw new Error('Unsafe run path');
    await rm(directory, { recursive: true, force: true });
  }
}
