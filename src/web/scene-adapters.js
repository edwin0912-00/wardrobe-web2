import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import {
  assertExternalPromptPrivacy,
  sanitizeExternalPrompt,
} from '../providers/provider-prompt-privacy.js';
import {
  IMAGE_MODEL_NAMES,
  IMAGE_MODEL_ROUTE,
  assertAllowedImageModel,
} from '../runner/model-policy.js';
import {
  SCENE_EVALUATOR_GATES,
  SCENE_REFERENCE_ROLES,
  SCENE_SHOT_ANCHOR_ROLES,
  sceneQaItemScope,
  sha256,
} from './scene-contract.js';
import {
  approvedItemFactsSha256,
  compileApprovedItemFacts,
} from './approved-item-evidence.js';

const GENERATION_REFERENCE_ORDER = Object.freeze([
  'environment_anchor',
  'lighting_anchor',
  'composition_anchor',
  'palette_anchor',
  'negative_reference',
]);
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const STRUCTURED_REFERENCE_SCHEMA_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'schemas',
  'scene-structured-reference.schema.json',
);
export const ITEM_FIDELITY_SCHEMA_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'schemas',
  'scene-item-fidelity-output.schema.json',
);
const structuredReferenceSchema = JSON.parse(readFileSync(STRUCTURED_REFERENCE_SCHEMA_PATH, 'utf8'));
const validateStructuredReference = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
}).compile(structuredReferenceSchema);
const itemFidelitySchema = JSON.parse(readFileSync(ITEM_FIDELITY_SCHEMA_PATH, 'utf8'));
export const validateItemFidelityOutput = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
}).compile(itemFidelitySchema);
const STRUCTURED_REFERENCE_ROLES = new Set(SCENE_REFERENCE_ROLES);
const SAFE_ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SECRET_ASSIGNMENT = /\b(api[_ -]?key|access[_ -]?token|token|password|secret)\s*[:=]\s*[^\s,;]+/gi;
const SECRET_TOKEN = /\b(?:sk|hf|ghp|glpat|ek_live|AIza)[-_A-Za-z0-9]{8,}\b/g;
const URL = /\bhttps?:\/\/[^\s,;]+/gi;

export function stableRequestId(parts) {
  return createHash('sha256').update(parts.join(':')).digest('hex');
}

function reducedAspectRatio(width, height) {
  let left = width;
  let right = height;
  while (right !== 0) [left, right] = [right, left % right];
  return `${width / left}:${height / left}`;
}

function assertSha(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256`);
  }
}

export async function verifiedImageBinding(binding, expectedRole, label) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    throw new Error(`${label} must be an image binding`);
  }
  if (binding.role !== expectedRole) throw new Error(`${label} must have role ${expectedRole}`);
  if (!IMAGE_MEDIA_TYPES.has(binding.media_type)) {
    throw new Error(`${label} must be an image reference; JSON role assets cannot be sent to image generation`);
  }
  if (typeof binding.path !== 'string' || binding.path.trim() === '') throw new Error(`${label}.path is required`);
  assertSha(binding.sha256, `${label}.sha256`);
  const filename = path.resolve(binding.path);
  const bytes = await readFile(filename);
  if (sha256(bytes) !== binding.sha256) throw new Error(`${label} bytes do not match the bound SHA-256`);
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
    throw new Error(`${label} must be one decodable image`);
  }
  return { ...binding, path: filename };
}

function sanitizeStructuredFact(value) {
  return sanitizeExternalPrompt(String(value ?? ''))
    .replace(SECRET_ASSIGNMENT, '$1=REDACTED')
    .replace(SECRET_TOKEN, 'REDACTED')
    .replace(URL, 'EXTERNAL_REFERENCE')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

export function boundedEvaluationText(value, maxLength) {
  return sanitizeExternalPrompt(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function compileStructuredReference(document) {
  if (document.role === 'environment_anchor') {
    return [
      `description=${sanitizeStructuredFact(document.facts.description)}`,
      `spatial_cues=${document.facts.spatial_cues.map(sanitizeStructuredFact).join(' | ')}`,
      `materials=${document.facts.materials.map(sanitizeStructuredFact).join(' | ')}`,
      `originality_rules=${document.facts.originality_rules.map(sanitizeStructuredFact).join(' | ')}`,
    ].join('; ');
  }
  if (document.role === 'lighting_anchor') {
    return [
      `time_or_setup=${sanitizeStructuredFact(document.facts.time_or_setup)}`,
      `key=${sanitizeStructuredFact(document.facts.key)}`,
      `fill=${sanitizeStructuredFact(document.facts.fill)}`,
      `finish=${sanitizeStructuredFact(document.facts.finish)}`,
      `protected_regions=${document.facts.protected_regions.map(sanitizeStructuredFact).join(' | ')}`,
    ].join('; ');
  }
  if (document.role === 'composition_anchor') {
    return [
      `aspect_ratio=${document.facts.aspect_ratio}`,
      `lens_mm=${document.facts.lens_mm}`,
      `camera_height=${document.facts.camera_height}`,
      `subject_height_percent=${document.facts.subject_height_percent.join('–')}`,
      `minimum_clear_space_percent=above_hair:${document.facts.minimum_clear_space_percent.above_hair},below_footwear:${document.facts.minimum_clear_space_percent.below_footwear}`,
      `max_vertical_error_deg=${document.facts.max_vertical_error_deg}`,
      `notes=${document.facts.notes.map(sanitizeStructuredFact).join(' | ')}`,
    ].join('; ');
  }
  if (document.role === 'palette_anchor') {
    return [
      `colors=${document.facts.colors.map(sanitizeStructuredFact).join(' | ')}`,
      `contrast=${document.facts.contrast}`,
      `materials=${document.facts.materials.map(sanitizeStructuredFact).join(' | ') || 'none declared'}`,
      `notes=${document.facts.notes.map(sanitizeStructuredFact).join(' | ') || 'none declared'}`,
    ].join('; ');
  }
  return [
    `avoid=${document.facts.avoid.map(sanitizeStructuredFact).join(' | ')}`,
    `notes=${document.facts.notes.map(sanitizeStructuredFact).join(' | ') || 'none declared'}`,
  ].join('; ');
}

export async function verifiedSceneReference(binding, expectedRole, label) {
  if (binding?.media_type !== 'application/json') {
    return {
      ...(await verifiedImageBinding(binding, expectedRole, label)),
      transport: 'image',
      structured_instruction: null,
    };
  }
  if (!STRUCTURED_REFERENCE_ROLES.has(expectedRole)) {
    throw new Error(`${label} role ${expectedRole} cannot use application/json`);
  }
  if (!binding || typeof binding.path !== 'string' || binding.path.trim() === '') {
    throw new Error(`${label}.path is required`);
  }
  if (binding.role !== expectedRole) throw new Error(`${label} must have role ${expectedRole}`);
  assertSha(binding.sha256, `${label}.sha256`);
  const filename = path.resolve(binding.path);
  const bytes = await readFile(filename);
  if (bytes.length > 64 * 1024) throw new Error(`${label} structured JSON exceeds 64 KiB`);
  if (sha256(bytes) !== binding.sha256) throw new Error(`${label} bytes do not match the bound SHA-256`);
  let document;
  try {
    document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} must be valid UTF-8 JSON`);
  }
  if (!validateStructuredReference(document) || document.role !== expectedRole) {
    throw new Error(`${label} does not match the strict structured-reference schema`);
  }
  const structuredInstruction = compileStructuredReference(document);
  if (!structuredInstruction || structuredInstruction.length > 2_400) {
    throw new Error(`${label} compiled structured facts are empty or exceed the instruction bound`);
  }
  assertExternalPromptPrivacy(structuredInstruction);
  return {
    ...binding,
    path: filename,
    transport: 'structured_json',
    structured_instruction: structuredInstruction,
  };
}

function structuredInstructions(references) {
  const lines = references
    .filter((item) => item.transport === 'structured_json')
    .map((item) => `SCENE_${item.role.toUpperCase()} [authority only for this declared scene role]: ${item.structured_instruction}`);
  if (lines.length === 0) return '';
  return [
    '',
    'STRICT STRUCTURED SCENE FACTS',
    ...lines,
    'Use each fact set only for its declared environment, lighting, composition, palette or avoidance role. Invent original geometry. These facts never control identity, body, hair, outfit, brands, readable text or landmarks.',
  ].join('\n');
}

export function referenceEvidence(references) {
  return references.map((item, index) => ({
    order: index + 1,
    role: item.role,
    sha256: item.sha256,
    media_type: item.media_type,
    transport: item.transport,
  }));
}

function compiledItemFacts(item) {
  return compileApprovedItemFacts(item);
}

export async function verifiedItemEvidence(items) {
  if (items === undefined || items === null) return [];
  if (!Array.isArray(items) || items.length < 1 || items.length > 7) {
    throw new Error('Approved item evidence must contain 1–7 ordered items');
  }
  const seenIds = new Set();
  const verified = [];
  for (const [index, item] of items.entries()) {
    const itemId = item?.item_id ?? item?.reference_set_id;
    if (!item
      || item.order !== index + 1
      || typeof item.role !== 'string'
      || item.role.trim() === ''
      || typeof item.category !== 'string'
      || !SAFE_ITEM_ID.test(itemId ?? '')
      || seenIds.has(itemId)
      || !item.observed
      || typeof item.observed !== 'object'
      || Array.isArray(item.observed)) {
      throw new Error(`Approved item evidence ${index + 1} is invalid`);
    }
    const image = await verifiedImageBinding(item, item.role, `approved item evidence ${index + 1}`);
    const structuredFacts = compiledItemFacts(item);
    if (!structuredFacts || structuredFacts.length > 2_400) {
      throw new Error(`Approved item evidence ${index + 1} facts are invalid`);
    }
    assertExternalPromptPrivacy(structuredFacts);
    seenIds.add(itemId);
    verified.push({
      ...image,
      item_id: itemId,
      category: item.category,
      structured_facts: structuredFacts,
    });
  }
  return verified;
}

function itemGenerationInstructions(items, attachmentStart) {
  if (items.length === 0) return '';
  return [
    '',
    'APPROVED ITEM EVIDENCE — EXACT PRODUCT AUTHORITY',
    ...items.map((item, index) => (
      `ATTACHMENT_${attachmentStart + index} [APPROVED_ITEM_${item.item_id.toUpperCase()}]: ${item.structured_facts}`
    )),
    'Every item attachment above is exact authority for that product. Preserve its silhouette, color, material, construction, pattern, emblem/logo, readable text and distinctive hardware. Do not substitute a visually similar product.',
  ].join('\n');
}

export async function verifiedShotAnchors(anchors) {
  if (anchors === undefined || anchors === null) return [];
  if (!Array.isArray(anchors) || anchors.length > SCENE_SHOT_ANCHOR_ROLES.length) {
    throw new Error(`Scene shot anchors must contain at most ${SCENE_SHOT_ANCHOR_ROLES.length} ordered anchors`);
  }
  const expectedRoles = SCENE_SHOT_ANCHOR_ROLES.filter(
    (role) => anchors.some((anchor) => anchor?.role === role),
  );
  const verified = [];
  for (const [index, anchor] of anchors.entries()) {
    if (anchor?.order !== index + 1 || anchor.role !== expectedRoles[index]) {
      throw new Error(`Scene shot anchor ${index + 1} is not in canonical anchor order`);
    }
    const image = await verifiedImageBinding(anchor, anchor.role, `shot anchor ${anchor.role}`);
    if (image.media_type !== 'image/png') {
      throw new Error(`Scene shot anchor ${anchor.role} must be one PNG`);
    }
    verified.push({ ...image, order: anchor.order });
  }
  return verified;
}

const SHOT_ANCHOR_INSTRUCTION = Object.freeze({
  blocking_topdown: 'a schematic blocking diagram for this fixed shot slot, and authority only for where the '
    + 'subject stands: camera height, lens compression, body rotation, subject scale in frame and clear space '
    + 'above the hair. Reproduce the geometry it specifies and none of its appearance — it is a pencil drawing '
    + 'of a jointed wooden mannequin on paper, and the drawing style, paper, lettering, arrows, plan box and '
    + 'mannequin must not appear in the photograph. It contains no environment, no light and no person.',
  hero_continuity_anchor: 'the already approved hero frame of this same shoot, and authority only for place, '
    + 'environment geometry, light direction and quality, and colour grade: this shot happens in the same '
    + 'location minutes later and must read as the same place. Do not reproduce it — the camera, crop and pose '
    + 'are set by this shot\'s own direction, not by that frame.',
});

function shotAnchorInstructions(anchors) {
  if (anchors.length === 0) return '';
  return [
    '',
    'SHOT ANCHOR REFERENCES — ROLE-SCOPED',
    ...anchors.map((anchor) => (
      `ATTACHMENT_${anchor.order} [${anchor.role.toUpperCase()}]: ${SHOT_ANCHOR_INSTRUCTION[anchor.role]}`
    )),
    'The approved look master alone controls identity, body, hair, outfit, product details, logos and garment text. No anchor above has any authority over them.',
  ].join('\n');
}

export async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return results;
}

function assertSceneRoute(context) {
  const jobSetType = assertAllowedImageModel(context?.job_set_type);
  const routeIndex = IMAGE_MODEL_ROUTE.indexOf(jobSetType);
  const routeAttempt = Number(context?.cycle_attempt ?? context?.attempt);
  if (routeIndex !== routeAttempt - 1) {
    throw new Error('Scene attempt does not match the fixed GPT Image 2 → Nano Banana 2 → Nano Banana Pro route');
  }
  if (context.model !== IMAGE_MODEL_NAMES[jobSetType] || context.model_version !== jobSetType || context.quality !== 'high') {
    throw new Error('Scene model metadata does not match the locked production route');
  }
  if (context.aspect_ratio !== '4:5' || context.width * 5 !== context.height * 4) {
    throw new Error('Scene delivery must be exact 4:5');
  }
  return jobSetType;
}

// A delivery never fakes its own size. The previous code padded any off-aspect
// frame onto a blurred stretched copy of itself, which is how four approved
// editorial frames each shipped a 128px band of blur above and below a 1024×1024
// core: the file measured 1024×1280 and passed every dimension check while a
// fifth of it was smeared filler. That is a defect, not a fallback, so it is
// gone. Only two things may reach delivery — the provider's own pixels rescaled,
// or a centre crop small enough that the composition survives it. Anything
// further off is a generation failure and says so, which the fixed model route
// can actually act on by retrying; silently padding it could not be acted on by
// anyone. Requesting the aspect up front (see the provider's image_config) is
// what keeps this path on the cheap branches.
const MAX_GEOMETRY_CROP_FRACTION = 0.22;

async function geometrySafeImage(bytes, { width, height }) {
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
    throw new Error('Scene provider returned an undecodable or animated image');
  }
  const exactAspect = metadata.width * height === metadata.height * width;
  if (exactAspect && metadata.width === width && metadata.height === height) {
    return {
      image: bytes,
      strategy: 'provider_exact_4_5',
      source_width: metadata.width,
      source_height: metadata.height,
    };
  }

  const rescaleOnly = async (source, strategy, extra = {}) => ({
    image: await source
      .resize({ width, height, fit: 'fill', kernel: 'lanczos3' })
      .toColourspace('srgb')
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer(),
    strategy,
    source_width: metadata.width,
    source_height: metadata.height,
    ...extra,
  });

  // Right shape, wrong size: the providers' 4:5 buckets are 896×1120 and
  // 928×1152, never the canonical canvas. Pure rescale — no pixel is discarded
  // and none is invented.
  if (exactAspect) {
    return rescaleOnly(sharp(bytes), 'provider_exact_4_5_rescaled');
  }

  const targetAspect = width / height;
  const tooWide = metadata.width / metadata.height > targetAspect;
  const cropWidth = tooWide ? Math.round(metadata.height * targetAspect) : metadata.width;
  const cropHeight = tooWide ? metadata.height : Math.round(metadata.width / targetAspect);
  const cropFraction = tooWide
    ? (metadata.width - cropWidth) / metadata.width
    : (metadata.height - cropHeight) / metadata.height;

  if (cropFraction > MAX_GEOMETRY_CROP_FRACTION) {
    throw new Error(
      `Scene provider returned ${metadata.width}×${metadata.height}, which cannot reach the 4:5 delivery `
      + `without discarding ${Math.round(cropFraction * 100)}% of the frame`,
    );
  }

  // The crop is not a silent trade: FRAMING_AND_ANATOMY judges the delivered
  // frame, so a crop that clips a hand or a foot fails loudly rather than ships.
  return rescaleOnly(
    sharp(bytes).extract({
      left: Math.round((metadata.width - cropWidth) / 2),
      top: Math.round((metadata.height - cropHeight) / 2),
      width: cropWidth,
      height: cropHeight,
    }),
    'centre_crop_to_exact_4_5',
    { crop_fraction: Number(cropFraction.toFixed(4)) },
  );
}

export class SceneGeneratorAdapter {
  constructor({ provider, providers } = {}) {
    if (provider !== undefined && typeof provider?.generate !== 'function') {
      throw new Error('SceneGeneratorAdapter provider.generate is required');
    }
    if (providers !== undefined && (!providers || typeof providers !== 'object' || Array.isArray(providers))) {
      throw new Error('SceneGeneratorAdapter providers must be a model-keyed object');
    }
    if (!provider && !providers) throw new Error('SceneGeneratorAdapter requires provider or providers');
    this.provider = provider;
    this.providers = providers;
  }

  async generateScene(context) {
    const jobSetType = assertSceneRoute(context);
    const provider = this.providers?.[jobSetType] ?? this.provider;
    if (typeof provider?.generate !== 'function') {
      throw new Error(`SceneGeneratorAdapter has no provider for ${jobSetType}`);
    }
    // What the transport can actually hand over, which is a property of the
    // transport and not of the model name. The Higgsfield CLI could only serve
    // gpt-image at 3:4; the OpenRouter transport serves it at a true 4:5 when
    // asked, so it declares that and the delivery needs no crop at all.
    const requiredTransportAspectRatio = typeof provider.transportAspectRatio === 'string'
      ? provider.transportAspectRatio
      : (jobSetType === 'gpt_image_2' ? '3:4' : '4:5');
    if (typeof provider.aspectRatio === 'string' && provider.aspectRatio !== requiredTransportAspectRatio) {
      throw new Error(`${context.model} provider must be configured with aspectRatio: ${requiredTransportAspectRatio}`);
    }
    const basePrompt = String(context.prompt ?? '');
    assertExternalPromptPrivacy(basePrompt, { runtimeRoot: context.work_directory });
    if (sha256(Buffer.from(basePrompt)) !== context.prompt_sha256) {
      throw new Error('Sanitized scene prompt no longer matches its immutable prompt SHA-256');
    }

    const approved = await verifiedImageBinding(
      context.approved_look,
      'look_master',
      'approved_look',
    );
    const repairCandidate = context.repair_candidate
      ? await verifiedImageBinding(
        context.repair_candidate,
        'failed_candidate',
        'repair_candidate',
      )
      : null;
    if (
      repairCandidate
      && (
        !Number.isInteger(repairCandidate.attempt)
        || repairCandidate.attempt < 1
        || repairCandidate.attempt >= Number(context.attempt)
      )
    ) {
      throw new Error('repair_candidate.attempt must identify an earlier scene attempt');
    }
    const items = await verifiedItemEvidence(context.item_evidence);
    if (!Array.isArray(context.references) || context.references.length !== GENERATION_REFERENCE_ORDER.length) {
      throw new Error('Scene generation requires exactly five role references');
    }
    const byRole = new Map(context.references.map((item) => [item.role, item]));
    if (byRole.size !== GENERATION_REFERENCE_ORDER.length) throw new Error('Scene generation reference roles must be unique');
    const references = [];
    for (const [index, role] of GENERATION_REFERENCE_ORDER.entries()) {
      references.push(await verifiedSceneReference(byRole.get(role), role, `references[${index}]`));
    }
    const anchors = await verifiedShotAnchors(context.shot_anchors);
    const maxAttachments = Number.isInteger(provider.maxOrderedReferences)
      ? provider.maxOrderedReferences
      : 8;
    // Everything the request is contractually obliged to carry: the look master is
    // the sole identity and product authority, the failed candidate is the only
    // thing a repair attempt is repairing, and each cutout is the exact evidence
    // ITEM_FIDELITY compares against forensically. None of these may be traded for
    // conditioning, so they claim the budget before anything else is considered.
    const required = [
      {
        scope: 'avatar',
        role: 'APPROVED_LOOK_MASTER',
        path: approved.path,
        sha256: approved.sha256,
        mediaType: approved.media_type,
        source: 'APPROVED_AVATAR',
      },
      ...(repairCandidate ? [{
        scope: 'scene',
        role: 'FAILED_SCENE_CANDIDATE',
        path: repairCandidate.path,
        sha256: repairCandidate.sha256,
        mediaType: repairCandidate.media_type,
        source: 'REPAIR_CANDIDATE',
      }] : []),
      ...items.map((item) => ({
        scope: 'outfit',
        role: `ITEM_${item.category.toUpperCase()}`,
        path: item.path,
        sha256: item.sha256,
        mediaType: item.media_type,
        source: 'CONDITIONED',
      })),
    ];
    if (required.length > maxAttachments) {
      throw new Error('Approved item evidence exceeds the provider attachment limit');
    }
    // The discretionary tail, most valuable first. Anchors outrank the image-transport
    // scene roles because a role that loses its image still reaches the model as its
    // compiled structured facts, while an anchor dropped here reaches it as nothing.
    const discretionary = [
      ...anchors.map((anchor) => ({
        // 'outfit' is the transport's bucket for every conditioning image, the same one
        // the image scene roles use. The 'scene' scope reads closer but is reserved:
        // the provider refuses a scene-scoped binding that is not the repair candidate.
        scope: 'outfit',
        role: `SHOT_${anchor.role.toUpperCase()}`,
        anchor,
        path: anchor.path,
        sha256: anchor.sha256,
        mediaType: anchor.media_type,
        source: 'CONDITIONED',
      })),
      ...references
        .filter((item) => item.transport === 'image')
        .map((item) => ({
          scope: 'outfit',
          role: `SCENE_${item.role.toUpperCase()}`,
          path: item.path,
          sha256: item.sha256,
          mediaType: item.media_type,
          source: 'CONDITIONED',
        })),
    ];
    const attachedDiscretionary = discretionary.slice(0, maxAttachments - required.length);
    // The truncation used to be one silent .slice(): a request that quietly sent
    // five of seven attachments produced a receipt that read exactly like full
    // coverage, so a frame missing its conditioning was indistinguishable from a
    // frame that ignored it. Naming the casualties is the whole point.
    const droppedAttachmentRoles = discretionary
      .slice(attachedDiscretionary.length)
      .map((item) => item.role);
    const ordered = [...required, ...attachedDiscretionary];
    // Higgsfield requires contiguous media positions. Structured JSON roles
    // remain in the five-role evidence receipt and prompt, never as --image.
    ordered.forEach((item, index) => { item.order = index + 1; });
    const attachedAnchors = attachedDiscretionary
      .filter((item) => item.anchor)
      .map((item) => ({ ...item.anchor, order: item.order }));
    const prompt = sanitizeExternalPrompt(
      `${basePrompt}${structuredInstructions(references)}`
      + `${itemGenerationInstructions(items, repairCandidate ? 3 : 2)}`
      + `${shotAnchorInstructions(attachedAnchors)}`,
    );
    assertExternalPromptPrivacy(prompt, { runtimeRoot: context.work_directory });
    const providerResult = await provider.generate({
      operation: 'generate',
      phase: 'scene',
      attempt: context.attempt,
      cycle_attempt: context.cycle_attempt ?? context.attempt,
      model: jobSetType,
      model_name: IMAGE_MODEL_NAMES[jobSetType],
      job_set_type: jobSetType,
      prompt,
      aspectRatio: requiredTransportAspectRatio,
      references: { ordered },
      idempotencyKey: context.idempotency_key,
      jobId: context.scene_id,
      workDirectory: context.work_directory,
    });
    const raw = Buffer.isBuffer(providerResult?.image)
      ? providerResult.image
      : providerResult?.image instanceof Uint8Array
        ? Buffer.from(providerResult.image)
        : null;
    if (!raw || raw.length < PNG_SIGNATURE.length || !raw.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error('Scene provider must return PNG bytes');
    }
    const geometry = await geometrySafeImage(raw, context);
    const providerMetadata = providerResult.metadata ?? {};
    const providerJobId = providerMetadata.job_id ?? providerMetadata.provider_request_id;
    const requestId = context.idempotency_key;
    const evidence = referenceEvidence(references);
    return {
      image: geometry.image,
      media_type: 'image/png',
      metadata: {
        provider: String(providerMetadata.provider ?? 'higgsfield'),
        provider_request_id: String(providerJobId ?? requestId),
        request_id: requestId,
        job_id: String(providerJobId ?? requestId),
        model: context.model,
        model_version: context.model_version,
        job_set_type: jobSetType,
        quality: context.quality,
        source_width: geometry.source_width,
        source_height: geometry.source_height,
        source_aspect_ratio: reducedAspectRatio(geometry.source_width, geometry.source_height),
        raw_output_sha256: sha256(raw),
        geometry_output_sha256: sha256(geometry.image),
        transport_aspect_ratio: requiredTransportAspectRatio,
        geometry_strategy: geometry.strategy,
        // How much of the provider frame the delivery cost. Recorded because the
        // strategy name alone hid the scale of what geometry did to the image.
        ...(geometry.crop_fraction === undefined ? {} : { geometry_crop_fraction: geometry.crop_fraction }),
        reference_role_order: evidence.map((item) => item.role).join(':'),
        reference_evidence_sha256: sha256(Buffer.from(JSON.stringify(evidence))),
        attached_reference_count: ordered.length,
        structured_reference_count: evidence.filter((item) => item.transport === 'structured_json').length,
        ...(attachedAnchors.length > 0 ? {
          shot_anchor_role_order: attachedAnchors.map((anchor) => anchor.role).join(':'),
        } : {}),
        ...(droppedAttachmentRoles.length > 0 ? {
          dropped_attachment_roles: droppedAttachmentRoles.join(':'),
          dropped_attachment_count: droppedAttachmentRoles.length,
        } : {}),
        outbound_prompt_sha256: sha256(Buffer.from(prompt)),
        ...(repairCandidate ? {
          repair_candidate_sha256: repairCandidate.sha256,
          repair_from_attempt: repairCandidate.attempt,
        } : {}),
        reference_evidence: evidence,
      },
    };
  }
}

async function defaultCommandRunner(binary, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, {
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve({ stdout, stderr, exitCode: 0 });
    });
    child.stdin?.end();
  });
}

export class SceneEvaluationInfrastructureError extends Error {
  constructor(message, { code = 'SCENE_EVALUATOR_INFRASTRUCTURE_FAILED', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SceneEvaluationInfrastructureError';
    this.code = code;
    this.infrastructure = true;
    this.retryable = true;
  }
}

export function evaluatorPrompt(delivery, references, preset = null, qaItems = []) {
  const camera = preset?.camera ?? {};
  const editorial = preset?.editorial ?? null;
  const framing = camera.framing ?? 'full_body';
  const requireFullHead = camera.required_visibility?.full_head ?? true;
  const requireFullFootwear = camera.required_visibility?.full_footwear ?? true;
  const imageReferences = references.filter((item) => item.transport === 'image');
  const detailAttachmentStart = imageReferences.length + 3;
  const attachments = [
    'ATTACHMENT_1 [GENERATED_SCENE_CANDIDATE]',
    'ATTACHMENT_2 [APPROVED_LOOK_MASTER]',
    ...imageReferences.map((item, index) => `ATTACHMENT_${index + 3} [SCENE_${item.role.toUpperCase()}]`),
    `ATTACHMENT_${detailAttachmentStart} [CANDIDATE_UPPER_ITEM_DETAIL]`,
    `ATTACHMENT_${detailAttachmentStart + 1} [APPROVED_LOOK_UPPER_ITEM_DETAIL]`,
    `ATTACHMENT_${detailAttachmentStart + 2} [CANDIDATE_LOWER_ITEM_DETAIL]`,
    `ATTACHMENT_${detailAttachmentStart + 3} [APPROVED_LOOK_LOWER_ITEM_DETAIL]`,
  ];
  return sanitizeExternalPrompt([
    'Evaluate one production fashion scene using the ordered visual attachments and strict structured scene facts.',
    ...attachments,
    '',
    'Authority: ATTACHMENT_2 alone controls identity, body, hair, outfit, product details, logos and garment text.',
    'The five scene role inputs are authority only for their declared environment, lighting, composition, palette or avoidance role. They are never authority for a person, clothing, brands, readable text, landmarks or exact source architecture.',
    'Return exactly six gates in this exact order: NEAR_COPY_AND_LEAKAGE, IDENTITY, ITEM_FIDELITY, SCENE_MATCH, LIGHT_AND_CONTACT_SHADOW, FRAMING_AND_ANATOMY.',
    'ITEM_FIDELITY is a forensic comparison, not a general style judgment. Compare every visible approved item separately across the full images and paired upper/lower detail attachments.',
    ...(editorial?.item_scope === 'FIRST_ORDERED_ITEM' ? [
      `This intentional detail frame targets only the first ordered approved item${qaItems[0] ? ` (${qaItems[0].item_id})` : ''}. Judge that target exactly; do not fail solely because other approved items are intentionally outside the crop.`,
    ] : editorial?.item_scope === 'EXCLUDE_FOOTWEAR' ? [
      'This intentional three-quarter frame excludes footwear from the forensic item subset. Judge every other approved item expected in the crop; do not fail solely because footwear is outside the crop.',
    ] : editorial ? [
      'This full-body editorial frame requires the complete ordered approved item set.',
    ] : []),
    'For each item compare: item count and type, silhouette, color, material, construction, seams and closures, print/pattern, exact emblem or logo, exact readable text, and distinctive shoe or accessory geometry.',
    'Any substituted emblem, missing monogram, rewritten letter or number, altered stripe/print, changed bag hardware, changed shoe construction, missing item, or invented accessory is ITEM_FIDELITY FAIL.',
    'Never infer that two marks match merely because they resemble the same luxury style. If a required small logo, pattern, text, or construction detail is not visibly verifiable in the candidate, return FAIL with ITEM_DETAIL_NOT_VERIFIABLE.',
    ...(editorial ? [
      // A styled frame routinely needs a garment the approved wardrobe does not
      // contain, most often a lower garment when the look is a top only. The
      // bible instructs the generator to complete it plainly from the mode
      // palette. Verifying such a garment against approval is impossible by
      // definition, and failing the frame for it rejected otherwise perfect
      // editorial images. So it is judged on being unremarkable instead of on
      // matching: plain and unbranded passes, anything that reads as product
      // fails, because that is a real fabrication of branded goods.
      'A garment present in the candidate that the approved look does not contain is a STYLING COMPLETION, not an approved item. Do not require it to match approval and do not report ITEM_DETAIL_NOT_VERIFIABLE for it.',
      'Judge a styling completion only on remaining unbranded and secondary: plain color and construction consistent with the mode palette is acceptable. Any logo, brand mark, slogan, number, graphic print or distinctive signature construction on it makes the ITEM_FIDELITY gate FAIL, with "UNAUTHORIZED_BRANDED_ADDITION" added to that gate\'s defects list.',
      'This introduces no new gate. Return exactly the six named gates in the given order; a styling-completion problem is recorded inside ITEM_FIDELITY, never as a separate gate.',
      'Every item the approved look does contain is still judged forensically and exactly. A styling completion may never replace, obscure or restyle an approved item.',
    ] : []),
    'ITEM_FIDELITY evidence must name every checked visible item and explicitly state whether its logo/text/pattern and construction match.',
    ...(editorial && editorial.identity_visibility !== 'full_face' ? [
      'IDENTITY evaluates all stable identity evidence that is intentionally visible in this crop. Do not fail solely because the approved editorial detail crop omits part of the face; fail any visible identity conflict or unauthorized person change.',
    ] : [
      'IDENTITY requires comparison of stable facial geometry, apparent age, hairline, eyes, nose, mouth, jaw and distinctive marks; expression and scene lighting may change, identity may not.',
    ]),
    // Ground contact cannot be evidence in a frame that ends above the feet. This
    // gate refused 4 of 6 attempts in one editorial retry round with
    // CONTACT_SHADOW_NOT_VISIBLE / CONTACT_SHADOW_NOT_VERIFIABLE — "the frame cuts off
    // the subject before the feet/contact points, so a subject-to-ground contact
    // shadow cannot be visibly verified" — two of them alongside a
    // FRAMING_AND_ANATOMY PASS and nothing else wrong. It is the same invented lock
    // the nominal crop below used to carry: the preset itself declares full
    // footwear=false, so whether the contact point is in frame at all is art
    // direction, and a retry can only answer the demand by abandoning the crop the
    // slot asked for. It was not catching
    // anything either — the same gate passed 6 of 6 attempts before that round and
    // both final frames after it — so it spent retry budget rather than blocking a
    // composite. Everything observable about the light is still judged, and a contact
    // point that IS inside the crop still owes its shadow. Standard scenes keep the
    // full demand, because there the subject stands on the ground in frame and the
    // contact shadow is the difference between a composite and a photograph.
    ...(editorial && !requireFullFootwear ? [
      'LIGHT_AND_CONTACT_SHADOW judges key direction, light quality, subject-to-environment coherence, and whether every shadow this crop does show is plausible for that light.',
      'This crop is not required to reach the subject-to-ground contact points, so where it ends above them ground contact is not observable at all: do not FAIL for that and do not report CONTACT_SHADOW_NOT_VISIBLE or CONTACT_SHADOW_NOT_VERIFIABLE. Any contact point between the subject and a surface that IS inside this crop still requires its own contact shadow, and a missing, floating or wrongly directed one is FAIL.',
    ] : [
      'LIGHT_AND_CONTACT_SHADOW requires a visible subject-to-ground contact shadow consistent with the key light. A subject standing in frame without one is a composite rather than a photograph and is FAIL.',
    ]),
    `For framing_evidence, measure the visible subject or intentional ${framing.replaceAll('_', ' ')} crop bounding box [x,y,width,height] in pixels on the ${delivery.width}x${delivery.height} candidate canvas.`,
    `Set full_head_visible and full_footwear_visible from observation. This shot requires full head=${requireFullHead} and full footwear=${requireFullFootwear}; an intentional omission is not itself a defect when the requirement is false.`,
    // The named crop is art direction, not a measurement, and the requirement
    // booleans above are the whole of what framing is allowed to fail on. Only
    // the omission half of that was ever stated, so a frame that showed MORE
    // than its nominal crop got failed for it: an editorial hero measured at 84%
    // subject height, inside its own [70,88] lock, was rejected as "a full-body
    // frame with both complete shoes visible" while the deterministic assessment
    // recorded no defect at all. Both directions have to be said, or the model
    // keeps inventing a lock the contract does not have.
    `The nominal crop for this shot is ${framing.replaceAll('_', ' ')}. Showing more of the body than that name suggests is not a framing defect when the requirements above are met — footwear visible while full footwear=false is acceptable art direction, not a fault. Judge FRAMING_AND_ANATOMY on anatomical coherence and on those stated requirements only; the numeric subject-height and clear-space locks are assessed outside this call and are not yours to enforce.`,
    'PASS only from visible evidence. A visual defect is FAIL; do not convert it into an infrastructure result.',
    'Return only schema-valid JSON.',
    structuredInstructions(references),
  ].join('\n'));
}

export function validateEvaluatorPayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.gates) || payload.gates.length !== SCENE_EVALUATOR_GATES.length) {
    throw new Error('Evaluator returned an invalid gate collection');
  }
  for (const [index, id] of SCENE_EVALUATOR_GATES.entries()) {
    const gate = payload.gates[index];
    if (gate?.id !== id || !['PASS', 'FAIL'].includes(gate.decision)
      || typeof gate.evidence !== 'string' || !Array.isArray(gate.defects)) {
      throw new Error(`Evaluator returned an invalid ${id} gate`);
    }
  }
  if (!Number.isFinite(payload.score) || payload.score < 0 || payload.score > 100
    || typeof payload.summary !== 'string' || payload.summary.trim() === '') {
    throw new Error('Evaluator returned invalid score or summary');
  }
  const framing = payload.framing_evidence;
  if (!framing || !Array.isArray(framing.subject_bbox_xywh_px)
    || framing.subject_bbox_xywh_px.length !== 4
    || framing.subject_bbox_xywh_px.some((value) => !Number.isInteger(value))
    || typeof framing.full_head_visible !== 'boolean'
    || typeof framing.full_footwear_visible !== 'boolean') {
    throw new Error('Evaluator returned invalid numeric framing evidence');
  }
  return payload;
}

export function itemDetailZone(category, height) {
  const upper = new Set(['top', 'outerwear', 'dress', 'headwear', 'jewelry'])
    .has(String(category).toLowerCase());
  const top = upper ? 0 : Math.floor(height * 0.25);
  return {
    top,
    height: upper ? Math.max(1, Math.ceil(height * 0.75)) : height - top,
  };
}

export function itemFidelityPrompt(item) {
  return sanitizeExternalPrompt([
    'Perform one forensic product-fidelity comparison. This is not category or style matching.',
    'ATTACHMENT_1 [GENERATED_SCENE_ITEM_ZONE] contains the rendered product inside the generated scene.',
    'ATTACHMENT_2 [EXACT_APPROVED_ITEM_REFERENCE] is the sole exact authority for the product.',
    'ATTACHMENT_3 [GENERATED_SCENE_FULL_FRAME] is context only and cannot override attachment 2.',
    `ITEM_ID: ${item.item_id}`,
    `CATEGORY: ${sanitizeStructuredFact(item.category)}`,
    `OBSERVED APPROVED FACTS: ${item.structured_facts}`,
    'Compare item count/type, silhouette, color, material, construction, seams, closures, print/pattern character-by-character, exact emblem/logo/letters/numbers, hardware, and distinctive geometry.',
    'A merely similar product is REVISE. A substituted emblem, genericized monogram, rewritten text, missing construction detail, altered hat trim, or different shoe sole/panel geometry is REVISE.',
    'If the generated product is too small or blurred to verify a required exact detail, return REVISE with ITEM_DETAIL_NOT_VERIFIABLE.',
    'Return only schema-valid JSON. item_id must exactly match ITEM_ID. PASS requires defects=[]. REVISE requires at least one concrete visible defect.',
  ].join('\n'));
}

export class SceneEvaluatorAdapter {
  constructor({
    binary = 'codex',
    model = 'gpt-5.6-terra',
    evaluatorVersion = 'scene-evaluator-v1.1.0',
    commandRunner = defaultCommandRunner,
    itemCommandRunner = commandRunner,
    timeoutMs = 90_000,
    schemaPath = path.resolve(import.meta.dirname, '..', '..', 'schemas', 'scene-evaluator-output.schema.json'),
    itemSchemaPath = ITEM_FIDELITY_SCHEMA_PATH,
    itemConcurrency = 2,
    itemEvaluatorVersion = 'scene-item-fidelity-v1.0.0',
  } = {}) {
    if (typeof commandRunner !== 'function') throw new Error('SceneEvaluatorAdapter commandRunner is required');
    if (typeof itemCommandRunner !== 'function') {
      throw new Error('SceneEvaluatorAdapter itemCommandRunner is required');
    }
    if (!Number.isInteger(itemConcurrency) || itemConcurrency < 1 || itemConcurrency > 4) {
      throw new Error('SceneEvaluatorAdapter itemConcurrency must be an integer from 1 to 4');
    }
    this.binary = binary;
    this.model = model;
    this.evaluatorVersion = evaluatorVersion;
    this.commandRunner = commandRunner;
    this.itemCommandRunner = itemCommandRunner;
    this.timeoutMs = timeoutMs;
    this.schemaPath = schemaPath;
    this.itemSchemaPath = itemSchemaPath;
    this.itemConcurrency = itemConcurrency;
    this.itemEvaluatorVersion = itemEvaluatorVersion;
  }

  async #evaluateItem({
    item,
    candidate,
    temporaryRoot,
    sceneId,
    attempt,
    index,
  }) {
    const candidateMetadata = await sharp(candidate.path).metadata();
    if (!candidateMetadata.width || !candidateMetadata.height) {
      throw new Error('Scene item evaluator candidate is invalid');
    }
    const zone = itemDetailZone(item.category, candidateMetadata.height);
    const detailPath = path.join(temporaryRoot, `item-${String(index + 1).padStart(2, '0')}-candidate-zone.jpg`);
    const referencePath = path.join(temporaryRoot, `item-${String(index + 1).padStart(2, '0')}-approved.jpg`);
    const fullPath = path.join(temporaryRoot, `item-${String(index + 1).padStart(2, '0')}-candidate-full.jpg`);
    await Promise.all([
      sharp(candidate.path)
        .rotate()
        .extract({
          left: 0,
          top: zone.top,
          width: candidateMetadata.width,
          height: zone.height,
        })
        .resize({ width: 2048, height: 2048, fit: 'inside' })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 96, chromaSubsampling: '4:4:4' })
        .toFile(detailPath),
      sharp(item.path)
        .rotate()
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 96, chromaSubsampling: '4:4:4' })
        .toFile(referencePath),
      sharp(candidate.path)
        .rotate()
        .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
        .toFile(fullPath),
    ]);
    const outputPath = path.join(
      temporaryRoot,
      `item-${String(index + 1).padStart(2, '0')}-result.json`,
    );
    const prompt = itemFidelityPrompt(item);
    assertExternalPromptPrivacy(prompt, { runtimeRoot: temporaryRoot });
    const args = [
      'exec',
      prompt,
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--model',
      this.model,
      '--config',
      'model_reasoning_effort="high"',
      '--output-schema',
      this.itemSchemaPath,
      '--output-last-message',
      outputPath,
      '--image',
      detailPath,
      '--image',
      referencePath,
      '--image',
      fullPath,
    ];
    let result;
    try {
      result = await this.itemCommandRunner(this.binary, args, { timeoutMs: this.timeoutMs });
    } catch (error) {
      throw new SceneEvaluationInfrastructureError(
        `Scene item evaluator execution failed for ${item.item_id}: ${error.message}`,
        {
          code: 'SCENE_ITEM_EVALUATOR_EXECUTION_FAILED',
          cause: error,
        },
      );
    }
    if (!result || (result.exitCode ?? 0) !== 0) {
      throw new SceneEvaluationInfrastructureError(
        `Scene item evaluator exited unsuccessfully for ${item.item_id}`,
        { code: 'SCENE_ITEM_EVALUATOR_NONZERO_EXIT' },
      );
    }
    let raw;
    try { raw = await readFile(outputPath, 'utf8'); } catch { raw = result.stdout; }
    let payload;
    try {
      payload = JSON.parse(raw);
      if (!validateItemFidelityOutput(payload)
        || payload.item_id !== item.item_id
        || (payload.verdict === 'PASS' && payload.defects.length !== 0)
        || (payload.verdict === 'REVISE' && payload.defects.length === 0)) {
        throw new Error('item fidelity output failed its strict contract');
      }
    } catch (error) {
      throw new SceneEvaluationInfrastructureError(
        `Scene item evaluator contract failed for ${item.item_id}: ${error.message}`,
        {
          code: 'SCENE_ITEM_EVALUATOR_CONTRACT_FAILED',
          cause: error,
        },
      );
    }
    return {
      ...payload,
      item_sha256: item.sha256,
      item_category: item.category,
      item_facts_sha256: approvedItemFactsSha256(item),
      request_id: stableRequestId([
        this.itemEvaluatorVersion,
        this.model,
        sceneId,
        String(attempt),
        candidate.sha256,
        item.sha256,
        item.item_id,
      ]),
    };
  }

  async evaluateScene(context) {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'scene-evaluator-'));
    try {
      if (!Array.isArray(context.required_gates)
        || context.required_gates.join(':') !== SCENE_EVALUATOR_GATES.join(':')) {
        throw new Error('Scene evaluator required_gates do not match the six-gate contract');
      }
      const bindings = [
        await verifiedImageBinding(
          { ...context.candidate, role: 'candidate', media_type: 'image/png' },
          'candidate',
          'evaluation attachment 1',
        ),
        await verifiedImageBinding(
          { ...context.approved_look, role: 'look_master', media_type: 'image/png' },
          'look_master',
          'evaluation attachment 2',
        ),
      ];
      const byRole = new Map((context.references ?? []).map((item) => [item.role, item]));
      const references = [];
      for (const [index, role] of SCENE_REFERENCE_ROLES.entries()) {
        references.push(await verifiedSceneReference(byRole.get(role), role, `evaluation reference ${index + 1}`));
      }
      const allItems = await verifiedItemEvidence(context.item_evidence);
      let preset = null;
      if (context.preset?.path) {
        try {
          preset = JSON.parse(await readFile(context.preset.path, 'utf8'));
        } catch (error) {
          throw new Error(`Scene evaluator preset is invalid: ${error.message}`);
        }
      }
      const items = sceneQaItemScope(allItems, preset);
      bindings.push(...references.filter((item) => item.transport === 'image'));
      const prepared = [];
      for (const [index, binding] of bindings.entries()) {
        const filename = path.join(temporaryRoot, `attachment-${String(index + 1).padStart(2, '0')}.jpg`);
        await sharp(binding.path)
          .rotate()
          .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
          .toFile(filename);
        prepared.push(filename);
      }
      const detailSources = [
        { binding: bindings[0], zone: 'upper', label: 'candidate-upper' },
        { binding: bindings[1], zone: 'upper', label: 'approved-upper' },
        { binding: bindings[0], zone: 'lower', label: 'candidate-lower' },
        { binding: bindings[1], zone: 'lower', label: 'approved-lower' },
      ];
      for (const [index, detail] of detailSources.entries()) {
        const metadata = await sharp(detail.binding.path).metadata();
        if (!metadata.width || !metadata.height) {
          throw new Error(`Scene evaluator ${detail.label} detail source is invalid`);
        }
        const top = detail.zone === 'upper' ? 0 : Math.floor(metadata.height * 0.3);
        const height = detail.zone === 'upper'
          ? Math.max(1, Math.ceil(metadata.height * 0.7))
          : metadata.height - top;
        const filename = path.join(
          temporaryRoot,
          `attachment-${String(bindings.length + index + 1).padStart(2, '0')}.jpg`,
        );
        await sharp(detail.binding.path)
          .rotate()
          .extract({ left: 0, top, width: metadata.width, height })
          .resize({ width: 2048, height: 2048, fit: 'inside' })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
          .toFile(filename);
        prepared.push(filename);
      }
      const prompt = evaluatorPrompt(context.delivery, references, preset, items);
      assertExternalPromptPrivacy(prompt, { runtimeRoot: temporaryRoot });
      const outputPath = path.join(temporaryRoot, 'result.json');
      const args = [
        'exec',
        prompt,
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--model',
        this.model,
        '--config',
        'model_reasoning_effort="high"',
        '--output-schema',
        this.schemaPath,
        '--output-last-message',
        outputPath,
      ];
      for (const filename of prepared) args.push('--image', filename);
      let result;
      try {
        result = await this.commandRunner(this.binary, args, { timeoutMs: this.timeoutMs });
      } catch (error) {
        throw new SceneEvaluationInfrastructureError(`Scene evaluator execution failed: ${error.message}`, {
          code: 'SCENE_EVALUATOR_EXECUTION_FAILED',
          cause: error,
        });
      }
      if (!result || (result.exitCode ?? 0) !== 0) {
        throw new SceneEvaluationInfrastructureError('Scene evaluator exited unsuccessfully', {
          code: 'SCENE_EVALUATOR_NONZERO_EXIT',
        });
      }
      let raw;
      try { raw = await readFile(outputPath, 'utf8'); } catch { raw = result.stdout; }
      let payload;
      try { payload = validateEvaluatorPayload(JSON.parse(raw)); } catch (error) {
        throw new SceneEvaluationInfrastructureError(`Scene evaluator contract failed: ${error.message}`, {
          code: 'SCENE_EVALUATOR_CONTRACT_FAILED',
          cause: error,
        });
      }
      const itemResults = await mapWithConcurrency(
        items,
        this.itemConcurrency,
        (item, index) => this.#evaluateItem({
          item,
          candidate: bindings[0],
          temporaryRoot,
          sceneId: context.scene_id,
          attempt: context.attempt,
          index,
        }),
      );
      const itemGate = payload.gates.find((gate) => gate.id === 'ITEM_FIDELITY');
      const itemFailures = itemResults.filter((result) => result.verdict === 'REVISE');
      if (itemFailures.length > 0) {
        itemGate.decision = 'FAIL';
        // Which sub-check refused, and in its own words. This was the fixed sentence
        // "Independent forensic item checks rejected set-0." — the only sentence a
        // user or a 2am debugger is ever shown — so three technically correct Nike
        // Air Max Plus candidates were retried away with no recoverable reason at
        // all, while reasons as specific as "the hood lining is rendered patterned
        // where the approved item has a plain dark-green interior" were sitting in
        // item_fidelity_evidence[] on disk the whole time. Only the model's prose and
        // confidence are lifted: item_sha256, item_facts_sha256 and request_id stay
        // behind, because those are exactly the internal ids the outbound sanitiser
        // exists to strip and no reader can act on them. The per-item share of the
        // 1 000-character bound is what keeps a seventh refusal's reason in the
        // string instead of letting the first one eat it.
        const reasonBudget = Math.floor(900 / itemFailures.length);
        itemGate.evidence = boundedEvaluationText(
          `Independent forensic item checks rejected ${itemFailures.map((item) => boundedEvaluationText(
            `${item.item_id} (confidence ${item.confidence}): ${item.evidence}`,
            reasonBudget,
          )).join(' | ')}`,
          1_000,
        );
        itemGate.defects = itemFailures
          .flatMap((item) => (
            item.defects.map((defect) => boundedEvaluationText(`${item.item_id}: ${defect}`, 200))
          ))
          .filter(Boolean)
          .slice(0, 20);
        payload.score = Math.min(payload.score, 60);
        payload.summary = boundedEvaluationText(
          `${payload.summary}; exact product fidelity failed for ${itemFailures.map((item) => item.item_id).join(', ')}`,
          1_000,
        );
      } else if (itemResults.length > 0 && itemGate.decision === 'PASS') {
        itemGate.evidence = boundedEvaluationText(
          `${itemGate.evidence}; independent forensic PASS: ${itemResults.map((item) => item.item_id).join(', ')}`,
          1_000,
        );
      }
      const requestId = stableRequestId([
        this.evaluatorVersion,
        this.model,
        context.scene_id,
        String(context.attempt),
        context.candidate.sha256,
        context.approved_look.sha256,
        ...references.map((item) => item.sha256),
        ...itemResults.flatMap((item) => [
          item.item_sha256,
          item.item_id,
          item.item_category,
          item.item_facts_sha256,
          item.verdict,
          sha256(Buffer.from(JSON.stringify(item.defects))),
        ]),
      ]);
      return {
        ...payload,
        reviewer: {
          type: 'MODEL',
          id: 'codex-scene-evaluator',
          version: `${this.evaluatorVersion}+${this.model}`,
          request_id: requestId,
        },
        reference_evidence: referenceEvidence(references),
        item_fidelity_evidence: itemResults,
      };
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}

export const SCENE_GENERATION_REFERENCE_ORDER = GENERATION_REFERENCE_ORDER;
