import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256Object } from '../conditioning/hash-lineage.mjs';
import { assertProvider, assertQaDecision } from '../providers/provider.js';
import { normalizeWhitePngBytes } from '../qa/white-normalizer.mjs';
import { inspectImage } from '../qa/image-inspector.mjs';
import { FilesystemArtifactStore, sha256 } from './artifact-store.js';
import {
  createCoreQaReceipt,
  qaResultFromReceipt,
  verifyCoreQaReceipt,
} from './core-qa-receipt.js';
import { AppendOnlyEventLog } from './event-log.js';
import { loadJobFile, loadJobObject } from './job.js';
import { assertAllowedImageModel, generationProfileForAttempt, imageModelName, modelForAttempt } from './model-policy.js';
import { compileAvatarPrompt, compileOutfitPrompt } from './prompt-compiler.js';
import { publicManifestView } from './public-manifest.js';
import {
  providerPackSummary,
  providerReferencesFromPack,
  referencePackInputFiles,
  resolveReferencePacks,
} from './reference-packs.js';
import { assertTransition, isTerminal, STATES } from './state-machine.js';

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const SHA256 = /^[a-f0-9]{64}$/;

function operationKey(jobHash, operation, attempt) {
  return createHash('sha256').update(`${jobHash}:${operation}:${attempt}`).digest('hex');
}

function materialRepairPrompt(basePrompt, profile, previousQa) {
  if (!profile || profile.repair_kind === 'INITIAL') return basePrompt;
  const defects = Array.isArray(previousQa?.defects)
    ? previousQa.defects.filter((item) => typeof item === 'string' && item.trim() !== '')
    : [];
  const defectText = defects.join('; ') || previousQa?.reason || 'the evaluated visible fidelity defect';
  return `${basePrompt}\n\nREPAIR PASS ${profile.repair_kind}: Rebuild the image from the bound source references. The prior candidate was not accepted because: ${defectText}. Correct that evidence-backed defect while preserving every already-correct identity and visible item lock. This is a new repair pass, not permission to reuse or blend the previous candidate pixels.`;
}

function errorInfo(error) {
  return {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    retryable: error?.retryable !== false,
    ...(typeof error?.code === 'string' ? { code: error.code } : {}),
    ...(error?.submitted === true ? { submitted: true } : {}),
  };
}

function sourceDescriptor(filename) {
  const extension = path.extname(filename).toLowerCase() || '.bin';
  const mediaTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  };
  return { path: filename, extension, mediaType: mediaTypes[extension] ?? 'application/octet-stream' };
}

async function assertFilesReadable(job, referencePacks) {
  const required = [
    job.identity_reference,
    job.prompts.avatar,
    job.prompts.outfit,
    ...job.quality_references,
    ...referencePackInputFiles(referencePacks).map(([, filename]) => filename),
  ];
  if (job.prompts.repair) required.push(job.prompts.repair);
  if (job.outfit.reference) required.push(job.outfit.reference);
  if (job.approved_avatar_reference) {
    required.push(job.approved_avatar_reference.path, job.approved_avatar_reference.qa_receipt.path);
  }
  for (const filename of required) await access(filename);
}

function inputFiles(job, referencePacks) {
  const entries = [
    ['identity_reference', job.identity_reference],
    ['prompt_avatar', job.prompts.avatar],
    ['prompt_outfit', job.prompts.outfit],
    ...job.quality_references.map((filename, index) => [`quality_reference_${index}`, filename]),
  ];
  if (job.prompts.repair) entries.push(['prompt_repair', job.prompts.repair]);
  if (job.outfit.reference) entries.push(['outfit_reference', job.outfit.reference]);
  if (job.approved_avatar_reference) {
    entries.push(
      ['approved_avatar_reference', job.approved_avatar_reference.path, { declared_sha256: job.approved_avatar_reference.sha256 }],
      ['approved_avatar_qa_receipt', job.approved_avatar_reference.qa_receipt.path, { declared_sha256: job.approved_avatar_reference.qa_receipt.sha256 }],
    );
  }
  entries.push(...referencePackInputFiles(referencePacks));
  return entries;
}

async function snapshotInputs(job, referencePacks) {
  const snapshot = {};
  for (const [role, filename, metadata] of inputFiles(job, referencePacks)) {
    snapshot[role] = {
      path: filename,
      sha256: sha256(await readFile(filename)),
      ...(metadata ?? {}),
    };
  }
  return snapshot;
}

function artifactProviderReference(scope, role, artifact, source) {
  if (!artifact) return null;
  return {
    scope,
    role,
    path: artifact.path,
    sha256: artifact.digest,
    mediaType: artifact.mediaType,
    source,
  };
}

function generationReferences(context, phase) {
  const identity = context.checkpoint.artifacts.conditioned_identity;
  const outfit = context.checkpoint.artifacts.conditioned_outfit;
  const avatar = context.checkpoint.artifacts.avatar;
  const packedIdentity = providerReferencesFromPack(context.referencePacks.identity);
  const identityMedia = packedIdentity.length > 0
    ? packedIdentity
    : [artifactProviderReference('identity', 'IDENTITY_PRIMARY', identity?.artifact, 'CONDITIONED')].filter(Boolean);
  const packedOutfit = providerReferencesFromPack(context.referencePacks.outfit);
  const outfitMedia = packedOutfit.length > 0
    ? packedOutfit
    : [artifactProviderReference('outfit', 'GARMENT_PRIMARY', outfit?.artifact, 'CONDITIONED')].filter(Boolean);
  const ordered = phase === 'avatar'
    ? identityMedia
    : [
      artifactProviderReference('avatar', 'AVATAR_BASE', avatar?.artifact, 'APPROVED_AVATAR'),
      ...identityMedia,
      ...outfitMedia,
    ].filter(Boolean);

  return {
    identity,
    outfit: phase === 'outfit' ? outfit : undefined,
    avatar: phase === 'outfit' ? avatar : undefined,
    packs: {
      identity: providerPackSummary(context.referencePacks.identity),
      outfit: phase === 'outfit' ? providerPackSummary(context.referencePacks.outfit) : null,
    },
    ordered: ordered.map((item, index) => ({ ...item, order: index + 1 })),
  };
}

function requireDigest(value, field) {
  if (!SHA256.test(value ?? '')) throw new Error(`${field} must be a lowercase SHA-256`);
  return value;
}

function artifactDigest(value, field) {
  const artifact = value?.artifact ?? value;
  return requireDigest(artifact?.digest, `${field} artifact digest`);
}

function manifestWithHash(core) {
  const value = structuredClone(core);
  delete value.manifest_sha256;
  return { ...value, manifest_sha256: sha256Object(value) };
}

function addQaBinding(bindings, {
  bindingId,
  role,
  sha256: digest,
  referencePackSha256,
  factsSha256,
}) {
  const binding = {
    order: bindings.length + 1,
    binding_id: bindingId,
    role,
    sha256: requireDigest(digest, `Semantic QA binding ${bindingId}`),
    ...(referencePackSha256 ? {
      reference_pack_sha256: requireDigest(
        referencePackSha256,
        `Semantic QA binding ${bindingId} reference pack`,
      ),
    } : {}),
    ...(factsSha256 ? {
      facts_sha256: requireDigest(factsSha256, `Semantic QA binding ${bindingId} facts`),
    } : {}),
  };
  bindings.push(binding);
  return binding;
}

function qaProviderEvidence(context, phase) {
  const hasCanonicalOutfitPack = (context.referencePacks.outfit?.bindings?.length ?? 0) > 0;
  if (phase === 'conditioning') {
    return {
      identity: context.checkpoint.artifacts.conditioned_identity,
      outfit: context.checkpoint.artifacts.conditioned_outfit,
      source_identity: context.job.identity_reference,
      source_outfit: context.job.outfit.reference ?? context.job.outfit.text,
      quality_references: context.job.quality_references,
      reference_packs: {
        identity: providerPackSummary(context.referencePacks.identity),
        outfit: providerPackSummary(context.referencePacks.outfit),
      },
    };
  }
  return {
    candidate: context.checkpoint.artifacts[phase],
    identity: context.checkpoint.artifacts.conditioned_identity,
    outfit: phase === 'outfit'
      // The conditioner has already made the selected-item cutouts authoritative.
      // Re-attaching the original full-body source here makes incidental trousers
      // or shoes look like part of a single selected top/accessory and lets QA
      // reject a correct candidate for the wrong region.
      ? (hasCanonicalOutfitPack ? undefined : context.checkpoint.artifacts.conditioned_outfit)
      : undefined,
    avatar: phase === 'outfit'
      ? context.checkpoint.artifacts.avatar
      : undefined,
    source_identity: context.job.identity_reference,
    source_outfit: phase === 'outfit'
      // Raw outfit images are conditioning evidence.  For look QA, use only the
      // canonical pack bindings and their declared categories; the text remains
      // available as a non-image authority below.
      ? (hasCanonicalOutfitPack ? undefined : (context.job.outfit.reference ?? context.job.outfit.text))
      : undefined,
    outfit_text: phase === 'outfit' ? context.job.outfit.text ?? '' : '',
    outfit_scope: phase === 'outfit' ? context.job.outfit.target_region ?? '' : '',
    quality_references: context.job.quality_references,
    reference_packs: {
      identity: providerPackSummary(context.referencePacks.identity),
      outfit: phase === 'outfit'
        ? providerPackSummary(context.referencePacks.outfit)
        : null,
    },
  };
}

function qaEvidenceManifest(context, phase, attempt) {
  const bindings = [];
  const identity = context.checkpoint.artifacts.conditioned_identity;
  const outfit = context.checkpoint.artifacts.conditioned_outfit;
  const candidate = context.checkpoint.artifacts[phase];
  const identityFactsSha256 = identity?.facts_artifact?.digest;
  const outfitFactsSha256 = outfit?.facts_artifact?.digest;

  if (identity?.artifact) {
    addQaBinding(bindings, {
      bindingId: 'conditioned-identity',
      role: 'IDENTITY_REFERENCE',
      sha256: artifactDigest(identity, 'Conditioned identity'),
      factsSha256: identityFactsSha256,
    });
  }
  if (phase === 'outfit') {
    addQaBinding(bindings, {
      bindingId: 'approved-avatar',
      role: 'APPROVED_AVATAR',
      sha256: artifactDigest(context.checkpoint.artifacts.avatar, 'Approved avatar'),
    });
  }
  if (phase === 'conditioning' || phase === 'outfit') {
    addQaBinding(bindings, {
      bindingId: 'conditioned-outfit',
      role: outfit?.artifact ? 'OUTFIT_REFERENCE' : 'OUTFIT_TEXT_TARGET',
      sha256: outfit?.artifact
        ? artifactDigest(outfit, 'Conditioned outfit')
        : requireDigest(outfitFactsSha256, 'Conditioned outfit facts'),
      factsSha256: outfitFactsSha256,
    });
  }
  if (phase === 'avatar' || phase === 'outfit') {
    addQaBinding(bindings, {
      bindingId: `${phase}-candidate`,
      role: phase === 'avatar' && candidate?.approved_reuse
        ? 'IMPORTED_APPROVED_AVATAR'
        : 'GENERATED_CANDIDATE',
      sha256: artifactDigest(candidate, `${phase} candidate`),
    });
  }

  addQaBinding(bindings, {
    bindingId: 'raw-identity',
    role: 'RAW_SOURCE_REFERENCE',
    sha256: context.inputs.identity_reference?.sha256,
  });
  if (context.job.outfit.reference && (phase === 'conditioning' || phase === 'outfit')) {
    addQaBinding(bindings, {
      bindingId: 'raw-outfit',
      role: 'RAW_SOURCE_REFERENCE',
      sha256: context.inputs.outfit_reference?.sha256,
    });
  } else if (phase === 'conditioning' || phase === 'outfit') {
    addQaBinding(bindings, {
      bindingId: 'outfit-text',
      role: 'OUTFIT_TEXT_TARGET',
      sha256: sha256(Buffer.from(context.job.outfit.text)),
    });
  }

  for (const scope of ['identity', 'outfit']) {
    if (scope === 'outfit' && phase === 'avatar') continue;
    const pack = context.referencePacks[scope];
    if (!pack) continue;
    const factsSha256 = scope === 'identity' ? identityFactsSha256 : outfitFactsSha256;
    for (const [index, binding] of pack.bindings.entries()) {
      addQaBinding(bindings, {
        bindingId: `${scope}-pack-${binding.bindingId ?? binding.bindingOrder}`,
        role: `${scope.toUpperCase()}_REFERENCE_${index + 1}`,
        sha256: binding.sha256,
        referencePackSha256: pack.sha256,
        factsSha256,
      });
    }
  }

  for (const [index] of context.job.quality_references.entries()) {
    addQaBinding(bindings, {
      bindingId: `quality-reference-${index + 1}`,
      role: `QUALITY_REFERENCE_${index + 1}`,
      sha256: context.inputs[`quality_reference_${index}`]?.sha256,
    });
  }

  if (context.job.approved_avatar_reference && phase === 'avatar' && candidate?.approved_reuse) {
    addQaBinding(bindings, {
      bindingId: 'source-avatar-receipt',
      role: 'SOURCE_AVATAR_QA_RECEIPT',
      sha256: context.inputs.approved_avatar_qa_receipt?.sha256,
    });
  }

  const subject = phase === 'conditioning'
    ? {
      kind: 'CONDITIONED_REFERENCE_SET',
      sha256: sha256Object({
        phase,
        bindings: bindings.map(({ prepared_sha256: _prepared, ...binding }) => binding),
      }),
      media_type: 'application/vnd.zeely.conditioned-reference-set+json',
    }
    : {
      kind: phase === 'avatar' ? 'AVATAR_CANDIDATE' : 'OUTFIT_CANDIDATE',
      sha256: artifactDigest(candidate, `${phase} subject`),
      media_type: 'image/png',
    };
  const promptSha256 = phase === 'conditioning'
    ? null
    : context.checkpoint.prompts[phase]?.sha256 ?? null;
  return manifestWithHash({
    schema_version: '1.0.0',
    phase,
    attempt,
    job_hash: context.jobHash,
    execution_hash: context.executionHash,
    subject,
    prompt_sha256: promptSha256,
    bindings,
  });
}

function attachPreparedEvidence(baseManifest, preparedEvidence, {
  requireEveryVisualBinding = false,
} = {}) {
  if (!Array.isArray(preparedEvidence)) {
    throw new Error('Semantic QA prepared evidence must be an array');
  }
  const bindings = baseManifest.bindings.map((binding) => ({ ...binding }));
  const matched = new Set();
  for (const [index, prepared] of preparedEvidence.entries()) {
    if (!prepared
      || !Number.isInteger(prepared.order)
      || prepared.order !== index + 1
      || !SHA256.test(prepared.prepared_sha256 ?? '')
      || !Array.isArray(prepared.source_bindings)
      || prepared.source_bindings.length === 0) {
      throw new Error('Semantic QA evaluator returned invalid prepared evidence');
    }
    for (const source of prepared.source_bindings) {
      const match = bindings.findIndex((binding) => (
        binding.role === source?.role && binding.sha256 === source?.source_sha256
      ));
      if (match < 0) {
        throw new Error('Semantic QA evaluator judged evidence outside the runner manifest');
      }
      if (bindings[match].prepared_sha256
        && bindings[match].prepared_sha256 !== prepared.prepared_sha256) {
        throw new Error('Semantic QA evaluator returned conflicting prepared evidence hashes');
      }
      bindings[match].prepared_sha256 = prepared.prepared_sha256;
      matched.add(match);
    }
  }
  if (requireEveryVisualBinding) {
    const missing = bindings.filter((binding, index) => (
      !matched.has(index)
      && binding.role !== 'OUTFIT_TEXT_TARGET'
      && binding.role !== 'SOURCE_AVATAR_QA_RECEIPT'
    ));
    if (missing.length > 0) {
      throw new Error(`Semantic QA evaluator omitted ${missing.length} bound visual evidence item(s)`);
    }
  }
  return manifestWithHash({ ...baseManifest, bindings });
}

function preparedEvidenceFromReceipt(baseManifest, receiptEvidence) {
  if (!receiptEvidence || !Array.isArray(receiptEvidence.bindings)
    || receiptEvidence.bindings.length !== baseManifest.bindings.length) {
    throw new Error('Core semantic QA receipt binding count is stale');
  }
  const bindings = baseManifest.bindings.map((binding, index) => {
    const stored = { ...receiptEvidence.bindings[index] };
    const preparedSha256 = stored.prepared_sha256;
    delete stored.prepared_sha256;
    if (JSON.stringify(stored) !== JSON.stringify(binding)) {
      throw new Error('Core semantic QA receipt bindings are stale for the current run');
    }
    return {
      ...binding,
      ...(preparedSha256 === undefined ? {} : {
        prepared_sha256: requireDigest(
          preparedSha256,
          `Core semantic QA prepared binding ${index + 1}`,
        ),
      }),
    };
  });
  return manifestWithHash({ ...baseManifest, bindings });
}

async function assertPngArtifact(artifact, store = null) {
  if (!artifact || artifact.mediaType !== 'image/png' || artifact.extension !== '.png') {
    throw new Error('Generation artifact must declare immutable PNG metadata');
  }
  const bytes = store
    ? await store.readArtifact(artifact)
    : await readFile(artifact.path);
  if (sha256(bytes) !== artifact.digest) {
    throw new Error('Generation artifact bytes no longer match the content-addressed digest');
  }
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('Generation provider must return an actual PNG image');
  }
}

async function verifyApprovedAvatarReference(reference) {
  const avatarBytes = await readFile(reference.path);
  const avatarSha256 = sha256(avatarBytes);
  if (avatarSha256 !== reference.sha256) throw new Error('Approved avatar SHA-256 does not match the referenced file');
  if (avatarBytes.length < PNG_SIGNATURE.length || !avatarBytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('Approved avatar reference must be an actual PNG image');
  }

  const receiptBytes = await readFile(reference.qa_receipt.path);
  if (sha256(receiptBytes) !== reference.qa_receipt.sha256) throw new Error('Approved avatar QA receipt SHA-256 does not match the referenced file');
  let receipt;
  try { receipt = JSON.parse(receiptBytes.toString('utf8')); } catch { throw new Error('Approved avatar QA receipt must be valid JSON'); }
  if (reference.qa_receipt.decision !== 'PASS' || receipt?.qa?.avatar?.decision !== 'PASS') {
    throw new Error('Approved avatar QA receipt must contain a PASS avatar decision');
  }
  if (receipt?.outputs?.avatar?.sha256 !== avatarSha256) {
    throw new Error('Approved avatar QA receipt is not bound to the referenced avatar hash');
  }
  const sourceMatches = receipt?.job_id === `web-${reference.source_run_id}` || receipt?.run_id === reference.source_run_id;
  if (!sourceMatches) throw new Error('Approved avatar QA receipt does not belong to the declared source run');
  return { avatarBytes, avatarSha256, receipt };
}

export class PipelineRunner {
  constructor({ provider, runtimeRoot, clock = () => new Date() }) {
    this.provider = assertProvider(provider);
    this.runtimeRoot = runtimeRoot ? path.resolve(runtimeRoot) : null;
    this.clock = clock;
  }

  async runJobFile(filename) {
    return this.run(await loadJobFile(filename));
  }

  async runJobObject(job, options = {}) {
    return this.run(loadJobObject(job, options));
  }

  async run(loadedJob) {
    const { normalizedJob: job, sourceHash: jobHash } = loadedJob;
    const referencePacks = await resolveReferencePacks(job);
    await assertFilesReadable(job, referencePacks);
    const inputs = await snapshotInputs(job, referencePacks);
    const executionHash = createHash('sha256')
      .update(`${jobHash}:${JSON.stringify(inputs)}`)
      .digest('hex');
    const runId = createHash('sha256').update(`${executionHash}:${job.job_id}`).digest('hex').slice(0, 24);
    const workDirectory = this.runtimeRoot
      ? path.join(this.runtimeRoot, job.job_id, runId)
      : path.join(job.output_directory, '.zeely-run');
    const store = new FilesystemArtifactStore(workDirectory);
    const events = new AppendOnlyEventLog(path.join(workDirectory, 'events.jsonl'), { clock: this.clock });
    await store.initialize();
    await events.initialize();
    const releaseLock = await store.acquireLock();

    const context = {
      loadedJob,
      job,
      jobHash,
      executionHash,
      inputs,
      referencePacks,
      runId,
      workDirectory,
      store,
      events,
      checkpoint: null,
    };
    try {
      context.checkpoint = await store.readCheckpoint();
      if (!context.checkpoint) {
        context.checkpoint = {
          schema_version: '1.0.0',
          run_id: runId,
          job_id: job.job_id,
          job_hash: jobHash,
          execution_hash: executionHash,
          inputs,
          job_source: loadedJob.sourcePath,
          state: STATES.RECEIVED,
          attempts: { conditioning: 1, avatar: 1, outfit: 1 },
          artifacts: {},
          prompts: {},
          qa: {},
          created_at: this.clock().toISOString(),
          updated_at: this.clock().toISOString(),
          last_event_sequence: 0,
        };
        const created = await this.#record(context, 'RUN_CREATED', { source: loadedJob.sourcePath });
        context.checkpoint.last_event_sequence = created.sequence;
        await store.writeCheckpoint(context.checkpoint);
      } else {
        this.#assertCheckpointIdentity(context);
      }

      if (context.checkpoint.state === STATES.COMPLETED) {
        await this.#ensureCompletedOutputs(context);
        await this.#record(context, 'RUN_REUSED', { reason: 'completed_checkpoint' });
        return this.#result(context, true);
      }
      if (isTerminal(context.checkpoint.state)) return this.#result(context, true);

      while (!isTerminal(context.checkpoint.state)) {
        try {
          await this.#step(context);
        } catch (error) {
          await this.#fail(context, 'UNHANDLED_PIPELINE_ERROR', error);
        }
      }

      if (context.checkpoint.state === STATES.COMPLETED) {
        await this.#assertJobSourceUnchanged(context);
      }
      return this.#result(context, false);
    } finally {
      await releaseLock();
    }
  }

  #assertCheckpointIdentity(context) {
    const checkpoint = context.checkpoint;
    if (checkpoint.job_hash !== context.jobHash || checkpoint.job_id !== context.job.job_id) {
      throw new Error('Checkpoint belongs to a different immutable job input');
    }
    if (checkpoint.execution_hash !== context.executionHash) {
      throw new Error('A referenced input or prompt changed after the immutable run was created');
    }
  }

  async #assertJobSourceUnchanged(context) {
    const sourcePath = context.loadedJob.sourcePath;
    if (sourcePath !== '<memory>') {
      const currentHash = sha256(await readFile(sourcePath));
      if (currentHash !== context.jobHash) throw new Error('Immutable job JSON changed while the run was executing');
    }
    const currentReferencePacks = await resolveReferencePacks(context.job);
    const currentInputs = await snapshotInputs(context.job, currentReferencePacks);
    if (JSON.stringify(currentInputs) !== JSON.stringify(context.inputs)) {
      throw new Error('A referenced input or prompt changed while the run was executing');
    }
  }

  async #record(context, type, data = {}) {
    return context.events.append({
      runId: context.runId,
      jobId: context.job.job_id,
      jobHash: context.jobHash,
      type,
      state: context.checkpoint?.state ?? STATES.RECEIVED,
      data,
    });
  }

  async #save(context) {
    context.checkpoint.updated_at = this.clock().toISOString();
    await context.store.writeCheckpoint(context.checkpoint);
  }

  async #transition(context, next, data = {}) {
    const previous = context.checkpoint.state;
    assertTransition(previous, next);
    context.checkpoint.state = next;
    const event = await this.#record(context, 'STATE_TRANSITION', { from: previous, to: next, ...data });
    context.checkpoint.last_event_sequence = event.sequence;
    await this.#save(context);
  }

  async #step(context) {
    switch (context.checkpoint.state) {
      case STATES.RECEIVED:
        return this.#transition(context, STATES.VALIDATING);
      case STATES.VALIDATING:
        await assertFilesReadable(context.job, context.referencePacks);
        await this.#record(context, 'JOB_VALIDATED', { model_route: context.job.model_route });
        return this.#transition(context, STATES.CONDITIONING_IDENTITY);
      case STATES.CONDITIONING_IDENTITY:
        return this.#conditionIdentity(context);
      case STATES.CONDITIONING_OUTFIT:
        return this.#conditionOutfit(context);
      case STATES.CONDITIONING_QA:
        return this.#conditioningQa(context);
      case STATES.CONDITIONING_RETRY:
        context.checkpoint.attempts.conditioning += 1;
        delete context.checkpoint.artifacts.conditioned_identity;
        delete context.checkpoint.artifacts.conditioned_outfit;
        delete context.checkpoint.qa.conditioning;
        await this.#save(context);
        return this.#transition(context, STATES.CONDITIONING_IDENTITY, {
          attempt: context.checkpoint.attempts.conditioning,
        });
      case STATES.REFERENCES_READY:
        if (context.job.approved_avatar_reference) return this.#importApprovedAvatar(context);
        return this.#transition(context, STATES.GENERATING_AVATAR);
      case STATES.GENERATING_AVATAR:
        return this.#generateAvatar(context);
      case STATES.AVATAR_QA:
        return this.#imageQa(context, 'avatar');
      case STATES.AVATAR_RETRY:
        context.checkpoint.attempts.avatar += 1;
        delete context.checkpoint.artifacts.avatar;
        delete context.checkpoint.qa.avatar;
        await this.#save(context);
        {
          const profile = generationProfileForAttempt(context.checkpoint.attempts.avatar, context.job.model_route);
          const jobSetType = profile.job_set_type;
          return this.#transition(context, STATES.GENERATING_AVATAR, {
            attempt: context.checkpoint.attempts.avatar,
            model: imageModelName(jobSetType),
            job_set_type: jobSetType,
            generation_profile: profile.id,
          });
        }
      case STATES.AVATAR_READY:
        return this.#transition(context, STATES.GENERATING_OUTFIT);
      case STATES.GENERATING_OUTFIT:
        return this.#generateOutfit(context);
      case STATES.OUTFIT_QA:
        return this.#imageQa(context, 'outfit');
      case STATES.OUTFIT_RETRY:
        context.checkpoint.attempts.outfit += 1;
        delete context.checkpoint.artifacts.outfit;
        delete context.checkpoint.qa.outfit;
        await this.#save(context);
        {
          const profile = generationProfileForAttempt(context.checkpoint.attempts.outfit, context.job.model_route);
          const jobSetType = profile.job_set_type;
          return this.#transition(context, STATES.GENERATING_OUTFIT, {
            attempt: context.checkpoint.attempts.outfit,
            model: imageModelName(jobSetType),
            job_set_type: jobSetType,
            generation_profile: profile.id,
          });
        }
      case STATES.OUTFIT_READY:
        return this.#transition(context, STATES.EXPORTING);
      case STATES.EXPORTING:
        return this.#export(context);
      default:
        throw new Error(`No executor for state ${context.checkpoint.state}`);
    }
  }

  async #conditionIdentity(context) {
    const attempt = context.checkpoint.attempts.conditioning;
    try {
      const result = await this.#conditionOnce(context, 'identity', attempt, {
        path: context.job.identity_reference,
        ...sourceDescriptor(context.job.identity_reference),
        referencePack: providerPackSummary(context.referencePacks.identity),
      });
      if (!result.artifact) throw new Error('Identity conditioning must return a reference artifact');
      context.checkpoint.artifacts.conditioned_identity = result;
      await this.#save(context);
      return this.#transition(context, STATES.CONDITIONING_OUTFIT);
    } catch (error) {
      return this.#conditioningError(context, error, 'identity');
    }
  }

  async #conditionOutfit(context) {
    const attempt = context.checkpoint.attempts.conditioning;
    const source = context.job.outfit.reference
      ? {
        ...sourceDescriptor(context.job.outfit.reference),
        text: context.job.outfit.text,
        referencePack: providerPackSummary(context.referencePacks.outfit),
      }
      : { text: context.job.outfit.text, mediaType: 'text/plain' };
    try {
      const result = await this.#conditionOnce(context, 'outfit', attempt, source);
      if (context.job.outfit.reference && !result.artifact) {
        throw new Error('Image outfit conditioning must return a reference artifact');
      }
      context.checkpoint.artifacts.conditioned_outfit = result;
      await this.#save(context);
      return this.#transition(context, STATES.CONDITIONING_QA);
    } catch (error) {
      return this.#conditioningError(context, error, 'outfit');
    }
  }

  async #conditioningQa(context) {
    const attempt = context.checkpoint.attempts.conditioning;
    try {
      const qa = await this.#qaOnce(
        context,
        'conditioning',
        attempt,
        qaProviderEvidence(context, 'conditioning'),
      );
      context.checkpoint.qa.conditioning = qa;
      await this.#save(context);
      if (qa.decision === 'PASS') return this.#transition(context, STATES.REFERENCES_READY);
      if (qa.decision === 'NEEDS_INPUT') {
        return this.#transition(context, STATES.NEEDS_INPUT, { phase: 'conditioning', reason: qa.reason });
      }
      if (qa.decision === 'RETRY' && attempt < context.job.conditioning_max_attempts) {
        return this.#transition(context, STATES.CONDITIONING_RETRY, { attempt, defects: qa.defects ?? [] });
      }
      if (qa.decision === 'RETRY') {
        return this.#transition(context, STATES.NEEDS_INPUT, {
          phase: 'conditioning',
          reason: 'conditioning_retry_exhausted',
          defects: qa.defects ?? [],
        });
      }
      return this.#transition(context, STATES.FAILED, { phase: 'conditioning', reason: qa.reason ?? 'rejected' });
    } catch (error) {
      return this.#conditioningError(context, error, 'qa');
    }
  }

  async #conditioningError(context, error, operation) {
    await this.#record(context, 'OPERATION_FAILED', { phase: 'conditioning', operation, ...errorInfo(error) });
    if (error?.retryable !== false && context.checkpoint.attempts.conditioning < context.job.conditioning_max_attempts) {
      return this.#transition(context, STATES.CONDITIONING_RETRY, { operation, error: errorInfo(error) });
    }
    return this.#transition(context, STATES.FAILED, { phase: 'conditioning', operation, error: errorInfo(error) });
  }

  async #generateAvatar(context) {
    const attempt = context.checkpoint.attempts.avatar;
    const generationProfile = generationProfileForAttempt(attempt, context.job.model_route);
    const jobSetType = assertAllowedImageModel(generationProfile.job_set_type);
    const model = imageModelName(jobSetType);
    try {
      const references = generationReferences(context, 'avatar');
      const basePrompt = await compileAvatarPrompt(context.job, context.checkpoint.artifacts.conditioned_identity, references);
      const prompt = materialRepairPrompt(basePrompt, generationProfile, context.checkpoint.qa.avatar);
      context.checkpoint.prompts.avatar = await this.#persistPrompt(context, 'avatar', attempt, prompt);
      const generated = await this.#generateOnce(
        context,
        'avatar',
        attempt,
        jobSetType,
        generationProfile,
        prompt,
        references,
      );
      const result = await this.#normalizeGeneratedImage(context, 'avatar', attempt, generated);
      context.checkpoint.artifacts.avatar = result;
      await this.#save(context);
      return this.#transition(context, STATES.AVATAR_QA, { attempt, model, job_set_type: jobSetType, generation_profile: generationProfile.id });
    } catch (error) {
      return this.#generationError(context, 'avatar', error);
    }
  }

  async #importApprovedAvatar(context) {
    try {
      const reference = context.job.approved_avatar_reference;
      const verified = await verifyApprovedAvatarReference(reference);
      const artifact = await context.store.putBinary(verified.avatarBytes, {
        extension: '.png',
        mediaType: 'image/png',
      });
      if (artifact.digest !== verified.avatarSha256) throw new Error('Imported approved avatar hash changed unexpectedly');
      await assertPngArtifact(artifact, context.store);
      context.checkpoint.attempts.avatar = 0;
      context.checkpoint.artifacts.avatar = {
        artifact,
        model: 'Approved avatar reuse',
        job_set_type: 'approved_avatar_reuse',
        attempt: 0,
        approved_reuse: {
          source_run_id: reference.source_run_id,
          source_sha256: verified.avatarSha256,
          qa_receipt_sha256: reference.qa_receipt.sha256,
        },
      };
      const evidence = qaEvidenceManifest(context, 'avatar', 0);
      const evaluator = {
        type: 'IMPORTED_RECEIPT',
        provider: 'pipeline-runner',
        model: 'approved-avatar-receipt',
        version: '1.0.0',
        evaluation_id: sha256Object({
          source_run_id: reference.source_run_id,
          avatar_sha256: verified.avatarSha256,
          qa_receipt_sha256: reference.qa_receipt.sha256,
          evidence_manifest_sha256: evidence.manifest_sha256,
        }),
      };
      const receipt = createCoreQaReceipt({
        phase: 'avatar',
        attempt: 0,
        jobId: context.job.job_id,
        runId: context.runId,
        evidence,
        response: {
          decision: 'PASS',
          reason: 'Approved avatar bytes and their source PASS receipt are hash-bound.',
          checks: [{
            name: 'APPROVED_AVATAR_RECEIPT',
            pass: true,
            score: 1,
            evidence: 'The imported PNG hash matches the source output and source PASS manifest.',
          }],
          defects: [],
          evaluator,
        },
      });
      const receiptArtifact = await context.store.putJson(receipt);
      context.checkpoint.qa.avatar = {
        ...qaResultFromReceipt(receipt, receiptArtifact),
        reused: true,
        source_run_id: reference.source_run_id,
        avatar_sha256: verified.avatarSha256,
        receipt_sha256: reference.qa_receipt.sha256,
      };
      await this.#record(context, 'APPROVED_AVATAR_IMPORTED', {
        source_run_id: reference.source_run_id,
        avatar_sha256: verified.avatarSha256,
        qa_receipt_sha256: reference.qa_receipt.sha256,
      });
      await this.#save(context);
      return this.#transition(context, STATES.AVATAR_READY, {
        reused: true,
        source_run_id: reference.source_run_id,
        avatar_sha256: verified.avatarSha256,
      });
    } catch (error) {
      error.retryable = false;
      return this.#generationError(context, 'avatar', error);
    }
  }

  async #generateOutfit(context) {
    const attempt = context.checkpoint.attempts.outfit;
    const generationProfile = generationProfileForAttempt(attempt, context.job.model_route);
    const jobSetType = assertAllowedImageModel(generationProfile.job_set_type);
    const model = imageModelName(jobSetType);
    try {
      const references = generationReferences(context, 'outfit');
      const basePrompt = await compileOutfitPrompt(context.job, {
        conditionedIdentity: context.checkpoint.artifacts.conditioned_identity,
        conditionedOutfit: context.checkpoint.artifacts.conditioned_outfit,
        avatar: context.checkpoint.artifacts.avatar,
        references,
      });
      const prompt = materialRepairPrompt(basePrompt, generationProfile, context.checkpoint.qa.outfit);
      context.checkpoint.prompts.outfit = await this.#persistPrompt(context, 'outfit', attempt, prompt);
      const generated = await this.#generateOnce(
        context,
        'outfit',
        attempt,
        jobSetType,
        generationProfile,
        prompt,
        references,
      );
      const result = await this.#normalizeGeneratedImage(context, 'outfit', attempt, generated);
      context.checkpoint.artifacts.outfit = result;
      await this.#save(context);
      return this.#transition(context, STATES.OUTFIT_QA, { attempt, model, job_set_type: jobSetType, generation_profile: generationProfile.id });
    } catch (error) {
      return this.#generationError(context, 'outfit', error);
    }
  }

  async #generationError(context, phase, error) {
    const attempt = context.checkpoint.attempts[phase];
    await this.#record(context, 'OPERATION_FAILED', { phase, attempt, ...errorInfo(error) });
    if (error?.retryable !== false && attempt < context.job.max_attempts) {
      return this.#transition(context, phase === 'avatar' ? STATES.AVATAR_RETRY : STATES.OUTFIT_RETRY, {
        attempt,
        error: errorInfo(error),
      });
    }
    return this.#transition(context, STATES.FAILED, { phase, attempt, error: errorInfo(error) });
  }

  async #imageQa(context, phase) {
    const attempt = context.checkpoint.attempts[phase];
    const candidate = context.checkpoint.artifacts[phase];
    try {
      const qa = await this.#qaOnce(
        context,
        phase,
        attempt,
        qaProviderEvidence(context, phase),
      );
      context.checkpoint.qa[phase] = qa;
      await this.#save(context);
      if (qa.decision === 'PASS') {
        return this.#transition(context, phase === 'avatar' ? STATES.AVATAR_READY : STATES.OUTFIT_READY, {
          attempt,
          model: candidate.model,
          job_set_type: candidate.job_set_type,
        });
      }
      if (qa.decision === 'NEEDS_INPUT') {
        return this.#transition(context, STATES.NEEDS_INPUT, { phase, reason: qa.reason });
      }
      if (qa.decision === 'RETRY' && attempt < context.job.max_attempts) {
        return this.#transition(context, phase === 'avatar' ? STATES.AVATAR_RETRY : STATES.OUTFIT_RETRY, {
          attempt,
          defects: qa.defects ?? [],
        });
      }
      return this.#transition(context, STATES.FAILED, {
        phase,
        reason: qa.reason ?? (qa.decision === 'RETRY' ? 'model_route_exhausted' : 'qa_rejected'),
        defects: qa.defects ?? [],
      });
    } catch (error) {
      return this.#generationError(context, phase, error);
    }
  }

  async #conditionOnce(context, role, attempt, source) {
    const key = operationKey(context.executionHash, `condition:${role}`, attempt);
    const existing = await context.store.readReceipt(key);
    if (existing) {
      await this.#record(context, 'RECEIPT_REUSED', { operation: `condition:${role}`, attempt, idempotency_key: key });
      return existing.result;
    }
    await this.#record(context, 'PROVIDER_CALL_STARTED', { operation: 'condition', role, attempt, idempotency_key: key });
    const response = await this.provider.condition({
      operation: 'condition',
      role,
      attempt,
      idempotencyKey: key,
      jobId: context.job.job_id,
      source,
      previousQa: context.checkpoint.qa.conditioning,
    });
    let artifact;
    if (response.reference) {
      artifact = await context.store.putBinary(response.reference, {
        extension: response.extension ?? source.extension ?? '.bin',
        mediaType: response.mediaType ?? source.mediaType,
      });
    }
    const factsArtifact = await context.store.putJson(response.facts ?? {});
    const result = {
      artifact,
      facts: response.facts ?? {},
      facts_artifact: factsArtifact,
      risks: response.risks ?? [],
    };
    await context.store.writeReceipt(key, { operation: 'condition', role, attempt, result });
    await this.#record(context, 'PROVIDER_CALL_SUCCEEDED', { operation: 'condition', role, attempt, idempotency_key: key });
    return result;
  }

  async #generateOnce(context, phase, attempt, jobSetType, generationProfile, prompt, references) {
    const key = operationKey(context.executionHash, `generate:${phase}`, attempt);
    const model = imageModelName(jobSetType);
    const existing = await context.store.readReceipt(key);
    if (existing) {
      await this.#record(context, 'RECEIPT_REUSED', { operation: `generate:${phase}`, attempt, idempotency_key: key });
      return existing.result;
    }
    await this.#record(context, 'PROVIDER_CALL_STARTED', {
      operation: 'generate', phase, attempt, model, job_set_type: jobSetType, generation_profile: generationProfile.id, idempotency_key: key,
    });
    const response = await this.provider.generate({
      operation: 'generate',
      phase,
      attempt,
      model: jobSetType,
      model_name: model,
      job_set_type: jobSetType,
      generation_profile: generationProfile,
      resolution: generationProfile.resolution,
      quality: generationProfile.quality,
      prompt,
      references,
      idempotencyKey: key,
      jobId: context.job.job_id,
      workDirectory: context.workDirectory,
      previousQa: context.checkpoint.qa[phase],
    });
    if (!response || !response.image) throw new Error('Generation provider returned no image');
    if (response.mediaType !== 'image/png') throw new Error('Generation provider must return mediaType image/png');
    const artifact = await context.store.putBinary(response.image, {
      extension: '.png',
      mediaType: 'image/png',
    });
    await assertPngArtifact(artifact, context.store);
    const result = {
      artifact,
      model,
      job_set_type: jobSetType,
      generation_profile: generationProfile,
      attempt,
      metadata: response.metadata ?? {},
    };
    await context.store.writeReceipt(key, {
      operation: 'generate', phase, attempt, model, job_set_type: jobSetType, generation_profile: generationProfile, result,
    });
    await this.#record(context, 'PROVIDER_CALL_SUCCEEDED', {
      operation: 'generate', phase, attempt, model, job_set_type: jobSetType, generation_profile: generationProfile.id,
      idempotency_key: key, output_sha256: artifact.digest,
    });
    return result;
  }

  async #normalizeGeneratedImage(context, phase, attempt, generated) {
    const key = operationKey(context.executionHash, `normalize:${phase}`, attempt);
    const existing = await context.store.readReceipt(key);
    if (existing) {
      const parentSha256 = existing.result?.normalization?.lineage?.parent_sha256;
      if (parentSha256 !== generated.artifact.digest) {
        throw new Error(`Normalization receipt source mismatch for ${phase} attempt ${attempt}`);
      }
      await assertPngArtifact(existing.result.artifact, context.store);
      await this.#record(context, 'RECEIPT_REUSED', {
        operation: `normalize:${phase}`,
        attempt,
        idempotency_key: key,
        source_sha256: generated.artifact.digest,
        output_sha256: existing.result.artifact.digest,
      });
      return existing.result;
    }

    await this.#record(context, 'NORMALIZATION_STARTED', {
      phase,
      attempt,
      idempotency_key: key,
      source_sha256: generated.artifact.digest,
    });
    const normalized = await normalizeWhitePngBytes(await readFile(generated.artifact.path));
    const artifact = await context.store.putBinary(normalized.image, {
      extension: '.png',
      mediaType: 'image/png',
    });
    await assertPngArtifact(artifact, context.store);
    const lineage = {
      parent_sha256: generated.artifact.digest,
      operation: 'NORMALIZE_BORDER_CONNECTED_NEAR_WHITE_TO_EXACT_WHITE',
      parameters: {
        minimum_channel: normalized.stats.minimum_channel,
        maximum_chroma: normalized.stats.maximum_chroma,
        connectivity: normalized.stats.connectivity,
        target_rgb: [255, 255, 255],
      },
      output_sha256: artifact.digest,
    };
    const evidence = {
      schema_version: '1.0.0',
      phase,
      attempt,
      wrote_output: normalized.wrote_output,
      stats: normalized.stats,
      lineage,
    };
    const evidenceArtifact = await context.store.putJson(evidence);
    const result = {
      ...generated,
      provider_original_artifact: generated.artifact,
      artifact,
      normalization: {
        ...evidence,
        evidence_artifact: evidenceArtifact,
      },
    };
    await context.store.writeReceipt(key, {
      operation: 'normalize',
      phase,
      attempt,
      result,
    });
    await this.#record(context, 'NORMALIZATION_SUCCEEDED', {
      phase,
      attempt,
      idempotency_key: key,
      source_sha256: generated.artifact.digest,
      output_sha256: artifact.digest,
      changed_pixels: normalized.stats.changed_pixels,
      wrote_output: normalized.wrote_output,
      evidence_sha256: evidenceArtifact.digest,
    });
    return result;
  }

  async #qaOnce(context, phase, attempt, evidence) {
    const baseEvidence = qaEvidenceManifest(context, phase, attempt);
    const key = operationKey(
      context.executionHash,
      `qa:${phase}:${baseEvidence.manifest_sha256}`,
      attempt,
    );
    const existing = await context.store.readReceipt(key);
    if (existing) {
      if (existing.operation !== 'qa'
        || existing.phase !== phase
        || existing.attempt !== attempt
        || existing.base_evidence_manifest_sha256 !== baseEvidence.manifest_sha256) {
        throw new Error(`Conflicting semantic QA operation receipt for ${phase} attempt ${attempt}`);
      }
      const document = await context.store.readJsonArtifact(existing.receipt_artifact);
      const expectedEvidence = preparedEvidenceFromReceipt(baseEvidence, document.evidence);
      const verified = verifyCoreQaReceipt(document, {
        phase,
        attempt,
        jobId: context.job.job_id,
        runId: context.runId,
        evidence: expectedEvidence,
        receiptId: existing.receipt_id,
      });
      const result = qaResultFromReceipt(verified, existing.receipt_artifact);
      await this.#record(context, 'RECEIPT_REUSED', {
        operation: `qa:${phase}`,
        attempt,
        idempotency_key: key,
        receipt_id: verified.receipt_id,
        subject_sha256: verified.subject.sha256,
        evidence_manifest_sha256: verified.evidence.manifest_sha256,
      });
      return result;
    }
    const candidateArtifact = context.checkpoint.artifacts[phase]?.artifact;
    const background = candidateArtifact
      ? await inspectImage(candidateArtifact.path, { requireBottomCorners: true })
      : null;
    if (background && background.background_diagnostics?.status !== 'PASS') {
      const diagnostics = background.background_diagnostics;
      const response = {
        decision: 'RETRY',
        reason: 'master_background_not_exact_white',
        checks: [{
          name: 'EXACT_WHITE_KEY_SURFACE',
          pass: false,
          score: 0,
          evidence: `Exact #FFFFFF key-surface failed: top=${diagnostics.coverage.minimum_top_corner}, bottom=${diagnostics.coverage.minimum_bottom_corner}, classified exact-white=${diagnostics.exact_white_ratio}.`,
        }],
        defects: ['MASTER_BACKGROUND_NOT_EXACT_WHITE'],
        evaluator: {
          type: 'ADAPTER',
          provider: 'pipeline-runner',
          model: 'exact-white-key-surface',
          version: '1.0.0',
          evaluation_id: sha256Object({
            gate: 'EXACT_WHITE_KEY_SURFACE',
            phase,
            attempt,
            subject_sha256: baseEvidence.subject.sha256,
            diagnostics,
          }),
        },
      };
      const receipt = createCoreQaReceipt({
        phase,
        attempt,
        jobId: context.job.job_id,
        runId: context.runId,
        evidence: baseEvidence,
        response,
      });
      const receiptArtifact = await context.store.putJson(receipt);
      const result = qaResultFromReceipt(receipt, receiptArtifact);
      await context.store.writeReceipt(key, {
        operation: 'qa',
        phase,
        attempt,
        base_evidence_manifest_sha256: baseEvidence.manifest_sha256,
        receipt_id: receipt.receipt_id,
        receipt_artifact: receiptArtifact,
      });
      await this.#record(context, 'DETERMINISTIC_QA_FAILED', {
        operation: 'qa',
        phase,
        attempt,
        gate: 'EXACT_WHITE_KEY_SURFACE',
        idempotency_key: key,
        subject_sha256: baseEvidence.subject.sha256,
        evidence_manifest_sha256: baseEvidence.manifest_sha256,
      });
      return result;
    }
    await this.#record(context, 'PROVIDER_CALL_STARTED', {
      operation: 'qa',
      phase,
      attempt,
      idempotency_key: key,
      subject_sha256: baseEvidence.subject.sha256,
      evidence_manifest_sha256: baseEvidence.manifest_sha256,
    });
    const response = assertQaDecision(await this.provider.qa({
      operation: 'qa',
      phase,
      attempt,
      evidence,
      evidence_manifest_sha256: baseEvidence.manifest_sha256,
      idempotencyKey: key,
      jobId: context.job.job_id,
    }));
    const finalEvidence = attachPreparedEvidence(
      baseEvidence,
      response.prepared_evidence ?? [],
      {
        requireEveryVisualBinding: response.decision === 'PASS'
          && response.evaluator?.type === 'MODEL',
      },
    );
    const receipt = createCoreQaReceipt({
      phase,
      attempt,
      jobId: context.job.job_id,
      runId: context.runId,
      evidence: finalEvidence,
      response: {
        decision: response.decision,
        reason: response.reason,
        checks: response.checks,
        defects: response.defects,
        evaluator: response.evaluator,
      },
    });
    const receiptArtifact = await context.store.putJson(receipt);
    const result = qaResultFromReceipt(receipt, receiptArtifact);
    await context.store.writeReceipt(key, {
      operation: 'qa',
      phase,
      attempt,
      base_evidence_manifest_sha256: baseEvidence.manifest_sha256,
      receipt_id: receipt.receipt_id,
      receipt_artifact: receiptArtifact,
    });
    await this.#record(context, 'PROVIDER_CALL_SUCCEEDED', {
      operation: 'qa',
      phase,
      attempt,
      decision: response.decision,
      idempotency_key: key,
      receipt_id: receipt.receipt_id,
      subject_sha256: receipt.subject.sha256,
      evidence_manifest_sha256: receipt.evidence.manifest_sha256,
    });
    return result;
  }

  async #verifyCoreQaGate(context, phase, { requirePass = true } = {}) {
    const result = context.checkpoint.qa?.[phase];
    const attempt = context.checkpoint.attempts?.[phase];
    if (!result?.artifact || !Number.isInteger(attempt)) {
      throw new Error(`Core semantic QA receipt is missing for ${phase}`);
    }
    const document = await context.store.readJsonArtifact(result.artifact);
    const baseEvidence = qaEvidenceManifest(context, phase, attempt);
    const expectedEvidence = preparedEvidenceFromReceipt(baseEvidence, document.evidence);
    const verified = verifyCoreQaReceipt(document, {
      phase,
      attempt,
      jobId: context.job.job_id,
      runId: context.runId,
      evidence: expectedEvidence,
      receiptId: result.receipt_id,
      requirePass,
    });
    if (result.subject_sha256 !== verified.subject.sha256
      || result.evidence_manifest_sha256 !== verified.evidence.manifest_sha256
      || result.prompt_sha256 !== verified.evidence.prompt_sha256
      || result.artifact.digest !== sha256(await readFile(result.artifact.path))) {
      throw new Error(`Checkpoint semantic QA binding is stale for ${phase}`);
    }
    return verified;
  }

  async #persistPrompt(context, phase, attempt, prompt) {
    const artifact = await context.store.putBinary(Buffer.from(prompt), {
      extension: '.txt',
      mediaType: 'text/plain',
    });
    return { phase, attempt, sha256: artifact.digest, path: artifact.path, text: prompt };
  }

  async #export(context) {
    await this.#verifyCoreQaGate(context, 'conditioning');
    await this.#verifyCoreQaGate(context, 'avatar');
    await this.#verifyCoreQaGate(context, 'outfit');
    await assertPngArtifact(context.checkpoint.artifacts.avatar.artifact, context.store);
    await assertPngArtifact(context.checkpoint.artifacts.outfit.artifact, context.store);
    const avatarPath = path.join(context.job.output_directory, 'avatar.png');
    const outfitPath = path.join(context.job.output_directory, 'avatar_outfit.png');
    await context.store.materialize(context.checkpoint.artifacts.avatar.artifact, avatarPath);
    await context.store.materialize(context.checkpoint.artifacts.outfit.artifact, outfitPath);
    const manifest = publicManifestView({
      schema_version: '1.0.0',
      run_id: context.runId,
      job_id: context.job.job_id,
      job_hash: context.jobHash,
      execution_hash: context.executionHash,
      state: STATES.COMPLETED,
      outputs: {
        avatar: { path: avatarPath, sha256: context.checkpoint.artifacts.avatar.artifact.digest },
        avatar_outfit: { path: outfitPath, sha256: context.checkpoint.artifacts.outfit.artifact.digest },
      },
      attempts: context.checkpoint.attempts,
      models: {
        avatar: {
          name: context.checkpoint.artifacts.avatar.model,
          job_set_type: context.checkpoint.artifacts.avatar.job_set_type,
          ...(context.checkpoint.artifacts.avatar.approved_reuse ? {
            reused: true,
            source_run_id: context.checkpoint.artifacts.avatar.approved_reuse.source_run_id,
          } : {}),
        },
        outfit: {
          name: context.checkpoint.artifacts.outfit.model,
          job_set_type: context.checkpoint.artifacts.outfit.job_set_type,
        },
      },
      image_artifacts: {
        avatar: context.checkpoint.artifacts.avatar.approved_reuse
          ? {
            approved_reuse: true,
            imported: context.checkpoint.artifacts.avatar.artifact,
            provenance: context.checkpoint.artifacts.avatar.approved_reuse,
          }
          : {
            provider_original: context.checkpoint.artifacts.avatar.provider_original_artifact,
            normalized: context.checkpoint.artifacts.avatar.artifact,
            normalization: context.checkpoint.artifacts.avatar.normalization,
          },
        avatar_outfit: {
          provider_original: context.checkpoint.artifacts.outfit.provider_original_artifact,
          normalized: context.checkpoint.artifacts.outfit.artifact,
          normalization: context.checkpoint.artifacts.outfit.normalization,
        },
      },
      prompts: context.checkpoint.prompts,
      qa: context.checkpoint.qa,
    });
    const manifestArtifact = await context.store.putJson(manifest);
    const manifestPath = path.join(context.job.output_directory, 'run-manifest.json');
    await context.store.materialize(manifestArtifact, manifestPath);
    context.checkpoint.artifacts.run_manifest = manifestArtifact;
    context.checkpoint.outputs = { avatar: avatarPath, avatar_outfit: outfitPath, manifest: manifestPath };
    await this.#save(context);
    await this.#record(context, 'OUTPUTS_EXPORTED', {
      avatar: avatarPath,
      avatar_outfit: outfitPath,
      manifest: manifestPath,
    });
    return this.#transition(context, STATES.COMPLETED);
  }

  async #ensureCompletedOutputs(context) {
    const avatar = context.checkpoint.artifacts.avatar?.artifact;
    const outfit = context.checkpoint.artifacts.outfit?.artifact;
    const manifestArtifact = context.checkpoint.artifacts.run_manifest;
    if (!avatar || !outfit || !manifestArtifact) {
      throw new Error('Completed checkpoint is missing content-addressed output references');
    }
    await assertPngArtifact(avatar, context.store);
    await assertPngArtifact(outfit, context.store);
    const conditioningReceipt = await this.#verifyCoreQaGate(context, 'conditioning');
    const avatarReceipt = await this.#verifyCoreQaGate(context, 'avatar');
    const outfitReceipt = await this.#verifyCoreQaGate(context, 'outfit');
    const manifest = await context.store.readJsonArtifact(manifestArtifact);
    if (manifest.schema_version !== '1.0.0'
      || manifest.run_id !== context.runId
      || manifest.job_id !== context.job.job_id
      || manifest.job_hash !== context.jobHash
      || manifest.execution_hash !== context.executionHash
      || manifest.state !== STATES.COMPLETED
      || manifest.outputs?.avatar?.sha256 !== avatar.digest
      || manifest.outputs?.avatar_outfit?.sha256 !== outfit.digest
      || manifest.qa?.conditioning?.receipt_id !== conditioningReceipt.receipt_id
      || manifest.qa?.avatar?.receipt_id !== avatarReceipt.receipt_id
      || manifest.qa?.outfit?.receipt_id !== outfitReceipt.receipt_id) {
      throw new Error('Completed public manifest is stale or not bound to the current run');
    }
    const avatarPath = path.join(context.job.output_directory, 'avatar.png');
    const outfitPath = path.join(context.job.output_directory, 'avatar_outfit.png');
    const manifestPath = path.join(context.job.output_directory, 'run-manifest.json');
    if (context.checkpoint.outputs?.avatar !== avatarPath
      || context.checkpoint.outputs?.avatar_outfit !== outfitPath
      || context.checkpoint.outputs?.manifest !== manifestPath) {
      throw new Error('Completed checkpoint output paths are stale');
    }
    if (!(await context.store.verifyMaterialized(avatar, avatarPath))) {
      await context.store.materialize(avatar, avatarPath);
    }
    if (!(await context.store.verifyMaterialized(outfit, outfitPath))) {
      await context.store.materialize(outfit, outfitPath);
    }
    if (!(await context.store.verifyMaterialized(manifestArtifact, manifestPath))) {
      await context.store.materialize(manifestArtifact, manifestPath);
    }
  }

  async #fail(context, type, error) {
    const details = errorInfo(error);
    context.checkpoint.last_error = details;
    await this.#record(context, type, details);
    if (!isTerminal(context.checkpoint.state)) {
      await this.#transition(context, STATES.FAILED, { error: details });
    }
  }

  #result(context, reused) {
    return Object.freeze({
      runId: context.runId,
      jobId: context.job.job_id,
      status: context.checkpoint.state,
      reused,
      attempts: structuredClone(context.checkpoint.attempts),
      outputs: structuredClone(context.checkpoint.outputs ?? {}),
      workDirectory: context.workDirectory,
      eventsPath: context.events.filename,
      checkpointPath: context.store.checkpointPath,
      lastError: structuredClone(context.checkpoint.last_error ?? null),
    });
  }
}
