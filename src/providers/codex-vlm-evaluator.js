import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { assertExternalPromptPrivacy, sanitizeExternalPrompt } from './provider-prompt-privacy.js';

const DECISIONS = new Set(['PASS', 'RETRY', 'NEEDS_INPUT', 'REJECT']);
const CATEGORIES = new Set(['outerwear', 'top', 'bottom', 'one_piece', 'footwear', 'headwear', 'bag', 'accessory']);
const AMBIGUOUS_VERSIONS = /^(?:latest|current|unknown|unattested)$/i;

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function evaluatorResult(value, {
  model,
  context,
  preparedEvidence = [],
  provider = 'openai-codex-cli',
}) {
  const resultSha256 = sha256(JSON.stringify({
    decision: value.decision,
    reason: value.reason,
    checks: value.checks,
    defects: value.defects,
  }));
  const identity = {
    type: 'MODEL',
    provider,
    model,
    version: model,
    phase: context?.phase ?? null,
    attempt: Number.isInteger(context?.attempt) ? context.attempt : null,
    idempotency_key: context?.idempotencyKey ?? null,
    evidence_manifest_sha256: context?.evidence_manifest_sha256 ?? null,
    result_sha256: resultSha256,
    prepared_evidence: preparedEvidence,
  };
  return {
    ...value,
    prepared_evidence: preparedEvidence,
    evaluator: {
      type: identity.type,
      provider: identity.provider,
      model: identity.model,
      version: identity.version,
      evaluation_id: sha256(JSON.stringify(identity)),
    },
  };
}

async function defaultCommandRunner(binary, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve({ stdout, stderr, exitCode: 0 });
    });
    // Codex appends piped stdin to an explicit prompt. An unclosed Node pipe
    // therefore makes it wait until timeout; close it immediately.
    child.stdin?.end();
  });
}

export function imagePath(value) {
  const artifact = value?.artifact ?? value;
  return typeof artifact?.path === 'string' ? path.resolve(artifact.path) : null;
}

function qaImage(value, role) {
  const filename = imagePath(value);
  return filename ? { path: filename, role } : null;
}

export function collectQaImages(evidence = {}, phase = 'outfit') {
  const ordered = [
    qaImage(evidence.identity, phase === 'garment' ? 'RAW_GARMENT_PRIMARY' : 'IDENTITY_REFERENCE'),
    qaImage(evidence.avatar, 'APPROVED_AVATAR'),
    qaImage(evidence.outfit, 'OUTFIT_REFERENCE'),
    qaImage(evidence.candidate, phase === 'garment' ? 'GENERATED_CANONICAL_CANDIDATE' : 'GENERATED_CANDIDATE'),
  ];
  for (const raw of [evidence.source_identity, evidence.source_outfit]) {
    if (typeof raw === 'string' && /\.(?:png|jpe?g|webp)$/i.test(raw)) ordered.push(qaImage({ path: raw }, 'RAW_SOURCE_REFERENCE'));
  }
  for (const scope of ['identity', 'outfit']) {
    for (const [index, binding] of (evidence.reference_packs?.[scope]?.bindings ?? []).entries()) {
      const role = phase === 'garment' && scope === 'outfit'
        ? `RAW_GARMENT_VIEW_${index + 1}`
        : `${scope.toUpperCase()}_REFERENCE_${index + 1}`;
      ordered.push(qaImage(binding, role));
    }
  }
  for (const [index, filename] of (evidence.quality_references ?? []).entries()) {
    if (typeof filename === 'string' && /\.(?:png|jpe?g|webp)$/i.test(filename)) {
      ordered.push(qaImage({ path: filename }, `QUALITY_REFERENCE_${index + 1}`));
    }
  }
  return ordered.filter(Boolean);
}

export function qaPrompt(phase, images, evidence = {}) {
  const labels = images.map((entry, index) => {
    const role = typeof entry === 'object' ? entry.role : 'VISUAL_EVIDENCE';
    const aliases = typeof entry === 'object' && Array.isArray(entry.roles)
      ? entry.roles.filter((candidate) => candidate !== role)
      : [];
    return `ATTACHMENT_${index + 1} [${role}]${aliases.length ? ` aliases: ${aliases.map((alias) => `[${alias}]`).join(' ')}` : ''}`;
  }).join('\n');
  const sourceOutfitIsImage = typeof evidence.source_outfit === 'string'
    && /\.(?:png|jpe?g|webp)$/i.test(evidence.source_outfit);
  const outfitText = typeof evidence.source_outfit === 'string' && !sourceOutfitIsImage
    ? evidence.source_outfit
    : typeof evidence.outfit?.facts?.text === 'string' ? evidence.outfit.facts.text : '';
  const targetContext = outfitText
    ? `\nAUTHORITATIVE TARGET OUTFIT TEXT\n${outfitText}\nThe clothing visible in identity photos is identity context only. Do not treat it as the target outfit or reject its intentional replacement.`
    : '';
  const phaseRules = {
    // A mirror selfie with a phone covering roughly 2% of the face and an ordinary
    // bathroom wall behind it was rejected as NEEDS_INPUT, reasoning that the phone
    // and the wall prevent "a clean frontal avatar on white background" -- a standard
    // no downstream stage actually asks the source photo to meet. The source photo is
    // identity evidence, not the avatar; the white background and full-length framing
    // belong to the generated avatar (see the 'avatar' rule below), and asking a raw
    // selfie for either fabricates a requirement it was never held to.
    conditioning: 'Check whether source identity and garment evidence are usable. A normal mirror-selfie or handheld photo commonly has a phone, hand or arm covering a small part of the face or body, and an ordinary room in the background -- neither is a defect. Judge usability only by whether enough of the face (eyes, nose, mouth) and body is visible to identify the person and reconstruct their garments; minor or incidental occlusion under roughly 10 percent of the face is usable evidence, and background content is never a reason to reject. Never infer hidden body or garment details. Use NEEDS_INPUT only when identity or garment evidence is actually insufficient -- for example the face is substantially hidden, no person is visible, or the image quality itself is unusable.',
    // prompts/avatar.txt makes the avatar the full-length continuity authority
    // that every later stage is measured against. Asking QA for a half-body
    // crop here rejected all three avatar attempts of run 0810e427 on framing
    // alone while the generator was producing exactly what it was told to.
    avatar: 'Compare the candidate avatar with identity evidence. Require the same recognizable person, frontal full-length framing from the top of the head through the soles of the feet with both feet and any footwear inside the frame, full face, natural anatomy, studio photorealism, and no visible background defects.',
    outfit: 'Compare the candidate with identity, approved avatar, and garment/text evidence. Require the same person and exact observable garment type, colors, material, pattern, logo/text, construction and fit. Reject old-clothing residue and anatomy defects.',
    garment: 'RAW_GARMENT_PRIMARY and RAW_GARMENT_VIEW_* are authoritative source photos; GENERATED_CANONICAL_CANDIDATE is the generated image under review. Compare the candidate against every raw view, never the reverse. Require unchanged type, shape, color, pattern, logo/text and construction only where that fact is clearly visible in at least one raw view. A hidden, absent or unreadable logo/text, rear detail, sole or other unobserved property is UNKNOWN: it is not a mismatch and the candidate must not be required to prove it. Surface weave, grain, gloss, microtexture, or a close material-rendering difference is advisory only: it must never cause RETRY by itself. In particular, do not call a close upper-surface difference (such as mesh versus a pebbled texture) a construction mismatch when the silhouette, panel layout, logo, closures and distinctive geometry agree. Material becomes blocking only when it visibly changes the product category or design, for example a leather boot becoming a knit runner. Reject a candidate only for a positive contradiction, or an omission of a clearly visible source feature. The canonical image must show only the complete garment on clean white. Use NEEDS_INPUT only when the raw garment photos themselves are insufficient to identify the target, regardless of candidate quality. When raw evidence is usable, a blocking mismatch, omission, invention, crop, background issue or other candidate defect is a generated-route failure: use RETRY when another generation can fix it, or REJECT when this candidate is unusable. Never use NEEDS_INPUT merely because the generated candidate differs from usable raw evidence.',
    scene: 'Compare the editorial scene with the approved outfit still. Require the same person and unchanged approved outfit; judge scene intent separately.',
  };
  return sanitizeExternalPrompt(`Visually judge the attached images for ${phase} QA. ${phaseRules[phase] ?? phaseRules.outfit}${targetContext}\nOrdered attachment bindings:\n${labels}\nFill every schema field with concise visible evidence. PASS only if all blocking criteria are visibly supported; RETRY for a fixable generated defect; NEEDS_INPUT for insufficient source evidence; REJECT for an irrecoverable mismatch. Return only JSON.`);
}

export function garmentPrompt(images) {
  const labels = images.map((_, index) => `ATTACHMENT_${index + 1} [RAW_ITEM_VIEW_${index + 1}] maps to source_index ${index}`).join('\n');
  return `Inspect the attached wardrobe photos as one evidence collection.\n\n${labels}\n\nReturn one item for every source image. Also partition every source index into exactly one reference_set. Group multiple images only when they visibly show the same exact physical garment from different angles or contexts. A multi-image set requires same_item_confidence >= 0.90 and concrete evidence such as matching stripe spacing, collar, buttons, seams, logo, wear marks or construction with no contradictions. If exact sameness is uncertain, use separate singleton sets even when the category is the same. primary_source_index must belong to source_indexes and be the clearest view. For each image, classify the primary wearable item as exactly one allowed category: outerwear, top, bottom, one_piece, footwear, headwear, bag, accessory. Record only visibly observed type, colors, likely material, pattern, exact readable logo/text, and construction details. For views in one set, merge visible evidence so their observations consistently describe that garment. Put hidden, obscured or uncertain properties in unknowns. Use NEEDS_INPUT when the primary item cannot be identified reliably or critical exact details are too obscured or low-resolution. Confidence below 0.70 must not be READY. Return only the JSON required by the supplied schema. Never call tools.`;
}

export function validateQa(value) {
  if (!value || typeof value !== 'object' || !DECISIONS.has(value.decision)) throw new Error('Codex QA returned an invalid decision');
  if (typeof value.reason !== 'string' || !Array.isArray(value.checks) || value.checks.length === 0 || !Array.isArray(value.defects)) throw new Error('Codex QA returned an incomplete object');
  for (const check of value.checks) {
    if (!check || typeof check.name !== 'string' || typeof check.pass !== 'boolean' || typeof check.score !== 'number' || check.score < 0 || check.score > 1 || typeof check.evidence !== 'string') throw new Error('Codex QA returned an invalid check');
  }
  return value;
}

export function validatePassport(value, expectedCount) {
  if (!value || !['READY', 'NEEDS_INPUT'].includes(value.status) || !Array.isArray(value.items) || value.items.length !== expectedCount) throw new Error('Картка речі: Codex повернув некоректну кількість елементів або статус');
  const indexes = new Set();
  for (const item of value.items) {
    if (!Number.isInteger(item.source_index) || item.source_index < 0 || item.source_index >= expectedCount || indexes.has(item.source_index)) throw new Error('Картка речі: Codex повернув некоректні індекси фото');
    indexes.add(item.source_index);
    if (!CATEGORIES.has(item.category) || typeof item.confidence !== 'number' || item.confidence < 0 || item.confidence > 1) throw new Error('Картка речі: Codex повернув некоректну класифікацію');
    if (!item.observed || typeof item.observed.garment_type !== 'string' || !Array.isArray(item.blockers) || !Array.isArray(item.unknowns)) throw new Error('Картка речі: Codex повернув неповний опис характеристик');
    if (item.confidence < 0.7 && value.status === 'READY') throw new Error('Картка речі з низькою впевненістю не може мати статус READY');
  }
  if (!Array.isArray(value.reference_sets) || value.reference_sets.length < 1 || value.reference_sets.length > expectedCount) throw new Error('Картка речі: Codex повернув некоректні групи ракурсів');
  const assigned = new Set();
  for (const set of value.reference_sets) {
    if (!Array.isArray(set.source_indexes) || set.source_indexes.length === 0 || !Number.isInteger(set.primary_source_index)
      || !set.source_indexes.includes(set.primary_source_index) || typeof set.same_item_confidence !== 'number'
      || !Array.isArray(set.evidence) || set.evidence.length === 0) throw new Error('Картка речі: Codex повернув некоректну групу ракурсів');
    if (set.source_indexes.length > 1 && set.same_item_confidence < 0.9) throw new Error('Впевненість у групуванні ракурсів нижча за 0.90');
    const categories = new Set();
    for (const index of set.source_indexes) {
      if (!Number.isInteger(index) || index < 0 || index >= expectedCount || assigned.has(index)) throw new Error('Кожне вихідне фото має входити рівно до однієї групи ракурсів');
      assigned.add(index);
      categories.add(value.items.find((item) => item.source_index === index)?.category);
    }
    if (categories.size !== 1) throw new Error('Одна група ракурсів не може змішувати різні категорії речей');
  }
  if (assigned.size !== expectedCount) throw new Error('Групи ракурсів мають охоплювати кожне вихідне фото');
  return value;
}

/**
 * Normalize oversized camera photos before transport and deduplicate byte-identical
 * evidence across roles. Shared by every VLM transport (Codex CLI, OpenRouter, ...)
 * so evaluators built on different backends attach byte-identical evidence.
 */
export async function prepareTransportEvidence({ images, temporaryRoot, deduplicate = true }) {
  const qaImages = [];
  const preparedEvidence = [];
  const seenEvidence = new Set();
  const preparedByDigest = new Map();
  for (const [index, input] of images.entries()) {
    const filename = imagePath(input) ?? input;
    const qaPath = path.join(temporaryRoot, `evidence-${String(index + 1).padStart(2, '0')}.jpg`);
    const sourceBytes = await readFile(filename);
    const sourceSha256 = sha256(sourceBytes);
    const bytes = await sharp(sourceBytes, { limitInputPixels: 100_000_000 })
      .rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toBuffer();
    const digest = sha256(bytes);
    const role = typeof input === 'object' && typeof input.role === 'string'
      ? input.role
      : 'VISUAL_EVIDENCE';
    if (deduplicate && seenEvidence.has(digest)) {
      const duplicateIndex = preparedByDigest.get(digest);
      const prepared = preparedEvidence[duplicateIndex];
      if (!prepared.roles.includes(role)) prepared.roles.push(role);
      prepared.source_bindings.push({ role, source_sha256: sourceSha256 });
      const attached = qaImages[duplicateIndex];
      if (!attached.roles.includes(role)) attached.roles.push(role);
      continue;
    }
    seenEvidence.add(digest);
    await writeFile(qaPath, bytes);
    const attached = typeof input === 'object'
      ? { ...input, path: qaPath, role, roles: [role] }
      : { path: qaPath, role, roles: [role] };
    qaImages.push(attached);
    preparedByDigest.set(digest, preparedEvidence.length);
    preparedEvidence.push({
      order: preparedEvidence.length + 1,
      role,
      roles: [role],
      source_bindings: [{ role, source_sha256: sourceSha256 }],
      prepared_sha256: digest,
    });
  }
  return { qaImages, preparedEvidence };
}

export class CodexVlmEvaluator {
  constructor({ binary = 'codex', model = 'gpt-5.6-terra', commandRunner = defaultCommandRunner, timeoutMs = 60_000,
    qaSchemaPath = path.resolve(import.meta.dirname, '..', '..', 'schemas', 'codex-vlm-qa.schema.json'),
    passportSchemaPath = path.resolve(import.meta.dirname, '..', '..', 'schemas', 'garment-passport.schema.json') } = {}) {
    this.binary = binary;
    if (typeof model !== 'string' || model.trim() === '' || AMBIGUOUS_VERSIONS.test(model.trim())) {
      throw new TypeError('Codex VLM model must be an exact non-ambiguous version');
    }
    this.model = model;
    this.commandRunner = commandRunner;
    this.timeoutMs = timeoutMs;
    this.qaSchemaPath = qaSchemaPath;
    this.passportSchemaPath = passportSchemaPath;
  }

  async #run({ images, promptBuilder, schemaPath, deduplicate = true }) {
    if (!Array.isArray(images) || images.length === 0) throw new Error('Codex VLM requires at least one image');
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-codex-vlm-'));
    const outputPath = path.join(temporaryRoot, 'result.json');
    try {
      // Normalize oversized camera photos before transport. Visual QA needs the
      // visible evidence, not 16–50 MP originals; bounded inputs keep latency
      // deterministic while preserving enough detail for labels and seams.
      const { qaImages, preparedEvidence } = await prepareTransportEvidence({
        images,
        temporaryRoot,
        deduplicate,
      });
      const prompt = sanitizeExternalPrompt(promptBuilder(qaImages));
      assertExternalPromptPrivacy(prompt, { runtimeRoot: temporaryRoot });
      // `--image` accepts one or more values. Place the positional prompt first so
      // the CLI cannot consume it as another image path and wait indefinitely.
      const args = ['exec', prompt, '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--sandbox', 'read-only', '--model', this.model, '--config', 'model_reasoning_effort="low"', '--output-schema', schemaPath, '--output-last-message', outputPath];
      for (const input of qaImages) args.push('--image', imagePath(input) ?? input);
      const result = await this.commandRunner(this.binary, args, { timeoutMs: this.timeoutMs });
      if ((result?.exitCode ?? 0) !== 0) throw new Error('Codex VLM process exited unsuccessfully');
      let raw;
      try { raw = await readFile(outputPath, 'utf8'); } catch { raw = result?.stdout; }
      if (typeof raw !== 'string' || raw.trim() === '') throw new Error('Codex VLM returned no result');
      return { value: JSON.parse(raw), preparedEvidence };
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async evaluateQa(context) {
    const images = collectQaImages(context?.evidence, context?.phase);
    try {
      const result = await this.#run({
        images,
        promptBuilder: (prepared) => qaPrompt(context?.phase, prepared, context?.evidence),
        schemaPath: this.qaSchemaPath,
      });
      return evaluatorResult(validateQa(result.value), {
        model: this.model,
        context,
        preparedEvidence: result.preparedEvidence,
      });
    } catch (error) {
      // A garment QA infrastructure failure says nothing about source-photo
      // sufficiency. Route it to the next bounded image-model attempt instead
      // of asking the user for new evidence.
      const decision = context?.phase === 'garment' ? 'RETRY' : 'NEEDS_INPUT';
      return evaluatorResult({
        decision,
        reason: `automatic_semantic_qa_unavailable: ${error.message}`,
        checks: [{
          name: 'AUTOMATIC_SEMANTIC_QA',
          pass: false,
          score: 0,
          evidence: error.message,
        }],
        defects: ['Automatic semantic QA did not return valid evidence'],
      }, { model: this.model, context });
    }
  }

  async inspectGarments(images) {
    if (!Array.isArray(images) || images.length < 1 || images.length > 5) throw new Error('Для аналізу потрібно від одного до п’яти фото речей');
    const result = await this.#run({
      images,
      promptBuilder: garmentPrompt,
      schemaPath: this.passportSchemaPath,
      deduplicate: false,
    });
    return validatePassport(result.value, images.length);
  }
}

export function createCodexQaEvaluator(options) {
  const evaluator = new CodexVlmEvaluator(options);
  return evaluator.evaluateQa.bind(evaluator);
}
