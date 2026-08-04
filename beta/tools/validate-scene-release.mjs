#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultPaths = {
  catalog: path.join(projectRoot, 'config', 'scene-presets.json'),
  manifest: path.join(projectRoot, 'output', 'scene-mvp', 'asset-manifest.json'),
  qaReceipt: path.join(projectRoot, 'output', 'scene-mvp', 'visual-qa.json'),
  privacyReport: path.join(projectRoot, 'output', 'scene-mvp', 'privacy-qa.json'),
};

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return result;
}

function sha256Buffer(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function computeReleaseEvidenceSubjectSha256(manifest) {
  const assets = (manifest.assets ?? [])
    .map((asset) => ({
      asset_id: asset.asset_id,
      revision: asset.revision,
      previous_revision: asset.previous_revision,
      preset_id: asset.preset_id,
      preset_version: asset.preset_version,
      asset_role: asset.asset_role,
      file: asset.file,
      sha256: asset.sha256,
      exact_prompt: asset.exact_prompt,
      generation: asset.generation,
      derivation_lineage: asset.derivation_lineage,
      source_ledger: asset.source_ledger,
      delivery: asset.delivery,
      contains_personal_input: asset.privacy?.contains_personal_input,
      created_at: asset.created_at,
    }))
    .sort((left, right) => left.asset_id.localeCompare(right.asset_id));
  const subject = {
    catalog_snapshot: manifest.catalog_snapshot,
    selected_standard_preset_ids: [
      ...(manifest.selected_standard_preset_ids ?? []),
    ].sort(),
    required_asset_roles: [...(manifest.required_asset_roles ?? [])].sort(),
    assets,
  };
  return sha256Buffer(JSON.stringify(canonicalize(subject)));
}

function displayPath(filename) {
  const relative = path.relative(projectRoot, filename);
  return relative.startsWith('..') ? filename : relative;
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

async function readJsonWithHash(filename) {
  const content = await readFile(filename);
  return {
    value: JSON.parse(content.toString('utf8')),
    sha256: sha256Buffer(content),
  };
}

async function loadValidator(schemaFilename, dependencyFilenames = []) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  for (const filename of dependencyFilenames) {
    ajv.addSchema(await readJson(path.join(projectRoot, 'schemas', filename)));
  }
  const schema = await readJson(path.join(projectRoot, 'schemas', schemaFilename));
  ajv.addSchema(schema);
  return ajv.getSchema(schema.$id);
}

function schemaErrors(errors = [], limit = 80) {
  return errors.slice(0, limit).map((error) => ({
    instance_path: error.instancePath || '/',
    keyword: error.keyword,
    message: error.message ?? 'schema validation failed',
  }));
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function onePresetPerFamily(catalog, selectedIds) {
  const familyById = new Map(
    catalog.standard_presets.map((preset) => [preset.preset_id, preset.family]),
  );
  const families = selectedIds.map((id) => familyById.get(id)).filter(Boolean);
  return families.length === 5 && new Set(families).size === 5;
}

function inspectLegacyManifest(manifest, blockers) {
  const assets = Array.isArray(manifest.assets)
    ? manifest.assets
    : Array.isArray(manifest.files)
      ? manifest.files
      : [];
  if (!assets.length) return;

  const mutableModelAssets = assets.filter((asset) =>
    ['builtin-current', 'current', 'latest', 'unknown'].includes(
      asset.generation?.model_version,
    ));
  if (mutableModelAssets.length) {
    blockers.push({
      code: 'MODEL_VERSION_NOT_PINNED',
      path: 'assets[].generation.model_version',
      message: `${mutableModelAssets.length} asset(s) use a moving or unknown model version.`,
    });
  }

  const missingRequestIds = assets.filter(
    (asset) => !asset.generation?.provider_request_id,
  );
  if (missingRequestIds.length) {
    blockers.push({
      code: 'PROVIDER_REQUEST_ID_MISSING',
      path: 'assets[].generation.provider_request_id',
      message: `${missingRequestIds.length} asset(s) have no provider request ID.`,
    });
  }

  const missingLedgers = assets.filter((asset) => !asset.source_ledger);
  if (missingLedgers.length) {
    blockers.push({
      code: 'SOURCE_LEDGER_MISSING',
      path: 'assets[].source_ledger',
      message: `${missingLedgers.length} asset(s) have no hash-bound, rights-verified source ledger.`,
    });
  }

  const missingLineage = assets.filter((asset) => !asset.derivation_lineage);
  if (missingLineage.length) {
    blockers.push({
      code: 'DERIVATION_LINEAGE_MISSING',
      path: 'assets[].derivation_lineage',
      message: `${missingLineage.length} asset(s) do not preserve immutable generation/edit/reframe lineage.`,
    });
  }

  const unsplitApproval = assets.filter(
    (asset) =>
      Object.hasOwn(asset, 'approval') ||
      !asset.visual_qa ||
      !asset.human_approval,
  );
  if (unsplitApproval.length) {
    blockers.push({
      code: 'APPROVAL_EVIDENCE_NOT_SPLIT',
      path: 'assets[].visual_qa|human_approval',
      message: `${unsplitApproval.length} asset(s) do not separately bind visual QA and human approval receipts.`,
    });
  }

  const revisionsMissing = assets.filter(
    (asset) => !Number.isInteger(asset.revision) || asset.revision < 1,
  );
  if (revisionsMissing.length) {
    blockers.push({
      code: 'IMMUTABLE_REVISION_MISSING',
      path: 'assets[].revision',
      message: `${revisionsMissing.length} asset(s) can be overwritten without an immutable revision number.`,
    });
  }
}

async function verifyManifestFiles(manifest, blockers) {
  const assets = Array.isArray(manifest.assets)
    ? manifest.assets
    : Array.isArray(manifest.files)
      ? manifest.files
      : [];
  let missingCount = 0;
  let hashMismatchCount = 0;
  let unsafePathCount = 0;
  for (const asset of assets) {
    if (typeof asset.file !== 'string' || typeof asset.sha256 !== 'string') continue;
    const filename = resolveRepositoryFile(asset.file);
    if (!filename) {
      unsafePathCount += 1;
      continue;
    }
    try {
      await access(filename);
      const actualHash = sha256Buffer(await readFile(filename));
      if (actualHash !== asset.sha256) hashMismatchCount += 1;
    } catch {
      missingCount += 1;
    }
  }
  if (missingCount) {
    blockers.push({
      code: 'MANIFEST_FILE_MISSING',
      path: 'assets[].file',
      message: `${missingCount} manifest file(s) are missing from disk.`,
    });
  }
  if (hashMismatchCount) {
    blockers.push({
      code: 'MANIFEST_FILE_HASH_MISMATCH',
      path: 'assets[].sha256',
      message: `${hashMismatchCount} manifest file(s) do not match their recorded SHA-256.`,
    });
  }
  if (unsafePathCount) {
    blockers.push({
      code: 'ASSET_PATH_OUTSIDE_REPOSITORY',
      path: 'assets[].file',
      message: `${unsafePathCount} manifest asset path(s) escape the repository boundary.`,
    });
  }
}

function resolveRepositoryFile(relativePath) {
  if (typeof relativePath !== 'string') return null;
  const resolved = path.resolve(projectRoot, relativePath);
  if (
    resolved !== projectRoot &&
    !resolved.startsWith(`${projectRoot}${path.sep}`)
  ) {
    return null;
  }
  return resolved;
}

async function verifyReleaseEvidenceFiles(manifest, blockers) {
  if (!Array.isArray(manifest.assets)) return;
  let unsafePaths = 0;
  let missingPromptFiles = 0;
  let promptHashMismatches = 0;
  let missingSourceSnapshots = 0;
  let sourceSnapshotHashMismatches = 0;
  let missingRightsEvidence = 0;
  let rightsEvidenceHashMismatches = 0;
  let missingProviderReceipts = 0;
  let providerReceiptHashMismatches = 0;
  let missingOperationPrompts = 0;
  let operationPromptHashMismatches = 0;
  let lineageOutputMismatches = 0;
  let lineageChainFailures = 0;
  let deliveryContractFailures = 0;

  async function checkEvidence(relativePath, expectedHash, counters) {
    const filename = resolveRepositoryFile(relativePath);
    if (!filename) {
      unsafePaths += 1;
      return;
    }
    try {
      const actualHash = sha256Buffer(await readFile(filename));
      if (actualHash !== expectedHash) counters.mismatch += 1;
    } catch {
      counters.missing += 1;
    }
  }

  for (const asset of manifest.assets) {
    const promptCounters = { missing: 0, mismatch: 0 };
    await checkEvidence(
      asset.exact_prompt?.path,
      asset.exact_prompt?.sha256,
      promptCounters,
    );
    missingPromptFiles += promptCounters.missing;
    promptHashMismatches += promptCounters.mismatch;

    const providerCounters = { missing: 0, mismatch: 0 };
    await checkEvidence(
      asset.generation?.provider_receipt?.path,
      asset.generation?.provider_receipt?.sha256,
      providerCounters,
    );
    missingProviderReceipts += providerCounters.missing;
    providerReceiptHashMismatches += providerCounters.mismatch;

    for (const source of asset.source_ledger?.sources ?? []) {
      const sourceCounters = { missing: 0, mismatch: 0 };
      await checkEvidence(source.snapshot_uri, source.content_sha256, sourceCounters);
      missingSourceSnapshots += sourceCounters.missing;
      sourceSnapshotHashMismatches += sourceCounters.mismatch;

      const rightsCounters = { missing: 0, mismatch: 0 };
      await checkEvidence(
        source.rights?.evidence_uri,
        source.rights?.evidence_sha256,
        rightsCounters,
      );
      missingRightsEvidence += rightsCounters.missing;
      rightsEvidenceHashMismatches += rightsCounters.mismatch;
    }

    const operations = asset.derivation_lineage?.operations ?? [];
    const operationIds = new Set();
    for (const [index, operation] of operations.entries()) {
      if (operationIds.has(operation.operation_id)) lineageChainFailures += 1;
      operationIds.add(operation.operation_id);
      if (['GENERATE', 'EDIT'].includes(operation.type)) {
        const operationPromptCounters = { missing: 0, mismatch: 0 };
        await checkEvidence(
          operation.prompt_path,
          operation.prompt_sha256,
          operationPromptCounters,
        );
        missingOperationPrompts += operationPromptCounters.missing;
        operationPromptHashMismatches += operationPromptCounters.mismatch;
      }
      if (
        (index === 0 &&
          (operation.type !== 'GENERATE' ||
            (operation.input_sha256s?.length ?? 0) !== 0 ||
            operation.prompt_sha256 !== asset.exact_prompt?.sha256)) ||
        (index > 0 &&
          !(operation.input_sha256s ?? []).includes(
            operations[index - 1].output_sha256,
          ))
      ) {
        lineageChainFailures += 1;
      }
    }
    if (
      operations.length &&
      operations.at(-1)?.output_sha256 !== asset.sha256
    ) {
      lineageOutputMismatches += 1;
    }
    const imageRole = [
      'mood_card',
      'environment_plate',
      'lighting_preview',
      'production_scene',
      'editorial_shot',
    ].includes(asset.asset_role);
    if (
      imageRole &&
      (asset.delivery?.aspect_ratio !== '4:5' ||
        !['webp', 'png'].includes(asset.delivery?.format) ||
        Math.abs(asset.delivery.width / asset.delivery.height - 0.8) > 0.0001)
    ) {
      deliveryContractFailures += 1;
    }
    if (
      asset.asset_role === 'reference_pack' &&
      (asset.delivery?.format !== 'json' ||
        asset.delivery?.aspect_ratio !== 'not_applicable')
    ) {
      deliveryContractFailures += 1;
    }
  }

  const summarized = [
    ['UNSAFE_RELEASE_PATH', unsafePaths, 'Release evidence contains paths outside the repository boundary.'],
    ['EXACT_PROMPT_FILE_MISSING', missingPromptFiles, 'Exact prompt file(s) are missing.'],
    ['EXACT_PROMPT_HASH_MISMATCH', promptHashMismatches, 'Exact prompt file hash(es) do not match the manifest.'],
    ['SOURCE_SNAPSHOT_MISSING', missingSourceSnapshots, 'Source snapshot file(s) are missing.'],
    ['SOURCE_SNAPSHOT_HASH_MISMATCH', sourceSnapshotHashMismatches, 'Source snapshot hash(es) do not match the ledger.'],
    ['RIGHTS_EVIDENCE_MISSING', missingRightsEvidence, 'Rights evidence file(s) are missing.'],
    ['RIGHTS_EVIDENCE_HASH_MISMATCH', rightsEvidenceHashMismatches, 'Rights evidence hash(es) do not match the ledger.'],
    ['PROVIDER_RECEIPT_MISSING', missingProviderReceipts, 'Provider request receipt file(s) are missing.'],
    ['PROVIDER_RECEIPT_HASH_MISMATCH', providerReceiptHashMismatches, 'Provider request receipt hash(es) do not match the manifest.'],
    ['OPERATION_PROMPT_MISSING', missingOperationPrompts, 'Generation/edit operation prompt file(s) are missing.'],
    ['OPERATION_PROMPT_HASH_MISMATCH', operationPromptHashMismatches, 'Generation/edit operation prompt hash(es) do not match lineage.'],
    ['LINEAGE_FINAL_HASH_MISMATCH', lineageOutputMismatches, 'Derivation lineage does not terminate at the released asset hash.'],
    ['LINEAGE_CHAIN_INVALID', lineageChainFailures, 'Derivation operations are duplicated or do not form one continuous hash chain.'],
    ['DELIVERY_CONTRACT_INVALID', deliveryContractFailures, 'Asset role, media format, aspect ratio or dimensions disagree.'],
  ];
  for (const [code, count, message] of summarized) {
    if (!count) continue;
    blockers.push({
      code,
      path: 'assets',
      message: `${count} occurrence(s): ${message}`,
    });
  }
}

function inspectAssetRoleCoverage(manifest, selectedIds, blockers) {
  const assets = Array.isArray(manifest.assets)
    ? manifest.assets
    : Array.isArray(manifest.files)
      ? manifest.files
      : [];
  const requiredRoles = [
    'mood_card',
    'environment_plate',
    'lighting_preview',
    'reference_pack',
    'production_scene',
  ];
  const missing = [];
  for (const presetId of selectedIds) {
    const roles = new Set(
      assets
        .filter((asset) => asset.preset_id === presetId)
        .map((asset) => asset.asset_role),
    );
    for (const role of requiredRoles) {
      if (!roles.has(role)) missing.push(`${presetId}:${role}`);
    }
  }
  if (!selectedIds.length) {
    blockers.push({
      code: 'PRODUCTION_ASSET_COVERAGE_UNVERIFIABLE',
      path: 'launch_selection.selected_preset_ids',
      message: 'No approved five-preset launch selection exists, so production asset coverage cannot be proven.',
    });
  } else if (missing.length) {
    blockers.push({
      code: 'PRODUCTION_ASSETS_MISSING',
      path: 'assets',
      message: `${missing.length} required selected-preset asset(s) are absent.`,
      evidence: missing,
    });
  }
}

function inspectReleaseManifestSemantics(manifest, catalog, blockers) {
  if (!Array.isArray(manifest.assets)) return;
  const presetById = new Map(
    [
      ...(catalog?.standard_presets ?? []),
      ...(catalog?.editorial_program?.modes ?? []),
    ].map((preset) => [preset.preset_id, preset]),
  );
  const assetIds = manifest.assets.map((asset) => asset.asset_id);
  if (new Set(assetIds).size !== assetIds.length) {
    blockers.push({
      code: 'DUPLICATE_ASSET_IDS',
      path: 'assets[].asset_id',
      message: 'Release manifest contains duplicate immutable asset IDs.',
    });
  }
  const selected = manifest.selected_standard_preset_ids ?? [];
  const catalogSelected = catalog?.launch_selection?.selected_preset_ids ?? [];
  if (
    selected.length !== catalogSelected.length ||
    selected.some((id) => !catalogSelected.includes(id))
  ) {
    blockers.push({
      code: 'MANIFEST_SELECTION_MISMATCH',
      path: 'selected_standard_preset_ids',
      message: 'Manifest selection does not exactly match the approved catalog selection.',
    });
  }

  let presetBindingFailures = 0;
  let ledgerBindingFailures = 0;
  let duplicateLedgerSources = 0;
  let revisionChainFailures = 0;
  for (const asset of manifest.assets) {
    const preset = presetById.get(asset.preset_id);
    if (!preset || preset.version !== asset.preset_version) {
      presetBindingFailures += 1;
    }
    if (
      asset.source_ledger?.preset_id !== asset.preset_id ||
      asset.source_ledger?.preset_version !== asset.preset_version
    ) {
      ledgerBindingFailures += 1;
    }
    const sources = asset.source_ledger?.sources ?? [];
    if (
      new Set(sources.map((source) => source.source_id)).size !== sources.length ||
      new Set(sources.map((source) => source.url)).size !== sources.length
    ) {
      duplicateLedgerSources += 1;
    }
    if (
      (asset.revision === 1 && asset.previous_revision !== null) ||
      (asset.revision > 1 &&
        (!asset.previous_revision ||
          asset.previous_revision.asset_id !== asset.asset_id ||
          asset.previous_revision.revision !== asset.revision - 1))
    ) {
      revisionChainFailures += 1;
    }
  }
  const summaries = [
    ['PRESET_BINDING_MISMATCH', presetBindingFailures, 'asset preset ID/version does not match the catalog'],
    ['SOURCE_LEDGER_BINDING_MISMATCH', ledgerBindingFailures, 'source ledger is not bound to the asset preset ID/version'],
    ['SOURCE_LEDGER_DUPLICATE_SOURCE', duplicateLedgerSources, 'source ledger repeats a source ID or URL'],
    ['REVISION_CHAIN_INVALID', revisionChainFailures, 'asset revision does not bind its immediate immutable predecessor'],
  ];
  for (const [code, count, message] of summaries) {
    if (!count) continue;
    blockers.push({
      code,
      path: 'assets',
      message: `${count} asset(s): ${message}.`,
    });
  }
}

function inspectQaCoverage(manifest, qaReceipt, blockers) {
  const assets = Array.isArray(manifest.assets)
    ? manifest.assets
    : Array.isArray(manifest.files)
      ? manifest.files
      : [];
  const results = Array.isArray(qaReceipt?.asset_results)
    ? qaReceipt.asset_results
    : [];
  if (!results.length) {
    blockers.push({
      code: 'PER_ASSET_QA_EVIDENCE_MISSING',
      path: 'qa_receipt.asset_results',
      message: 'The QA receipt does not bind a framing and gate result to every released asset hash.',
    });
    return;
  }
  const receiptKeys = new Set(
    results.map((result) => `${result.asset_id}:${result.sha256}`),
  );
  const missing = assets.filter((asset) => {
    const assetId = asset.asset_id ?? asset.preset_id;
    return !receiptKeys.has(`${assetId}:${asset.sha256}`);
  });
  if (missing.length) {
    blockers.push({
      code: 'QA_HASH_COVERAGE_INCOMPLETE',
      path: 'qa_receipt.asset_results',
      message: `${missing.length} manifest asset(s) are not hash-bound in the QA receipt.`,
    });
  }

  const expectedGates =
    qaReceipt.qa_profile === 'PRODUCTION_SCENE'
      ? [
          'MASTER_LOOK_LOCK',
          'REFERENCE_ROLE_ISOLATION',
          'NEAR_COPY_AND_LEAKAGE',
          'IDENTITY',
          'ITEM_FIDELITY',
          'SCENE_MATCH',
          'LIGHT_AND_CONTACT_SHADOW',
          'FRAMING_AND_ANATOMY',
          'PROVENANCE',
        ]
      : [
          'REFERENCE_ROLE_ISOLATION',
          'NEAR_COPY_AND_LEAKAGE',
          'SCENE_MATCH',
          'LIGHT_AND_CONTACT_SHADOW',
          'FRAMING_AND_ANATOMY',
          'PROVENANCE',
        ];
  let gateSetFailures = 0;
  let framingFailures = 0;
  let passEvidenceFailures = 0;
  for (const result of results) {
    const gateIds = (result.gate_results ?? []).map((gate) => gate.id);
    if (
      gateIds.length !== expectedGates.length ||
      gateIds.some((id, index) => id !== expectedGates[index])
    ) {
      gateSetFailures += 1;
    }
    const framing = result.framing_evidence;
    if (framing) {
      const [minimum, maximum] = framing.expected_subject_height_percent ?? [];
      const [bboxX, bboxY, bboxWidth, bboxHeight] =
        framing.subject_bbox_xywh_px ?? [];
      const bboxWithinCanvas =
        Number.isFinite(bboxX) &&
        Number.isFinite(bboxY) &&
        Number.isFinite(bboxWidth) &&
        Number.isFinite(bboxHeight) &&
        bboxX >= 0 &&
        bboxY >= 0 &&
        bboxWidth > 0 &&
        bboxHeight > 0 &&
        bboxX + bboxWidth <= framing.canvas_width &&
        bboxY + bboxHeight <= framing.canvas_height;
      const measuredSubjectPercent =
        (bboxHeight / framing.canvas_height) * 100;
      const measuredAbovePercent = (bboxY / framing.canvas_height) * 100;
      const measuredBelowPercent =
        ((framing.canvas_height - bboxY - bboxHeight) /
          framing.canvas_height) *
        100;
      const measurementTolerance = 0.05;
      if (
        !Number.isFinite(minimum) ||
        !Number.isFinite(maximum) ||
        minimum > maximum ||
        !bboxWithinCanvas ||
        Math.abs(measuredSubjectPercent - framing.subject_height_percent) >
          measurementTolerance ||
        Math.abs(
          measuredAbovePercent - framing.clear_space_above_hair_percent,
        ) > measurementTolerance ||
        Math.abs(
          measuredBelowPercent - framing.clear_space_below_footwear_percent,
        ) > measurementTolerance ||
        framing.subject_height_percent < minimum ||
        framing.subject_height_percent > maximum ||
        framing.clear_space_above_hair_percent <
          framing.minimum_clear_space_above_hair_percent ||
        framing.clear_space_below_footwear_percent <
          framing.minimum_clear_space_below_footwear_percent ||
        framing.full_head_visible !== true ||
        framing.full_footwear_visible !== true
      ) {
        framingFailures += 1;
      }
    } else {
      framingFailures += 1;
    }
    if (
      qaReceipt.verdict === 'PASS' &&
      (result.status !== 'PASS' ||
        (result.named_defects?.length ?? 0) > 0 ||
        (result.gate_results ?? []).some((gate) => gate.status !== 'PASS'))
    ) {
      passEvidenceFailures += 1;
    }
  }
  if (gateSetFailures) {
    blockers.push({
      code: 'QA_GATE_SET_INCOMPLETE',
      path: 'qa_receipt.asset_results[].gate_results',
      message: `${gateSetFailures} QA asset result(s) do not contain the exact ordered gate set for ${qaReceipt.qa_profile}.`,
    });
  }
  if (framingFailures) {
    blockers.push({
      code: 'FRAMING_EVIDENCE_OUTSIDE_CONTRACT',
      path: 'qa_receipt.asset_results[].framing_evidence',
      message: `${framingFailures} QA asset result(s) lack valid measured framing evidence.`,
    });
  }
  if (passEvidenceFailures) {
    blockers.push({
      code: 'PASS_VERDICT_CONTRADICTS_ASSET_EVIDENCE',
      path: 'qa_receipt',
      message: `${passEvidenceFailures} asset result(s) contradict the aggregate PASS verdict.`,
    });
  }
}

export function auditQaReceiptEvidence(manifest, qaReceipt) {
  const blockers = [];
  inspectQaCoverage(manifest, qaReceipt, blockers);
  return blockers;
}

async function inspectPrivacyEvidence(
  manifest,
  privacyReport,
  qaReceiptPath,
  blockers,
) {
  const checkedFiles = new Map(
    (privacyReport?.checked_files ?? []).map((entry) => [entry.path, entry.sha256]),
  );
  const excludedPaths = new Set(privacyReport?.excluded_paths ?? []);
  const requiredPaths = new Set([
    'config/scene-presets.json',
    displayPath(qaReceiptPath),
  ]);
  if (Array.isArray(manifest?.assets)) {
    if (manifest.selection_receipt?.path) {
      requiredPaths.add(manifest.selection_receipt.path);
    }
    for (const asset of manifest.assets) {
      requiredPaths.add(asset.file);
      requiredPaths.add(asset.exact_prompt?.path);
      requiredPaths.add(asset.generation?.provider_receipt?.path);
      requiredPaths.add(asset.visual_qa?.path);
      if (asset.human_approval?.receipt_path) {
        requiredPaths.add(asset.human_approval.receipt_path);
      }
      for (const operation of asset.derivation_lineage?.operations ?? []) {
        if (operation.prompt_path) requiredPaths.add(operation.prompt_path);
      }
      for (const source of asset.source_ledger?.sources ?? []) {
        requiredPaths.add(source.snapshot_uri);
        requiredPaths.add(source.rights?.evidence_uri);
      }
    }
  }
  requiredPaths.delete(undefined);

  const excludedRequired = [...requiredPaths].filter((filename) =>
    excludedPaths.has(filename),
  );
  if (excludedRequired.length) {
    blockers.push({
      code: 'PRIVACY_REQUIRED_EVIDENCE_EXCLUDED',
      path: 'privacy_report.excluded_paths',
      message: `${excludedRequired.length} required release evidence file(s) were explicitly excluded from privacy scanning.`,
      evidence: excludedRequired,
    });
  }
  const missingRequired = [...requiredPaths].filter(
    (filename) => !checkedFiles.has(filename),
  );
  if (missingRequired.length) {
    blockers.push({
      code: 'PRIVACY_RELEASE_SCOPE_INCOMPLETE',
      path: 'privacy_report.checked_files',
      message: `${missingRequired.length} required release evidence file(s) are absent from the privacy report.`,
      evidence: missingRequired,
    });
  }

  let staleHashes = 0;
  let unsafePaths = 0;
  for (const [relativePath, expectedHash] of checkedFiles) {
    const filename = resolveRepositoryFile(relativePath);
    if (!filename) {
      unsafePaths += 1;
      continue;
    }
    try {
      if (sha256Buffer(await readFile(filename)) !== expectedHash) {
        staleHashes += 1;
      }
    } catch {
      staleHashes += 1;
    }
  }
  if (unsafePaths) {
    blockers.push({
      code: 'PRIVACY_REPORT_PATH_OUTSIDE_REPOSITORY',
      path: 'privacy_report.checked_files',
      message: `${unsafePaths} privacy-report path(s) escape the repository boundary.`,
    });
  }
  if (staleHashes) {
    blockers.push({
      code: 'PRIVACY_REPORT_HASH_STALE',
      path: 'privacy_report.checked_files',
      message: `${staleHashes} privacy-report file hash(es) no longer match disk.`,
    });
  }
}

export async function validateSceneRelease(options = {}) {
  const paths = {
    catalog: path.resolve(options.catalog ?? defaultPaths.catalog),
    manifest: path.resolve(options.manifest ?? defaultPaths.manifest),
    qaReceipt: path.resolve(options.qaReceipt ?? defaultPaths.qaReceipt),
    privacyReport: path.resolve(options.privacyReport ?? defaultPaths.privacyReport),
  };
  const blockers = [];
  const warnings = [];
  let catalog;
  let manifest;
  let qaReceipt;
  let privacyReport;
  let catalogSha256;

  const catalogValidator = await loadValidator('scene-preset-catalog.schema.json');
  const releaseValidator = await loadValidator(
    'scene-release-manifest.schema.json',
    ['scene-source-ledger.schema.json'],
  );
  const qaValidator = await loadValidator('scene-qa-receipt.schema.json');
  const privacyValidator = await loadValidator('scene-privacy-report.schema.json');

  try {
    const loadedCatalog = await readJsonWithHash(paths.catalog);
    catalog = loadedCatalog.value;
    catalogSha256 = loadedCatalog.sha256;
    if (!catalogValidator(catalog)) {
      blockers.push({
        code: 'CATALOG_SCHEMA_INVALID',
        path: displayPath(paths.catalog),
        message: 'Scene catalog violates its strict contract.',
        evidence: schemaErrors(catalogValidator.errors),
      });
    }
  } catch (error) {
    blockers.push({
      code: 'CATALOG_UNREADABLE',
      path: displayPath(paths.catalog),
      message: error.message,
    });
  }

  const selectedIds = catalog?.launch_selection?.selected_preset_ids ?? [];
  if (catalog) {
    if (catalog.status !== 'APPROVED') {
      blockers.push({
        code: 'CATALOG_NOT_APPROVED',
        path: 'status',
        message: `Catalog status is ${catalog.status ?? 'missing'}, not APPROVED.`,
      });
    }
    if (catalog.release_readiness !== 'READY_FOR_RELEASE') {
      blockers.push({
        code: 'CATALOG_RELEASE_BLOCKED',
        path: 'release_readiness',
        message: `Catalog readiness is ${catalog.release_readiness ?? 'missing'}.`,
      });
    }
    if (
      catalog.launch_selection?.status !== 'APPROVED' ||
      selectedIds.length !== 5 ||
      !onePresetPerFamily(catalog, selectedIds)
    ) {
      blockers.push({
        code: 'FIVE_PRESET_SELECTION_NOT_APPROVED',
        path: 'launch_selection',
        message: 'Launch selection must contain one human-approved winner from each of the five standard families.',
      });
    }
    const blockedModes = catalog.editorial_program?.modes
      ?.filter((mode) => mode.source_set_status !== 'READY')
      .map((mode) => mode.preset_id) ?? [];
    if (blockedModes.length) {
      blockers.push({
        code: 'EDITORIAL_SOURCE_SETS_INCOMPLETE',
        path: 'editorial_program.modes',
        message: `${blockedModes.length} editorial mode(s) still lack the required second source.`,
        evidence: blockedModes,
      });
    }
  }

  try {
    const loadedManifest = await readJsonWithHash(paths.manifest);
    manifest = loadedManifest.value;
    if (!releaseValidator(manifest)) {
      blockers.push({
        code: 'RELEASE_MANIFEST_SCHEMA_INVALID',
        path: displayPath(paths.manifest),
        message: 'Manifest is a mood-card inventory, not a valid immutable scene release manifest.',
        evidence: schemaErrors(releaseValidator.errors),
      });
    }
    const assets = Array.isArray(manifest.assets)
      ? manifest.assets
      : Array.isArray(manifest.files)
        ? manifest.files
        : [];
    if (manifest.asset_count !== assets.length) {
      blockers.push({
        code: 'ASSET_COUNT_MISMATCH',
        path: 'asset_count',
        message: `asset_count=${manifest.asset_count ?? 'missing'} but ${assets.length} asset record(s) exist.`,
      });
    }
    const duplicateFiles = assets
      .map((asset) => asset.file)
      .filter((value, index, values) => value && values.indexOf(value) !== index);
    if (duplicateFiles.length) {
      blockers.push({
        code: 'DUPLICATE_ASSET_FILES',
        path: 'assets[].file',
        message: 'Manifest contains duplicate asset paths.',
        evidence: uniqueValues(duplicateFiles),
      });
    }
    inspectLegacyManifest(manifest, blockers);
    inspectReleaseManifestSemantics(manifest, catalog, blockers);
    inspectAssetRoleCoverage(manifest, selectedIds, blockers);
    await verifyManifestFiles(manifest, blockers);
    await verifyReleaseEvidenceFiles(manifest, blockers);
    if (
      manifest.catalog_snapshot?.catalog_sha256 &&
      manifest.catalog_snapshot.catalog_sha256 !== catalogSha256
    ) {
      blockers.push({
        code: 'CATALOG_SNAPSHOT_HASH_MISMATCH',
        path: 'catalog_snapshot.catalog_sha256',
        message: 'Release manifest is not bound to the exact checked catalog bytes.',
      });
    }
    if (
      Array.isArray(manifest.assets) &&
      manifest.evidence_subject_sha256 !==
        computeReleaseEvidenceSubjectSha256(manifest)
    ) {
      blockers.push({
        code: 'EVIDENCE_SUBJECT_HASH_MISMATCH',
        path: 'evidence_subject_sha256',
        message: 'Release manifest evidence-subject hash does not match its immutable asset evidence.',
      });
    }
  } catch (error) {
    blockers.push({
      code: 'RELEASE_MANIFEST_UNREADABLE',
      path: displayPath(paths.manifest),
      message: error.message,
    });
  }

  try {
    qaReceipt = await readJson(paths.qaReceipt);
    if (!qaValidator(qaReceipt)) {
      blockers.push({
        code: 'QA_RECEIPT_SCHEMA_INVALID',
        path: displayPath(paths.qaReceipt),
        message: 'QA evidence is aggregate and does not satisfy the hash-bound per-asset receipt contract.',
        evidence: schemaErrors(qaValidator.errors),
      });
    }
    if (qaReceipt.verdict !== 'PASS') {
      blockers.push({
        code: 'QA_RECEIPT_NOT_PASS',
        path: 'qa_receipt.verdict',
        message: `QA verdict is ${qaReceipt.verdict ?? 'missing'}, not PASS.`,
      });
    }
    if (
      qaReceipt.evidence_subject_sha256 &&
      qaReceipt.evidence_subject_sha256 !== manifest?.evidence_subject_sha256
    ) {
      blockers.push({
        code: 'QA_EVIDENCE_SUBJECT_HASH_MISMATCH',
        path: 'qa_receipt.evidence_subject_sha256',
        message: 'QA receipt is not bound to the immutable release evidence subject.',
      });
    }
    if (manifest) inspectQaCoverage(manifest, qaReceipt, blockers);
  } catch (error) {
    blockers.push({
      code: 'QA_RECEIPT_UNREADABLE',
      path: displayPath(paths.qaReceipt),
      message: error.message,
    });
  }

  try {
    privacyReport = await readJson(paths.privacyReport);
    if (!privacyValidator(privacyReport)) {
      blockers.push({
        code: 'PRIVACY_REPORT_SCHEMA_INVALID',
        path: displayPath(paths.privacyReport),
        message: 'Privacy report does not prove the complete declared release scope.',
        evidence: schemaErrors(privacyValidator.errors),
      });
    }
    if (privacyReport.status !== 'PASS') {
      blockers.push({
        code: 'PRIVACY_REPORT_NOT_PASS',
        path: 'privacy_report.status',
        message: `Privacy status is ${privacyReport.status ?? 'missing'}, not PASS.`,
      });
    }
    await inspectPrivacyEvidence(manifest, privacyReport, paths.qaReceipt, blockers);
  } catch (error) {
    blockers.push({
      code: 'PRIVACY_REPORT_UNREADABLE',
      path: displayPath(paths.privacyReport),
      message: error.message,
    });
  }

  const result = {
    schema_version: '1.0.0',
    status: blockers.length ? 'FAIL' : 'PASS',
    release_ready: blockers.length === 0,
    checked: {
      catalog: displayPath(paths.catalog),
      manifest: displayPath(paths.manifest),
      qa_receipt: displayPath(paths.qaReceipt),
      privacy_report: displayPath(paths.privacyReport),
    },
    blocker_count: blockers.length,
    blockers,
    warnings,
    completed_at: new Date().toISOString(),
  };
  return result;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = await validateSceneRelease({
      catalog: args.catalog,
      manifest: args.manifest,
      qaReceipt: args['qa-receipt'],
      privacyReport: args['privacy-report'],
    });
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (args.report) await writeFile(path.resolve(args.report), serialized);
    process.stdout.write(serialized);
    if (result.status !== 'PASS') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
