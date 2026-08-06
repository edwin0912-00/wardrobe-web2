import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import sharp from 'sharp';
import { sanitizeOutboundString } from '../security/outbound-redaction.js';
import { GARMENT_CATEGORIES } from './garment-passport.js';
import {
  EDITORIAL_BASE_PRESETS,
  READY_EDITORIAL_MODE_IDS,
  compileEditorialShootBible,
  compileEditorialShotPack,
} from './editorial-shoot-bible.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PRIVATE_EVIDENCE_KEYS = new Set([
  'path',
  'paths',
  'filename',
  'source_path',
  'source_paths',
  'pack_path',
  'packPath',
  'job_path',
  'jobPath',
  'checkpoint_path',
  'checkpointPath',
  'events_path',
  'eventsPath',
  'journal_path',
  'journalPath',
  'work_directory',
  'workDirectory',
  'output_directory',
  'outputDirectory',
]);
const CREATE_UNIVERSE_MODE_META = Object.freeze({
  'shoot.skylight_haze': 'Скляний дах · теплий серпанок',
  'shoot.terracotta_hardlight': 'Теракота · жорстке сонце',
  'shoot.window_gobo_warm': 'Тепле вікно · gobo-тінь',
  'shoot.grey_studio_stride': 'Сіра студія · крок',
  'shoot.sky_dune_surreal': 'Небо й дюна · сюрреалізм',
  'shoot.hardsun_brick_doorway': 'Жорстке сонце · цегляна брама',
  'shoot.overcast_street_stride': 'Хмарна вулиця · крок',
  'shoot.grey_wall_gloss': 'Сіра стіна · глянець',
  'shoot.ochre_stage_tailoring': 'Охра · сценічний кравець',
  'shoot.shutter_amber_interior': 'Жалюзі · бурштиновий інтерʼєр',
  'shoot.zayn_institutional': 'Інституційний модернізм · ритуальна симетрія',
  'shoot.liza_luminous': 'Блакитне поле · білий тюль',
  'shoot.duckweed_forest_ophelia': 'Ряска й ліс · Ophelia',
  'shoot.rooftop_veil_monochrome': 'Дах і вуаль · монохром',
  'shoot.autumn_park_mediated_sun': 'Осінній парк · мʼяке сонце',
});
// The old editorial catalog used the same user-facing name as the verified
// Create Universe unit. Keep old links backward-compatible, but resolve them
// to the immutable CU pack instead of sending users into the preview-only
// editorial record with the missing second source.
const EDITORIAL_TO_CREATE_UNIVERSE_ALIAS = Object.freeze({
  'editorial.edwin_novak.institutional_modernism': 'shoot.zayn_institutional',
});
const USER_FACING_LEGACY_EDITORIAL_MODE_IDS = new Set(
  Object.keys(EDITORIAL_TO_CREATE_UNIVERSE_ALIAS),
);
const CREATE_UNIVERSE_REQUIRED_SHEETS = Object.freeze([
  'camera_lens',
  'blocking',
  'expression_gaze',
  'garment_behaviour',
  'colour_grade',
  'environment',
  'person',
]);
const CREATE_UNIVERSE_GENERATION_SHEETS = new Set([
  'camera_lens',
  'blocking',
  'expression_gaze',
  'garment_behaviour',
]);
const CREATE_UNIVERSE_SHOT_SLOTS = Object.freeze([
  'clean_identity_hero',
  'environmental_hero',
  'sculptural_three_quarter',
  'interference_frame',
  'material_or_accessory_detail',
  'wide_campaign_coda',
]);
const CREATE_UNIVERSE_DENIED_AUTHORITIES = Object.freeze([
  'identity', 'body', 'hair', 'outfit', 'brands', 'readable_text', 'exact_architecture',
]);
const CREATE_UNIVERSE_CREATED_AT = '2026-07-27T00:00:00.000Z';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function resolverError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function safeId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw resolverError(422, `${label} is invalid`);
  }
  return value;
}

function expectedHash(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw resolverError(422, `${label} must be a lowercase SHA-256`);
  }
  return value;
}

function createUniverseUri(modeId, document) {
  return `create-universe://${modeId}/${document}`;
}

function scenePreviewUrl(presetId, presetVersion, revision) {
  expectedHash(revision, 'Scene preview revision');
  return `/api/scene-presets/${encodeURIComponent(presetId)}/${encodeURIComponent(presetVersion)}/preview?v=${revision}`;
}

function editorialPreviewUrl(modeId, version, revision) {
  expectedHash(revision, 'Editorial preview revision');
  return `/api/editorial-modes/${encodeURIComponent(modeId)}/${encodeURIComponent(version)}/preview?v=${revision}`;
}

function inside(root, filename, label = 'Scene preset path') {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(filename);
  if (resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`)) return resolved;
  throw resolverError(422, `${label} escapes its configured root`);
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw resolverError(422, `${label} contains invalid JSON`);
  }
}

function createUniverseText(value, label, maximum = 2_000) {
  if (typeof value !== 'string' || value.trim().length < 8 || value.length > maximum) {
    throw resolverError(422, `${label} must be substantive observed text`);
  }
  return value.trim();
}

function createUniverseTexts(value, label, { minimum = 1, maximum = 20 } = {}) {
  if (!Array.isArray(value)
    || value.length < minimum
    || value.length > maximum
    || value.some((item) => typeof item !== 'string' || item.trim().length < 3 || item.length > 500)
    || new Set(value.map((item) => item.trim())).size !== value.length) {
    throw resolverError(422, `${label} must be a unique observed-text list`);
  }
  return value.map((item) => item.trim());
}

function validateCreateUniverseRuntimeStyle(value, modeId) {
  const label = `Create Universe runtime style ${modeId}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw resolverError(422, `${label} is missing`);
  }
  const expected = [
    'visual_system',
    'mood_line',
    'environment',
    'lighting',
    'materials',
    'contrast',
    'expression_signature',
    'garment_behaviour',
    'optical_signature',
    'shot_directions',
  ];
  if (!isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())) {
    throw resolverError(422, `${label} must contain exactly the observed style contract`);
  }
  if (!value.shot_directions
    || typeof value.shot_directions !== 'object'
    || Array.isArray(value.shot_directions)
    || !isDeepStrictEqual(
      Object.keys(value.shot_directions).sort(),
      [...CREATE_UNIVERSE_SHOT_SLOTS].sort(),
    )) {
    throw resolverError(422, `${label}.shot_directions must cover all six canonical slots`);
  }
  const shotDirections = {};
  const compositionSignatures = new Set();
  for (const slot of CREATE_UNIVERSE_SHOT_SLOTS) {
    const direction = value.shot_directions[slot];
    const directionKeys = ['camera_consequence', 'pose_joint_chain', 'focus', 'foreground', 'provenance'];
    const allowedDirectionKeys = [...directionKeys, 'subject_lighting'];
    if (!direction
      || typeof direction !== 'object'
      || Array.isArray(direction)
      || directionKeys.some((key) => !Object.hasOwn(direction, key))
      || Object.keys(direction).some((key) => !allowedDirectionKeys.includes(key))) {
      throw resolverError(422, `${label}.${slot} must contain the exact shot direction contract`);
    }
    shotDirections[slot] = {
      camera_consequence: createUniverseText(
        direction.camera_consequence,
        `${label}.${slot}.camera_consequence`,
        500,
      ),
      pose_joint_chain: createUniverseText(
        direction.pose_joint_chain,
        `${label}.${slot}.pose_joint_chain`,
        800,
      ),
      focus: createUniverseText(direction.focus, `${label}.${slot}.focus`, 500),
      foreground: createUniverseText(direction.foreground, `${label}.${slot}.foreground`, 500),
      ...(Object.hasOwn(direction, 'subject_lighting') ? {
        subject_lighting: createUniverseText(
          direction.subject_lighting,
          `${label}.${slot}.subject_lighting`,
          800,
        ),
      } : {}),
      provenance: createUniverseTexts(
        direction.provenance,
        `${label}.${slot}.provenance`,
        { minimum: 1, maximum: 12 },
      ),
    };
    compositionSignatures.add(JSON.stringify([
      shotDirections[slot].camera_consequence,
      shotDirections[slot].pose_joint_chain,
      shotDirections[slot].focus,
      shotDirections[slot].foreground,
    ]));
  }
  if (compositionSignatures.size !== CREATE_UNIVERSE_SHOT_SLOTS.length) {
    throw resolverError(422, `${label}.shot_directions must contain six unique compositions`);
  }
  return {
    visual_system: createUniverseText(value.visual_system, `${label}.visual_system`),
    mood_line: createUniverseText(value.mood_line, `${label}.mood_line`, 500),
    environment: createUniverseText(value.environment, `${label}.environment`),
    lighting: createUniverseText(value.lighting, `${label}.lighting`),
    materials: createUniverseTexts(value.materials, `${label}.materials`),
    contrast: createUniverseText(value.contrast, `${label}.contrast`, 500),
    expression_signature: createUniverseText(
      value.expression_signature,
      `${label}.expression_signature`,
      1_000,
    ),
    garment_behaviour: createUniverseText(
      value.garment_behaviour,
      `${label}.garment_behaviour`,
      1_000,
    ),
    optical_signature: createUniverseTexts(
      value.optical_signature,
      `${label}.optical_signature`,
      { minimum: 1, maximum: 12 },
    ),
    shot_directions: shotDirections,
  };
}

function createUniverseUnitBindingSha256({
  unitContractSha256,
  observationSha256,
  selfVerificationSha256,
  runtimeStyleSha256,
  paletteAuthoritySha256,
  sheetSha256ByRole,
}) {
  return sha256(Buffer.from([
    `unit_contract:${unitContractSha256}`,
    `observation_log:${observationSha256}`,
    `self_verification:${selfVerificationSha256}`,
    `runtime_style:${runtimeStyleSha256}`,
    `palette_authority:${paletteAuthoritySha256}`,
    ...CREATE_UNIVERSE_REQUIRED_SHEETS.map(
      (role) => `${role}:${sheetSha256ByRole.get(role) ?? 'MISSING'}`,
    ),
  ].join('\n')));
}

function createUniverseSelfVerificationIsApproved(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 500) return false;
  const text = bytes.toString('utf8');
  return [
    ...CREATE_UNIVERSE_REQUIRED_SHEETS,
    ...CREATE_UNIVERSE_SHOT_SLOTS,
  ].every((label) => text.includes(label))
    && /^UNIT VERDICT:\s*APPROVED\s*$/im.test(text);
}

function assertLogicalApprovedItemEvidence(value, field = 'approved_item_evidence') {
  if (value === null || value === undefined || Buffer.isBuffer(value)) return;
  if (typeof value === 'string') {
    if (sanitizeOutboundString(value, { stripProjectName: false }) !== value) {
      throw resolverError(409, `${field} contains private transport metadata`);
    }
    return;
  }
  if (typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertLogicalApprovedItemEvidence(item, `${field}[${index}]`);
    }
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (PRIVATE_EVIDENCE_KEYS.has(key)) {
      throw resolverError(409, `${field} contains private transport metadata`);
    }
    assertLogicalApprovedItemEvidence(item, `${field}.${key}`);
  }
}

function logicalString(value, field, { maxLength = 2_000 } = {}) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw resolverError(409, `${field} is invalid`);
  }
  if (sanitizeOutboundString(value, { stripProjectName: false }) !== value) {
    throw resolverError(409, `${field} contains private transport metadata`);
  }
  return value;
}

function logicalStringArray(value, field, { maxItems = 64 } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw resolverError(409, `${field} is invalid`);
  }
  value.forEach((item, index) => logicalString(item, `${field}[${index}]`));
}

async function validateApprovedItemEvidence(value, sourceRunId) {
  if (value === null || value === undefined) return;
  if (!value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.schema_version !== '1.0.0'
    || value.kind !== 'APPROVED_ITEM_EVIDENCE'
    || value.source_run_id !== sourceRunId
    || !value.reference_pack
    || value.reference_pack.asset_id !== `${sourceRunId}-wardrobe`
    || value.reference_pack.schema_version !== '1.0.0'
    || value.reference_pack.kind !== 'GARMENT'
    || !SHA256.test(value.reference_pack.sha256 ?? '')
    || value.reference_pack.extraction?.provenance !== 'OBSERVED'
    || typeof value.reference_pack.extraction?.method !== 'string'
    || value.reference_pack.readiness?.decision !== 'READY'
    || value.reference_pack.readiness?.terminal !== false
    || !Array.isArray(value.items)
    || value.items.length === 0
    || value.items.length > 5) {
    throw resolverError(409, 'Approved item evidence has an invalid logical contract');
  }
  logicalString(
    value.reference_pack.extraction.method,
    'approved_item_evidence.reference_pack.extraction.method',
    { maxLength: 160 },
  );
  logicalStringArray(
    value.reference_pack.readiness.reasons,
    'approved_item_evidence.reference_pack.readiness.reasons',
  );
  logicalStringArray(
    value.reference_pack.readiness.actions,
    'approved_item_evidence.reference_pack.readiness.actions',
  );
  const seenIds = new Set();
  const seenSourceIndexes = new Set();
  for (const [index, item] of value.items.entries()) {
    const expectedRole = `GARMENT_${String(item?.category ?? '').toUpperCase()}`;
    if (!item
      || typeof item !== 'object'
      || Array.isArray(item)
      || item.order !== index + 1
      || !GARMENT_CATEGORIES.includes(item.category)
      || item.role !== expectedRole
      || typeof item.reference_set_id !== 'string'
      || !SAFE_ID.test(item.reference_set_id)
      || seenIds.has(item.reference_set_id)
      || !Array.isArray(item.source_indexes)
      || item.source_indexes.length === 0
      || item.source_indexes.some((sourceIndex) => (
        !Number.isInteger(sourceIndex)
        || sourceIndex < 0
        || seenSourceIndexes.has(sourceIndex)
      ))
      || !Number.isFinite(item.confidence)
      || item.confidence < 0
      || item.confidence > 1
      || !SHA256.test(item.sha256 ?? '')
      || item.media_type !== 'image/png'
      || !Buffer.isBuffer(item.data)
      || item.data.length === 0
      || item.data.length > 64 * 1024 * 1024
      || sha256(item.data) !== item.sha256) {
      throw resolverError(409, `Approved item evidence item ${index + 1} is invalid`);
    }
    seenIds.add(item.reference_set_id);
    item.source_indexes.forEach((sourceIndex) => seenSourceIndexes.add(sourceIndex));
    if (item.same_item_confidence !== undefined
      && (!Number.isFinite(item.same_item_confidence)
        || item.same_item_confidence < 0
        || item.same_item_confidence > 1)) {
      throw resolverError(409, `Approved item evidence item ${index + 1} confidence is invalid`);
    }
    if (item.grouping_evidence !== undefined) {
      logicalStringArray(
        item.grouping_evidence,
        `approved_item_evidence.items[${index}].grouping_evidence`,
      );
    }
    if (!item.observed || typeof item.observed !== 'object' || Array.isArray(item.observed)) {
      throw resolverError(409, `Approved item evidence item ${index + 1} facts are invalid`);
    }
    logicalString(
      item.observed.garment_type,
      `approved_item_evidence.items[${index}].observed.garment_type`,
    );
    for (const field of ['colors', 'material', 'pattern', 'logo_text', 'construction']) {
      logicalStringArray(
        item.observed[field],
        `approved_item_evidence.items[${index}].observed.${field}`,
      );
    }
    logicalStringArray(
      item.unknowns,
      `approved_item_evidence.items[${index}].unknowns`,
    );
    let metadata;
    try {
      metadata = await sharp(item.data).metadata();
    } catch {
      throw resolverError(409, `Approved item evidence item ${index + 1} is not an image`);
    }
    if (metadata.format !== 'png'
      || !metadata.width
      || !metadata.height
      || (metadata.pages ?? 1) !== 1) {
      throw resolverError(409, `Approved item evidence item ${index + 1} must be one PNG`);
    }
  }
  assertLogicalApprovedItemEvidence(value);
}

/**
 * Loads the immutable production pack layout generated by
 * tools/build-scene-reference-packs.mjs:
 *
 *   assets/scene-presets/index.json
 *   assets/scene-presets/<preset>/v<major>/index.json
 *   assets/scene-presets/<preset>/v<major>/{preset,reference-pack}.json
 *   prompts/scene-presets/<preset>/v<major>/production-scene.txt
 *
 * Paths declared by a pack index are interpreted relative to projectRoot only
 * after path containment, regular-file, non-symlink and exact-hash checks.
 */
export class FilesystemScenePresetResolver {
  constructor({
    rootDirectory,
    projectRoot = path.resolve(rootDirectory ?? '.', '..', '..'),
  }) {
    if (!rootDirectory) throw new Error('FilesystemScenePresetResolver rootDirectory is required');
    this.rootDirectory = path.resolve(rootDirectory);
    this.projectRoot = path.resolve(projectRoot);
    this.realRoot = null;
    this.realProjectRoot = null;
    this.catalog = null;
    this.editorialShotPacks = new Map();
    this.editorialCatalogCache = null;
    this.editorialPreviewCache = new Map();
    this.editorialPresentationPromise = null;
  }

  async initialize() {
    this.realProjectRoot = await realpath(this.projectRoot);
    this.realRoot = await realpath(this.rootDirectory);
    inside(this.realProjectRoot, this.realRoot, 'Scene preset root');
    const catalogBytes = await this.#safeRead(
      path.join(this.realRoot, 'index.json'),
      'Scene preset catalog',
      this.realRoot,
    );
    const catalog = parseJson(catalogBytes, 'Scene preset catalog');
    if (!Array.isArray(catalog.presets)) {
      throw resolverError(422, 'Scene preset catalog has no presets');
    }
    // Older isolated fixtures use the original self-contained catalog shape.
    // Production catalogs must declare bindings before they may expand beyond
    // the embedded pack entries.
    if (!Array.isArray(catalog.published_preset_indexes)) {
      this.catalog = catalog;
      return;
    }
    if (!Array.isArray(catalog.selected_preset_ids) || catalog.selected_preset_ids.length === 0) {
      throw resolverError(422, 'Scene preset catalog has no selected presets');
    }

    const selectedIds = new Set();
    for (const presetId of catalog.selected_preset_ids) {
      safeId(presetId, 'selected preset_id');
      if (selectedIds.has(presetId)) {
        throw resolverError(422, 'Scene preset catalog contains a duplicate selected preset');
      }
      selectedIds.add(presetId);
    }

    const published = new Map();
    for (const binding of catalog.published_preset_indexes) {
      safeId(binding?.preset_id, 'published preset_id');
      safeId(binding?.preset_version, 'published preset_version');
      expectedHash(binding?.index_sha256, 'published preset index_sha256');
      const key = `${binding.preset_id}:${binding.preset_version}`;
      if (published.has(key)) {
        throw resolverError(422, 'Scene preset catalog contains a duplicate published pack binding');
      }
      const directory = path.join(this.realRoot, binding.preset_id, `v${/^([0-9]+)\./.exec(binding.preset_version)?.[1] ?? ''}`);
      const bytes = await this.#safeRead(
        path.join(directory, 'index.json'),
        'Published scene preset pack index',
        this.realRoot,
      );
      if (sha256(bytes) !== binding.index_sha256) {
        throw resolverError(422, 'Published scene preset pack index SHA-256 mismatch');
      }
      const entry = parseJson(bytes, 'Published scene preset pack index');
      if (entry?.preset_id !== binding.preset_id || entry?.preset_version !== binding.preset_version) {
        throw resolverError(422, 'Published scene preset pack binding does not match its index');
      }
      published.set(key, entry);
    }

    if (published.size !== selectedIds.size) {
      throw resolverError(422, 'Selected scene presets and published pack bindings differ');
    }
    const selectedEntries = catalog.selected_preset_ids.map((presetId) => {
      const entry = published.get(`${presetId}:1.0.0`);
      if (!entry) throw resolverError(422, 'Selected scene preset is not bound to a published pack');
      return entry;
    });
    catalog.presets = selectedEntries;
    this.catalog = catalog;
  }

  async #safeRead(filename, label, allowedRoot = this.realProjectRoot) {
    if (!this.realRoot || !this.realProjectRoot) await this.initialize();
    const resolved = inside(allowedRoot, filename, label);
    let info;
    try {
      info = await lstat(resolved);
    } catch (error) {
      if (error.code === 'ENOENT') throw resolverError(404, `${label} is not available`);
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      throw resolverError(422, `${label} must be a regular non-symlink file`);
    }
    const actual = await realpath(resolved);
    inside(allowedRoot, actual, label);
    return readFile(actual);
  }

  #declaredPath(relativePath, label, allowedRoot = this.realProjectRoot) {
    if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
      throw resolverError(422, `${label} must be a project-relative path`);
    }
    return inside(allowedRoot, path.resolve(this.realProjectRoot, relativePath), label);
  }

  async #versionDirectory(presetId, version) {
    safeId(presetId, 'preset_id');
    safeId(version, 'preset_version');
    if (!this.realRoot) await this.initialize();
    const major = /^(\d+)\./.exec(version)?.[1];
    const candidates = [
      path.join(this.realRoot, presetId, version),
      ...(major ? [path.join(this.realRoot, presetId, `v${major}`)] : []),
    ];
    for (const candidate of candidates) {
      try {
        const resolved = inside(this.realRoot, candidate, 'Scene preset version directory');
        const info = await lstat(resolved);
        if (!info.isDirectory() || info.isSymbolicLink()) continue;
        const actual = await realpath(resolved);
        return inside(this.realRoot, actual, 'Scene preset version directory');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    throw resolverError(404, 'Scene preset version is not available');
  }

  #catalogEntry(presetId, version) {
    const matches = this.catalog.presets.filter((item) => (
      item?.preset_id === presetId && item?.preset_version === version
    ));
    if (matches.length !== 1) {
      throw resolverError(404, 'Scene preset version is not published in the catalog');
    }
    return matches[0];
  }

  async #load(presetId, version) {
    if (!this.catalog) await this.initialize();
    const directory = await this.#versionDirectory(presetId, version);
    const localIndexBytes = await this.#safeRead(
      path.join(directory, 'index.json'),
      'Scene preset pack index',
      directory,
    );
    const packIndex = parseJson(localIndexBytes, 'Scene preset pack index');
    const catalogEntry = this.#catalogEntry(presetId, version);
    if (!isDeepStrictEqual(packIndex, catalogEntry)) {
      throw resolverError(422, 'Scene preset pack index does not match the published catalog');
    }
    if (packIndex.preset_id !== presetId || packIndex.preset_version !== version) {
      throw resolverError(422, 'Scene preset pack id or version does not match its directory');
    }

    const presetPath = this.#declaredPath(packIndex.preset_path, 'Scene preset');
    const referencePackPath = this.#declaredPath(packIndex.reference_pack_path, 'Scene reference pack');
    const promptPath = this.#declaredPath(packIndex.production_prompt_path, 'Scene production prompt');
    const sourceLedgerPath = this.#declaredPath(packIndex.source_ledger_path, 'Scene source ledger');
    const expectedPresetPath = path.join(directory, 'preset.json');
    const expectedReferencePackPath = path.join(directory, 'reference-pack.json');
    const expectedSourceLedgerPath = path.join(directory, 'source-ledger.json');
    const expectedPromptPath = path.join(
      this.realProjectRoot,
      'prompts',
      'scene-presets',
      presetId,
      path.basename(directory),
      'production-scene.txt',
    );
    if (presetPath !== expectedPresetPath
      || referencePackPath !== expectedReferencePackPath
      || sourceLedgerPath !== expectedSourceLedgerPath
      || promptPath !== expectedPromptPath) {
      throw resolverError(422, 'Scene preset pack declares an unexpected production file location');
    }

    const [presetBytes, prompt, referencePackBytes, sourceLedgerBytes] = await Promise.all([
      this.#safeRead(presetPath, 'Scene preset', directory),
      this.#safeRead(promptPath, 'Scene production prompt'),
      this.#safeRead(referencePackPath, 'Scene reference pack', directory),
      this.#safeRead(sourceLedgerPath, 'Scene source ledger', directory),
    ]);
    const preset = parseJson(presetBytes, 'Scene preset');
    const referencePack = parseJson(referencePackBytes, 'Scene reference pack');
    const sourceLedger = parseJson(sourceLedgerBytes, 'Scene source ledger');

    if (preset.preset_id !== presetId || preset.version !== version
      || referencePack.preset_id !== presetId || referencePack.preset_version !== version) {
      throw resolverError(422, 'Scene preset pack id or version does not match its content');
    }
    for (const [value, label] of [
      [packIndex.preset_sha256, 'pack index preset_sha256'],
      [packIndex.prompt_sha256, 'pack index prompt_sha256'],
      [packIndex.reference_pack_sha256, 'pack index reference_pack_sha256'],
      [packIndex.source_ledger_sha256, 'pack index source_ledger_sha256'],
    ]) expectedHash(value, label);
    if (sha256(presetBytes) !== packIndex.preset_sha256
      || sha256(prompt) !== packIndex.prompt_sha256
      || sha256(referencePackBytes) !== packIndex.reference_pack_sha256
      || sha256(sourceLedgerBytes) !== packIndex.source_ledger_sha256) {
      throw resolverError(422, 'Scene preset production file SHA-256 mismatch');
    }
    if (referencePack.preset_sha256 !== packIndex.preset_sha256
      || referencePack.prompt_sha256 !== packIndex.prompt_sha256
      || !isDeepStrictEqual(referencePack.source_ledger, sourceLedger)) {
      throw resolverError(422, 'Scene reference pack is not bound to its preset, prompt and source ledger');
    }
    if (!Array.isArray(referencePack.references)
      || !Array.isArray(packIndex.references)
      || referencePack.references.length !== packIndex.references.length) {
      throw resolverError(422, 'Scene reference pack references are incomplete');
    }

    const assets = [];
    for (const declared of referencePack.references) {
      safeId(declared.reference_id, 'reference_id');
      expectedHash(declared.sha256, `Scene reference ${declared.reference_id} sha256`);
      const indexReference = packIndex.references.find((item) => item.reference_id === declared.reference_id);
      if (!indexReference
        || indexReference.role !== declared.role
        || indexReference.media_type !== declared.media_type
        || indexReference.sha256 !== declared.sha256) {
        throw resolverError(422, `Scene reference ${declared.reference_id} does not match its pack index`);
      }
      const assetPath = this.#declaredPath(
        indexReference.path,
        `Scene reference ${declared.reference_id}`,
        directory,
      );
      const data = await this.#safeRead(
        assetPath,
        `Scene reference ${declared.reference_id}`,
        directory,
      );
      if (sha256(data) !== declared.sha256) {
        throw resolverError(422, `Scene reference ${declared.reference_id} SHA-256 mismatch`);
      }
      assets.push({
        reference_id: declared.reference_id,
        role: declared.role,
        media_type: declared.media_type,
        data,
        sha256: declared.sha256,
      });
    }

    return {
      preset,
      preset_bytes: presetBytes,
      prompt,
      reference_pack: referencePack,
      reference_pack_bytes: referencePackBytes,
      assets,
      reference: {
        preset_id: presetId,
        preset_version: version,
        preset_sha256: sha256(presetBytes),
        reference_pack_id: referencePack.reference_pack_id,
        reference_pack_version: referencePack.version,
        reference_pack_sha256: sha256(referencePackBytes),
        prompt_sha256: sha256(prompt),
      },
    };
  }

  async presetReference({ presetId, presetVersion }) {
    const pack = await this.#load(presetId, presetVersion);
    return {
      ...pack.reference,
      ui_name_uk: typeof pack.preset.ui_name_uk === 'string' ? pack.preset.ui_name_uk : presetId,
      family: pack.preset.family,
      camera: pack.preset.camera,
    };
  }

  async resolveScenePreset(reference) {
    const editorialKey = [
      reference.preset_id,
      reference.preset_version,
      reference.preset_sha256,
      reference.reference_pack_sha256,
      reference.prompt_sha256,
    ].join(':');
    const compiledEditorial = this.editorialShotPacks.get(editorialKey);
    if (compiledEditorial) {
      for (const [key, value] of Object.entries(compiledEditorial.reference)) {
        if (reference[key] !== value) {
          throw resolverError(409, `Editorial scene preset ${key} does not match its immutable pack`);
        }
      }
      return {
        preset: structuredClone(compiledEditorial.preset),
        preset_bytes: Buffer.from(compiledEditorial.preset_bytes),
        prompt: compiledEditorial.prompt,
        reference_pack: structuredClone(compiledEditorial.reference_pack),
        reference_pack_bytes: Buffer.from(compiledEditorial.reference_pack_bytes),
        assets: compiledEditorial.assets.map((asset) => ({
          ...structuredClone({
            reference_id: asset.reference_id,
            role: asset.role,
            media_type: asset.media_type,
            sha256: asset.sha256,
            not_authority_for: asset.not_authority_for,
          }),
          data: Buffer.from(asset.data),
        })),
      };
    }
    const pack = await this.#load(reference.preset_id, reference.preset_version);
    for (const [key, value] of Object.entries(pack.reference)) {
      if (reference[key] !== value) {
        throw resolverError(409, `Scene preset ${key} does not match the immutable pack`);
      }
    }
    return {
      preset: pack.preset,
      preset_bytes: pack.preset_bytes,
      prompt: pack.prompt,
      reference_pack: pack.reference_pack,
      reference_pack_bytes: pack.reference_pack_bytes,
      assets: pack.assets,
    };
  }

  async environmentPlatePreview({ presetId, presetVersion }) {
    if (!this.catalog) await this.initialize();
    safeId(presetId, 'preset_id');
    safeId(presetVersion, 'preset_version');
    this.#catalogEntry(presetId, presetVersion);

    const directory = await this.#versionDirectory(presetId, presetVersion);
    const provenanceBytes = await this.#safeRead(
      path.join(directory, 'candidate-provenance.json'),
      'Scene candidate provenance',
      directory,
    );
    const provenance = parseJson(provenanceBytes, 'Scene candidate provenance');
    if (provenance?.schema_version !== '1.0.0'
      || provenance.preset_id !== presetId
      || provenance.preset_version !== presetVersion
      || !Array.isArray(provenance.assets)) {
      throw resolverError(422, 'Scene candidate provenance does not match the published preset');
    }

    const environmentAssets = provenance.assets.filter(
      (asset) => asset?.role === 'environment_plate',
    );
    if (environmentAssets.length !== 1) {
      throw resolverError(422, 'Scene candidate provenance must declare one environment plate');
    }
    const declared = environmentAssets[0];
    const expectedAssetPath = path.join(directory, 'environment-plate.webp');
    const expectedProjectPath = path.relative(this.realProjectRoot, expectedAssetPath)
      .split(path.sep)
      .join('/');
    const declaredAssetPath = this.#declaredPath(
      declared.path,
      'Scene environment plate',
      directory,
    );
    if (declared.path !== expectedProjectPath || declaredAssetPath !== expectedAssetPath) {
      throw resolverError(422, 'Scene environment plate must use its fixed published path');
    }
    const declaredSha256 = expectedHash(
      declared.sha256,
      'Scene environment plate sha256',
    );
    const data = await this.#safeRead(
      expectedAssetPath,
      'Scene environment plate',
      directory,
    );
    if (sha256(data) !== declaredSha256) {
      throw resolverError(422, 'Scene environment plate SHA-256 mismatch');
    }

    let metadata;
    try {
      const image = sharp(data, { failOn: 'error', animated: true });
      metadata = await image.metadata();
      await image.stats();
    } catch {
      throw resolverError(422, 'Scene environment plate is not a decodable WebP image');
    }
    if (metadata.format !== 'webp'
      || !metadata.width
      || !metadata.height
      || (metadata.pages ?? 1) !== 1) {
      throw resolverError(422, 'Scene environment plate must be one still WebP image');
    }

    return {
      data,
      media_type: 'image/webp',
      sha256: declaredSha256,
      width: metadata.width,
      height: metadata.height,
    };
  }

  async #createUniverseModes() {
    const modes = [];
    const root = inside(
      this.realProjectRoot,
      path.join(this.realProjectRoot, 'docs', 'style-units'),
      'Create Universe root',
    );
    for (const [modeId, uiName] of Object.entries(CREATE_UNIVERSE_MODE_META)) {
      const unitRoot = inside(root, path.join(root, modeId), `Create Universe unit ${modeId}`);
      let manifest;
      let unit;
      let manifestBytes;
      let unitBytes;
      try {
        [manifestBytes, unitBytes] = await Promise.all([
          this.#safeRead(path.join(unitRoot, 'manifest.json'), `Create Universe manifest ${modeId}`, root),
          this.#safeRead(path.join(unitRoot, 'unit.json'), `Create Universe unit ${modeId}`, root),
        ]);
        manifest = parseJson(manifestBytes, `Create Universe manifest ${modeId}`);
        unit = parseJson(unitBytes, `Create Universe unit ${modeId}`);
      } catch (error) {
        modes.push({
          preset_id: modeId,
          version: '1.0.0',
          source_set_status: 'BLOCKED_UNIT_MISSING',
          ui_name_uk: uiName,
          visual_system: 'Create Universe unit is unavailable.',
          sources: [],
          create_universe: { integrity: 'MISSING' },
        });
        continue;
      }
      const sheets = Array.isArray(manifest?.sheets) ? manifest.sheets : [];
      const byRole = new Map(sheets.map((sheet) => [sheet?.sheet_id, sheet]));
      const assets = [];
      let integrity = manifest?.unit_id === modeId
        && unit?.unit_id === modeId
        && sheets.length === CREATE_UNIVERSE_REQUIRED_SHEETS.length
        && byRole.size === CREATE_UNIVERSE_REQUIRED_SHEETS.length;
      let runtimeStyle = null;
      let runtimeStyleError = null;
      try {
        runtimeStyle = validateCreateUniverseRuntimeStyle(unit?.runtime_style, modeId);
      } catch (error) {
        runtimeStyleError = error.message;
      }
      for (const role of CREATE_UNIVERSE_REQUIRED_SHEETS) {
        const declared = byRole.get(role);
        const providerReceiptValid = declared?.provider_receipt?.output_sha256 === declared?.sha256
          && typeof declared?.provider_receipt?.provider === 'string'
          && typeof declared?.provider_receipt?.transport === 'string'
          && typeof declared?.provider_receipt?.job_id === 'string';
        const legacyReceiptValid = declared?.legacy_artifact_receipt?.kind
            === 'GIT_PRESERVED_GENERATED_ASSET'
          && declared?.legacy_artifact_receipt?.output_sha256 === declared?.sha256
          && SHA256.test(declared?.legacy_artifact_receipt?.original_manifest_sha256 ?? '')
          && Array.isArray(declared?.legacy_artifact_receipt?.preserving_commits)
          && declared.legacy_artifact_receipt.preserving_commits.length > 0
          && declared.legacy_artifact_receipt.preserving_commits.every(
            (commit) => /^[a-f0-9]{7,40}$/.test(commit),
          )
          && declared?.legacy_artifact_receipt?.provider_receipt_status === 'UNAVAILABLE_LEGACY';
        if (!declared
          || declared.path !== `sheet-${role}.png`
          || !SHA256.test(declared.sha256 ?? '')
          || (!providerReceiptValid && !legacyReceiptValid)) {
          integrity = false;
          continue;
        }
        try {
          const data = await this.#safeRead(
            inside(unitRoot, path.join(unitRoot, declared.path), `Create Universe ${modeId}/${role}`),
            `Create Universe ${modeId}/${role}`,
            unitRoot,
          );
          const actual = sha256(data);
          if (actual !== declared.sha256) integrity = false;
          assets.push({ role, data, sha256: actual, declared_sha256: declared.sha256 });
        } catch {
          integrity = false;
        }
      }
      const palette = Array.isArray(unit?.palette)
        ? unit.palette.map((item) => `${item?.name ?? 'tone'} ${item?.hex ?? ''}`.trim()).filter(Boolean)
        : [];
      const sourceFrame = Array.isArray(unit?.source_frames) ? unit.source_frames[0] : null;
      if (palette.length === 0 || typeof sourceFrame !== 'string' || sourceFrame.length < 10) integrity = false;
      if (!manifest?.generated_with
        || typeof manifest.generated_with !== 'object'
        || Array.isArray(manifest.generated_with)
        || typeof manifest.generated_with.model !== 'string'
        || typeof manifest.generated_with.transport !== 'string') {
        integrity = false;
      }
      if (!isDeepStrictEqual(manifest?.palette, unit?.palette)
        || !isDeepStrictEqual(manifest?.source_frames, unit?.source_frames)
        || !isDeepStrictEqual(manifest?.unknowns, unit?.unknowns)) {
        integrity = false;
      }

      const unitContractSha256 = sha256(unitBytes);
      if (manifest?.unit_contract?.path !== 'unit.json'
        || manifest?.unit_contract?.sha256 !== unitContractSha256) {
        integrity = false;
      }
      let observationBytes = null;
      let selfVerificationBytes = null;
      let paletteAuthorityBytes = null;
      try {
        [observationBytes, selfVerificationBytes, paletteAuthorityBytes] = await Promise.all([
          this.#safeRead(path.join(unitRoot, 'OBSERVATION.md'), `Create Universe observation ${modeId}`, unitRoot),
          this.#safeRead(path.join(unitRoot, 'SELF-VERIFY.md'), `Create Universe self verification ${modeId}`, unitRoot),
          this.#safeRead(path.join(unitRoot, 'palette-strip.svg'), `Create Universe palette authority ${modeId}`, unitRoot),
        ]);
      } catch {
        integrity = false;
      }
      const observationSha256 = observationBytes ? sha256(observationBytes) : null;
      const selfVerificationSha256 = selfVerificationBytes ? sha256(selfVerificationBytes) : null;
      const paletteAuthoritySha256 = paletteAuthorityBytes ? sha256(paletteAuthorityBytes) : null;
      const runtimeStyleSha256 = runtimeStyle
        ? sha256(Buffer.from(`${JSON.stringify(unit.runtime_style)}\n`))
        : null;
      if (manifest?.observation_log?.path !== 'OBSERVATION.md'
        || manifest?.observation_log?.sha256 !== observationSha256
        || !observationBytes
        || observationBytes.length < 500) {
        integrity = false;
      }
      if (manifest?.self_verification?.path !== 'SELF-VERIFY.md'
        || manifest?.self_verification?.sha256 !== selfVerificationSha256
        || manifest?.self_verification?.status !== 'APPROVED'
        || !createUniverseSelfVerificationIsApproved(selfVerificationBytes)) {
        integrity = false;
      }
      if (manifest?.palette_authority?.path !== 'palette-strip.svg'
        || manifest?.palette_authority?.sha256 !== paletteAuthoritySha256
        || manifest?.palette_authority?.rendered_not_generated !== true) {
        integrity = false;
      }
      if (!runtimeStyleSha256 || manifest?.runtime_style_sha256 !== runtimeStyleSha256) {
        integrity = false;
      }
      for (const source of unit?.source_frames ?? []) {
        const sourceLabel = String(source).split(/\s+—\s+/, 1)[0].trim();
        if (sourceLabel && !observationBytes?.toString('utf8').includes(sourceLabel)) {
          integrity = false;
        }
      }
      const expectedUnitSha256 = createUniverseUnitBindingSha256({
        unitContractSha256,
        observationSha256,
        selfVerificationSha256,
        runtimeStyleSha256,
        paletteAuthoritySha256,
        sheetSha256ByRole: new Map(
          CREATE_UNIVERSE_REQUIRED_SHEETS.map(
            (role) => [role, byRole.get(role)?.sha256 ?? 'MISSING'],
          ),
        ),
      });
      if (manifest?.unit_sha256 !== expectedUnitSha256) integrity = false;

      const sourceBlocked = unit?.style_unit_status === 'BLOCKED_SOURCE';
      const declaredReady = unit?.style_unit_status === 'READY';
      if (sourceBlocked
        && (unit?.source_reconciliation?.status !== 'BLOCKED_SOURCE'
          || typeof unit?.source_reconciliation?.needs_source !== 'string'
          || unit.source_reconciliation.needs_source.trim().length < 8)) {
        integrity = false;
      }
      const manifestUri = createUniverseUri(modeId, 'manifest');
      const unitUri = createUniverseUri(modeId, 'unit');
      const sourceSetStatus = sourceBlocked
        ? 'BLOCKED_SOURCE'
        : !integrity
          ? 'BLOCKED_INTEGRITY_MISMATCH'
          : runtimeStyle && declaredReady
            ? 'READY'
            : 'BLOCKED_STYLE_CONTRACT';
      modes.push({
        preset_id: modeId,
        version: '1.0.0',
        source_set_status: sourceSetStatus,
        ui_name_uk: uiName,
        visual_system: runtimeStyle?.visual_system ?? 'Creative Universe style contract is incomplete.',
        sources: [
          {
            url: manifestUri,
            role: 'editorial_style_observation',
            use: 'Immutable Create Universe manifest: environment, light, camera and palette are style authority only.',
            not_authority_for: [...CREATE_UNIVERSE_DENIED_AUTHORITIES],
          },
          {
            url: unitUri,
            role: 'editorial_style_observation',
            use: 'Immutable Create Universe unit: blocking and material behaviour are style authority only.',
            not_authority_for: [...CREATE_UNIVERSE_DENIED_AUTHORITIES],
          },
        ],
        create_universe: {
          integrity: integrity ? 'HASH_VERIFIED' : 'HASH_MISMATCH',
          runtime_style_error: runtimeStyleError,
          source_reconciliation: sourceBlocked
            ? {
                status: 'BLOCKED_SOURCE',
                needs_source: unit.source_reconciliation.needs_source.trim(),
              }
            : null,
          runtime_style: runtimeStyle,
          content: {
            title: `${uiName} — Create Universe fashion-фотосесія`,
            environment: runtimeStyle?.environment ?? 'BLOCKED: no observed environment contract.',
            palette: palette.join(', '),
            lighting: runtimeStyle
              ? `${runtimeStyle.lighting} Fixed optical signature on every frame: ${runtimeStyle.optical_signature.join(' | ')}.`
              : 'BLOCKED: no observed lighting and optical contract.',
            materials: runtimeStyle?.materials ?? [],
            contrast: runtimeStyle?.contrast ?? 'BLOCKED',
            expression_signature: runtimeStyle?.expression_signature ?? null,
            garment_behaviour: runtimeStyle?.garment_behaviour ?? null,
            optical_signature: runtimeStyle?.optical_signature ?? [],
          },
          manifest_sha256: sha256(manifestBytes),
          unit_sha256: sha256(unitBytes),
          manifest_path: `docs/style-units/${modeId}/manifest.json`,
          unit_path: `docs/style-units/${modeId}/unit.json`,
          assets,
          preview_role: integrity ? 'environment' : 'blocking',
        },
      });
    }
    return modes;
  }

  async #createUniverseBasePack(mode) {
    const universe = mode?.create_universe;
    if (!universe || mode.source_set_status !== 'READY') {
      throw resolverError(409, 'Create Universe unit is not integrity-ready');
    }
    const manifestUri = createUniverseUri(mode.preset_id, 'manifest');
    const unitUri = createUniverseUri(mode.preset_id, 'unit');
    const sourceAuthorities = structuredClone(mode.sources);
    const sourceLedger = {
      schema_version: '1.0.0',
      ledger_id: `ledger.${mode.preset_id}.create_universe.v1`,
      revision: 1,
      preset_id: mode.preset_id,
      preset_version: mode.version,
      status: 'VERIFIED_FOR_RELEASE',
      created_at: CREATE_UNIVERSE_CREATED_AT,
      sources: [
        {
          source_id: `${mode.preset_id}.manifest`, url: manifestUri,
          role: 'editorial_style_observation', use: sourceAuthorities[0].use,
          not_authority_for: [...CREATE_UNIVERSE_DENIED_AUTHORITIES],
          retrieved_at: CREATE_UNIVERSE_CREATED_AT, snapshot_uri: universe.manifest_path,
          content_sha256: universe.manifest_sha256,
          rights: { status: 'VERIFIED', basis: 'OWNED', rights_holder: 'Create Universe supplied reference set', evidence_uri: universe.manifest_path, evidence_sha256: universe.manifest_sha256, verified_at: CREATE_UNIVERSE_CREATED_AT },
        },
        {
          source_id: `${mode.preset_id}.unit`, url: unitUri,
          role: 'editorial_style_observation', use: sourceAuthorities[1].use,
          not_authority_for: [...CREATE_UNIVERSE_DENIED_AUTHORITIES],
          retrieved_at: CREATE_UNIVERSE_CREATED_AT, snapshot_uri: universe.unit_path,
          content_sha256: universe.unit_sha256,
          rights: { status: 'VERIFIED', basis: 'OWNED', rights_holder: 'Create Universe supplied reference set', evidence_uri: universe.unit_path, evidence_sha256: universe.unit_sha256, verified_at: CREATE_UNIVERSE_CREATED_AT },
        },
      ],
    };
    const assetsByRole = new Map(universe.assets.map((asset) => [asset.role, asset]));
    const referenceDefinitions = [
      ['environment_anchor', 'environment', 'environment'],
      ['composition_anchor', 'camera_lens', 'style_camera_lens'],
      ['negative_reference', 'blocking', 'style_blocking'],
      ['lighting_anchor', 'expression_gaze', 'style_expression_gaze'],
      ['palette_anchor', 'garment_behaviour', 'style_garment_behaviour'],
    ];
    const references = referenceDefinitions.map(([role, sourceRole, referenceSuffix]) => {
      const asset = assetsByRole.get(sourceRole);
      if (!asset) throw resolverError(422, `Create Universe unit is missing ${sourceRole}`);
      return {
        reference_id: `${mode.preset_id}.${referenceSuffix}`,
        role,
        sha256: asset.sha256,
        media_type: 'image/png',
        not_authority_for: ['identity', 'body', 'hair', 'outfit'],
      };
    });
    return {
      create_universe_mode: structuredClone(mode),
      create_universe_assets: universe.assets
        .filter((asset) => CREATE_UNIVERSE_GENERATION_SHEETS.has(asset.role))
        .map((asset) => ({ ...asset, data: Buffer.from(asset.data) })),
      preset: {
        preset_id: mode.preset_id,
        version: mode.version,
        source_authorities: sourceAuthorities,
        lighting: {
          time_or_setup: 'Create Universe locked lighting unit',
          key: mode.create_universe.content.lighting,
          fill: 'Reference-defined fill; preserve face identity and every approved item detail.',
          finish: 'polished_editorial_gloss_without_skin_smoothing_or_hdr',
          protected_regions: ['eyes', 'lips', 'face_identity', 'item_logos', 'item_text', 'critical_construction'],
        },
        hard_negatives: ['No copy of a source person, source garment, source architecture or readable source text.'],
      },
      reference_pack: {
        schema_version: '1.0.0', reference_pack_id: `pack.${mode.preset_id}.create_universe.v1`,
        version: '1.0.0', preset_id: mode.preset_id, preset_version: mode.version,
        preset_sha256: universe.manifest_sha256, prompt_sha256: universe.unit_sha256,
        references, source_ledger: sourceLedger,
      },
    };
  }

  async #editorialProgram() {
    if (!this.realProjectRoot) await this.initialize();
    const configPath = path.join(this.realProjectRoot ?? this.projectRoot, 'config', 'scene-presets.json');
    const configBytes = await this.#safeRead(
      configPath,
      'Editorial mode catalog',
      this.realProjectRoot,
    );
    const config = parseJson(configBytes, 'Editorial mode catalog');
    const program = config?.editorial_program;
    if (!program
      || typeof program !== 'object'
      || Array.isArray(program)
      || !Array.isArray(program.modes)
      || !Array.isArray(program.shot_sequence)) {
      throw resolverError(422, 'Editorial mode catalog is incomplete');
    }
    const expectedSlots = [
      'clean_identity_hero',
      'environmental_hero',
      'sculptural_three_quarter',
      'interference_frame',
      'material_or_accessory_detail',
      'wide_campaign_coda',
    ];
    if (!isDeepStrictEqual(program.shot_sequence, expectedSlots)) {
      throw resolverError(422, 'Editorial mode catalog has an invalid shot sequence');
    }
    const createUniverseModes = await this.#createUniverseModes();
    return {
      ...program,
      modes: [...program.modes, ...createUniverseModes],
    };
  }

  async #editorialMode(modeId, version) {
    safeId(modeId, 'mode_id');
    safeId(version, 'version');
    const program = await this.#editorialProgram();
    const matches = program.modes.filter((mode) => (
      mode?.preset_id === modeId && mode?.version === version
    ));
    if (matches.length !== 1) {
      throw resolverError(404, 'Editorial mode version is not published in the catalog');
    }
    const mode = matches[0];
    this.#assertEditorialModeRecord(mode);
    return { program, mode };
  }

  #assertEditorialModeRecord(mode) {
    if (typeof mode.ui_name_uk !== 'string'
      || mode.ui_name_uk.trim() === ''
      || typeof mode.visual_system !== 'string'
      || mode.visual_system.trim() === ''
      || typeof mode.source_set_status !== 'string'
      || mode.source_set_status.trim() === '') {
      throw resolverError(422, 'Editorial mode catalog entry is incomplete');
    }
  }

  async editorialModeDefinition({ modeId, version, requireReady = false }) {
    const resolvedModeId = requireReady
      ? (EDITORIAL_TO_CREATE_UNIVERSE_ALIAS[modeId] ?? modeId)
      : modeId;
    const { mode } = await this.#editorialMode(resolvedModeId, version);
    if (requireReady && !READY_EDITORIAL_MODE_IDS.includes(mode.preset_id)) {
      throw resolverError(409, 'Editorial mode is published as preview-only and cannot generate');
    }
    if (requireReady && mode.source_set_status !== 'READY') {
      throw resolverError(409, 'Editorial mode source set is not ready for generation');
    }
    return structuredClone(mode);
  }

  async compileEditorialShootBible({ modeId, version }) {
    const mode = await this.editorialModeDefinition({
      modeId,
      version,
      requireReady: true,
    });
    const base = EDITORIAL_BASE_PRESETS[modeId];
    const basePack = mode.create_universe
      ? await this.#createUniverseBasePack(mode)
      : base
        ? await this.#load(base.preset_id, base.preset_version)
        : null;
    if (!basePack) throw resolverError(409, 'Editorial mode has no verified production base pack');
    return compileEditorialShootBible({ mode, basePack });
  }

  async editorialShotPresetReference({
    modeId,
    version,
    shotSpec,
  }) {
    const mode = await this.editorialModeDefinition({
      modeId,
      version,
      requireReady: true,
    });
    const base = EDITORIAL_BASE_PRESETS[modeId];
    const basePack = mode.create_universe
      ? await this.#createUniverseBasePack(mode)
      : base
        ? await this.#load(base.preset_id, base.preset_version)
        : null;
    if (!basePack) throw resolverError(409, 'Editorial mode has no verified production base pack');
    const pack = compileEditorialShotPack({
      mode,
      basePack,
      shotSpec,
    });
    const key = [
      pack.reference.preset_id,
      pack.reference.preset_version,
      pack.reference.preset_sha256,
      pack.reference.reference_pack_sha256,
      pack.reference.prompt_sha256,
    ].join(':');
    const existing = this.editorialShotPacks.get(key);
    if (existing && existing.fingerprint !== pack.fingerprint) {
      throw resolverError(409, 'Editorial shot pack fingerprint conflict');
    }
    this.editorialShotPacks.set(key, pack);
    return structuredClone(pack.reference);
  }

  #cloneEditorialPreview(preview) {
    return {
      ...preview,
      data: Buffer.from(preview.data),
      delivery: preview.delivery ? { ...preview.delivery } : null,
    };
  }

  async #resolveEditorialModePreview({ modeId, version, mode }) {
    // A delivered photoshoot frame is a better preview than the unit's own
    // reference sheet: the sheet is a technical contact sheet and reads as one.
    // So a mood card wins whenever one exists on disk, and units without one
    // keep the sheet exactly as before.
    let hasMoodCard = false;
    if (mode.create_universe) {
      try {
        const cardRoot = inside(
          this.realProjectRoot,
          path.join(this.realProjectRoot, 'assets', 'scene-mood-cards'),
          'Editorial preview root',
        );
        const [asset, sidecar] = await Promise.all([
          lstat(inside(cardRoot, path.join(cardRoot, `${modeId}.webp`), 'Editorial preview asset')),
          lstat(inside(cardRoot, path.join(cardRoot, `${modeId}.json`), 'Editorial preview sidecar')),
        ]);
        hasMoodCard = asset.isFile() && !asset.isSymbolicLink()
          && sidecar.isFile() && !sidecar.isSymbolicLink();
      } catch {
        hasMoodCard = false;
      }
    }
    if (mode.create_universe && !hasMoodCard) {
      const asset = mode.create_universe.assets.find((item) => item.role === mode.create_universe.preview_role);
      if (!asset) throw resolverError(422, 'Create Universe preview asset is unavailable');
      return {
        data: Buffer.from(asset.data),
        media_type: 'image/png',
        sha256: asset.sha256,
        width: null,
        height: null,
        mode_id: modeId,
        version,
        kind: 'editorial',
        role: 'style_unit',
        delivery: null,
      };
    }
    const assetRoot = inside(
      this.realProjectRoot,
      path.join(this.realProjectRoot, 'assets', 'scene-mood-cards'),
      'Editorial preview root',
    );
    const sidecarPath = inside(
      assetRoot,
      path.join(assetRoot, `${modeId}.json`),
      'Editorial preview sidecar',
    );
    const assetPath = inside(
      assetRoot,
      path.join(assetRoot, `${modeId}.webp`),
      'Editorial preview asset',
    );
    const sidecarBytes = await this.#safeRead(
      sidecarPath,
      'Editorial preview sidecar',
      assetRoot,
    );
    const sidecar = parseJson(sidecarBytes, 'Editorial preview sidecar');
    const expectedProjectPath = path.relative(this.realProjectRoot, assetPath)
      .split(path.sep)
      .join('/');
    if (sidecar?.schema_version !== '1.0.0'
      || sidecar.preset_id !== modeId
      || sidecar.kind !== 'editorial'
      || sidecar.asset_role !== 'mood_card'
      || sidecar.file !== expectedProjectPath
      || sidecar.ui_name_uk !== mode.ui_name_uk
      || sidecar.delivery?.width !== 1024
      || sidecar.delivery?.height !== 1280
      || sidecar.delivery?.format !== 'webp'
      || sidecar.delivery?.aspect_ratio !== '4:5') {
      throw resolverError(422, 'Editorial preview sidecar does not match its catalog mode');
    }
    const declaredSha256 = expectedHash(sidecar.sha256, 'Editorial preview sha256');
    const data = await this.#safeRead(
      assetPath,
      'Editorial preview asset',
      assetRoot,
    );
    if (sha256(data) !== declaredSha256) {
      throw resolverError(422, 'Editorial preview SHA-256 mismatch');
    }

    let metadata;
    try {
      const image = sharp(data, { failOn: 'error', animated: true });
      metadata = await image.metadata();
      await image.stats();
    } catch {
      throw resolverError(422, 'Editorial preview is not a decodable WebP image');
    }
    if (metadata.format !== 'webp'
      || metadata.width !== 1024
      || metadata.height !== 1280
      || (metadata.pages ?? 1) !== 1) {
      throw resolverError(422, 'Editorial preview must be one 1024x1280 WebP image');
    }

    return {
      data,
      media_type: 'image/webp',
      sha256: declaredSha256,
      width: metadata.width,
      height: metadata.height,
      mode_id: modeId,
      version,
      kind: 'editorial',
      role: 'mood_card',
      delivery: {
        width: 1024,
        height: 1280,
        format: 'webp',
        aspect_ratio: '4:5',
      },
    };
  }

  async #buildEditorialPresentationCache() {
    if (!this.realProjectRoot) await this.initialize();
    const program = await this.#editorialProgram();
    const modes = [];
    const previews = new Map();
    const published = new Set();
    for (const mode of program.modes) {
      safeId(mode?.preset_id, 'mode_id');
      safeId(mode?.version, 'version');
      this.#assertEditorialModeRecord(mode);
      const key = `${mode.preset_id}:${mode.version}`;
      if (published.has(key)) {
        throw resolverError(404, 'Editorial mode version is not published in the catalog');
      }
      published.add(key);
      const preview = await this.#resolveEditorialModePreview({
        modeId: mode.preset_id,
        version: mode.version,
        mode,
      });
      previews.set(key, preview);
      // The source program and prepared preview cache keep legacy records so
      // old preview URLs remain integrity-checked and generation deep links can
      // be upgraded through EDITORIAL_TO_CREATE_UNIVERSE_ALIAS. Only the public
      // choices omit the duplicate preview-only record.
      if (USER_FACING_LEGACY_EDITORIAL_MODE_IDS.has(mode.preset_id)) continue;
      modes.push({
        mode_id: mode.preset_id,
        version: mode.version,
        mode_version: mode.version,
        ui_name_uk: mode.ui_name_uk,
        visual_system: mode.visual_system,
        source_set_status: mode.source_set_status,
        generation_available: READY_EDITORIAL_MODE_IDS.includes(mode.preset_id)
          && mode.source_set_status === 'READY',
        preview_url: editorialPreviewUrl(mode.preset_id, mode.version, preview.sha256),
      });
    }
    const generationModeIds = modes
      .filter((mode) => mode.generation_available)
      .map((mode) => mode.mode_id);
    this.editorialPreviewCache = previews;
    this.editorialCatalogCache = {
      status: 'ACTIVE',
      generation_available: generationModeIds.length > 0,
      generation_mode_ids: generationModeIds,
      shot_sequence: [...program.shot_sequence],
      modes,
    };
  }

  async prepareEditorialPresentation() {
    if (!this.editorialCatalogCache) {
      this.editorialPresentationPromise ??= this.#buildEditorialPresentationCache()
        .catch((error) => {
          this.editorialPresentationPromise = null;
          throw error;
        });
      await this.editorialPresentationPromise;
    }
    return structuredClone(this.editorialCatalogCache);
  }

  async editorialModePreview({ modeId, version }) {
    if (!this.realProjectRoot) await this.initialize();
    safeId(modeId, 'mode_id');
    safeId(version, 'version');
    const cached = this.editorialPreviewCache.get(`${modeId}:${version}`);
    if (cached) return this.#cloneEditorialPreview(cached);
    const { mode } = await this.#editorialMode(modeId, version);
    return this.#resolveEditorialModePreview({ modeId, version, mode });
  }

  async listEditorialModes() {
    return this.prepareEditorialPresentation();
  }

  async listPresets() {
    if (!this.catalog) await this.initialize();
    const results = [];
    for (const item of this.catalog.presets) {
      const reference = await this.presetReference({
        presetId: item.preset_id,
        presetVersion: item.preset_version,
      });
      const preview = await this.environmentPlatePreview({
        presetId: reference.preset_id,
        presetVersion: reference.preset_version,
      });
      results.push({
        ...reference,
        preview_url: scenePreviewUrl(reference.preset_id, reference.preset_version, preview.sha256),
      });
    }
    return results.sort((left, right) => left.preset_id.localeCompare(right.preset_id));
  }
}

export function createProfileApprovedLookResolver({ profiles, runService }) {
  if (!profiles || !runService) throw new Error('Approved look resolver requires profiles and runService');
  return {
    async resolveApprovedLook(reference) {
      const resolved = await profiles.resolveApprovedLook(reference, runService);
      await validateApprovedItemEvidence(
        resolved?.approved_item_evidence,
        resolved?.source_run_id,
      );
      return resolved;
    },
  };
}
