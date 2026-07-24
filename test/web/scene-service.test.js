import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import {
  SCENE_EVALUATOR_GATES,
  SCENE_QA_GATES,
  assessFramingEvidence,
  canonicalJsonBytes,
  sha256,
} from '../../src/web/scene-contract.js';
import { SceneService } from '../../src/web/scene-service.js';

const PRESET_ID = 'std.studio.peach_soft_gloss';
const PRESET_VERSION = '1.0.0';
const PACK_ID = 'pack.studio.peach_soft_gloss';
const PACK_VERSION = '1.0.0';

async function image({ width = 640, height = 800, color = '#315543' } = {}) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  }).png().toBuffer();
}

function passEvaluation(overrides = {}) {
  return {
    gates: SCENE_EVALUATOR_GATES.map((id) => ({
      id,
      decision: overrides[id] ?? 'PASS',
      evidence: overrides[id] === 'FAIL' ? `${id} needs repair` : `${id} verified`,
      defects: overrides[id] === 'FAIL' ? [`${id}_DEFECT`] : [],
    })),
    score: Object.values(overrides).includes('FAIL') ? 72 : 100,
    summary: Object.values(overrides).includes('FAIL') ? 'One blocking defect remains' : 'All visual gates pass',
    reviewer: {
      type: 'MODEL',
      id: 'fixture-scene-judge',
      version: 'fixture-judge-2026-07-23',
      request_id: `fixture-review-${Math.random().toString(16).slice(2)}`,
    },
    framing_evidence: {
      subject_bbox_xywh_px: [200, 103, 620, 973],
      full_head_visible: true,
      full_footwear_visible: true,
    },
  };
}

function providerMetadata(context, bytes, requestId, {
  sourceWidth = 800,
  sourceHeight = 1000,
} = {}) {
  const outputHash = sha256(bytes);
  return {
    provider: 'fixture',
    provider_request_id: requestId,
    request_id: context.idempotency_key,
    job_id: requestId,
    model: context.model,
    model_version: context.model_version,
    job_set_type: context.job_set_type,
    quality: context.quality,
    source_width: sourceWidth,
    source_height: sourceHeight,
    source_aspect_ratio: `${sourceWidth / 200}:${sourceHeight / 200}`,
    raw_output_sha256: outputHash,
    geometry_output_sha256: outputHash,
    transport_aspect_ratio: context.job_set_type === 'gpt_image_2' ? '3:4' : '4:5',
    geometry_strategy: 'provider_exact_4_5',
  };
}

async function fixture(t, {
  generator,
  evaluator,
  maxManualRetries = 2,
  root,
} = {}) {
  const directory = root ?? await mkdtemp(path.join(os.tmpdir(), 'zeely-scenes-'));
  if (!root) t.after(() => rm(directory, { recursive: true, force: true }));

  const lookBytes = await image({ width: 512, height: 640, color: '#f3f0e9' });
  const lookId = 'look_12345678';
  const lookReceipt = {
    schema_version: '1.0.0',
    receipt_type: 'APPROVED_LOOK',
    look_id: lookId,
    decision: 'PASS',
    output: { sha256: sha256(lookBytes) },
    qa: { identity: 'PASS', item_fidelity: 'PASS' },
    created_at: '2026-07-23T08:00:00.000Z',
  };
  const lookReceiptBytes = canonicalJsonBytes(lookReceipt);
  const preset = {
    preset_id: PRESET_ID,
    version: PRESET_VERSION,
    family: 'light_studio',
    ui_name_uk: 'Студія — персиковий софт',
    source_authorities: [
      {
        url: 'https://example.test/licensed/source-a',
        role: 'environment_and_composition_inspiration',
        use: 'Environment scale and material observations only',
        not_authority_for: ['identity', 'body', 'hair', 'outfit', 'brands', 'readable_text', 'exact_architecture'],
      },
      {
        url: 'https://example.test/licensed/source-b',
        role: 'lighting_composition_palette_inspiration',
        use: 'Lighting direction and palette observations only',
        not_authority_for: ['identity', 'body', 'hair', 'outfit', 'brands', 'readable_text', 'exact_architecture'],
      },
    ],
    environment: 'An original empty dusty-peach seamless cyclorama with a clean floor-to-wall transition and no props.',
    lighting: {
      time_or_setup: 'large studio softbox',
      key: 'large softbox thirty-five to forty-five degrees from camera with smooth falloff',
      fill: 'weak frontal fill plus subtle floor bounce',
      finish: 'polished_editorial_gloss_without_skin_smoothing_or_hdr',
      protected_regions: ['eyes', 'lips', 'face_identity', 'item_logos', 'item_text', 'critical_construction'],
    },
    camera: {
      aspect_ratio: '4:5',
      lens_mm: 65,
      height: 'eye_level',
      subject_height_percent: [74, 78],
      minimum_clear_space_percent: { above_hair: 8, below_footwear: 2 },
      max_vertical_error_deg: 1,
    },
    palette: ['dusty peach', 'warm ivory', 'cocoa'],
    hard_negatives: ['invented text', 'extra accessories', 'plastic skin', 'background blotches'],
    prompt_path: `prompts/scenes/${PRESET_ID}.txt`,
    mvp_assets: ['mood_card'],
    post_selection_assets: ['environment_plate', 'lighting_preview'],
  };
  const presetBytes = canonicalJsonBytes(preset);
  const prompt = Buffer.from('Create an original peach fashion studio scene with a clean cyclorama.\n');
  const roleAssets = await Promise.all([
    ['environment', 'environment_anchor', '#e8b6a2'],
    ['lighting', 'lighting_anchor', '#f7d9c4'],
    ['composition', 'composition_anchor', '#d5a18d'],
    ['palette', 'palette_anchor', '#efc2ad'],
    ['negative', 'negative_reference', '#222222'],
  ].map(async ([referenceId, role, color]) => {
    const bytes = await image({ width: 320, height: 400, color });
    return {
      reference_id: referenceId,
      role,
      media_type: 'image/png',
      data: bytes,
      sha256: sha256(bytes),
    };
  }));
  const referencePack = {
    schema_version: '1.0.0',
    reference_pack_id: PACK_ID,
    version: PACK_VERSION,
    preset_id: PRESET_ID,
    preset_version: PRESET_VERSION,
    preset_sha256: sha256(presetBytes),
    prompt_sha256: sha256(prompt),
    references: roleAssets.map((asset) => ({
      reference_id: asset.reference_id,
      role: asset.role,
      sha256: asset.sha256,
      media_type: asset.media_type,
      not_authority_for: ['identity', 'body', 'hair', 'outfit'],
    })),
    source_ledger: {
      schema_version: '1.0.0',
      ledger_id: 'ledger.studio.peach.fixture',
      revision: 1,
      preset_id: PRESET_ID,
      preset_version: PRESET_VERSION,
      status: 'VERIFIED_FOR_RELEASE',
      sources: [
        {
          source_id: 'source-a',
          url: 'https://example.test/licensed/source-a',
          role: 'environment_and_composition_inspiration',
          use: 'Environment scale and material observations only',
          not_authority_for: ['identity', 'body', 'hair', 'outfit', 'brands', 'readable_text', 'exact_architecture'],
          retrieved_at: '2026-07-23T08:00:00.000Z',
          snapshot_uri: 'evidence/source-a.html',
          content_sha256: 'a'.repeat(64),
          rights: {
            status: 'VERIFIED',
            basis: 'LICENSED',
            rights_holder: 'Fixture Licensor A',
            evidence_uri: 'evidence/source-a-rights.json',
            evidence_sha256: 'c'.repeat(64),
            verified_at: '2026-07-23T08:01:00.000Z',
          },
        },
        {
          source_id: 'source-b',
          url: 'https://example.test/licensed/source-b',
          role: 'lighting_composition_palette_inspiration',
          use: 'Lighting direction and palette observations only',
          not_authority_for: ['identity', 'body', 'hair', 'outfit', 'brands', 'readable_text', 'exact_architecture'],
          retrieved_at: '2026-07-23T08:02:00.000Z',
          snapshot_uri: 'evidence/source-b.html',
          content_sha256: 'b'.repeat(64),
          rights: {
            status: 'VERIFIED',
            basis: 'OWNED',
            rights_holder: 'Fixture Rights Holder B',
            evidence_uri: 'evidence/source-b-rights.json',
            evidence_sha256: 'd'.repeat(64),
            verified_at: '2026-07-23T08:03:00.000Z',
          },
        },
      ],
      created_at: '2026-07-23T08:04:00.000Z',
    },
  };
  const referencePackBytes = canonicalJsonBytes(referencePack);
  const calls = {
    lookResolver: 0,
    presetResolver: 0,
    generator: [],
    evaluator: [],
  };
  const generatedImage = await image({ width: 800, height: 1000, color: '#c79782' });
  const dependencies = {
    approvedLookResolver: {
      async resolveApprovedLook() {
        calls.lookResolver += 1;
        return { look_id: lookId, image: lookBytes, receipt: lookReceiptBytes };
      },
    },
    presetResolver: {
      async resolveScenePreset() {
        calls.presetResolver += 1;
        return {
          preset,
          preset_bytes: presetBytes,
          prompt,
          reference_pack: referencePack,
          reference_pack_bytes: referencePackBytes,
          assets: roleAssets,
        };
      },
    },
    generator: generator ?? {
      async generateScene(context) {
        calls.generator.push(context);
        return {
          image: generatedImage,
          media_type: 'image/png',
          metadata: providerMetadata(context, generatedImage, `request-${context.attempt}`),
        };
      },
    },
    evaluator: evaluator ?? {
      async evaluateScene(context) {
        calls.evaluator.push(context);
        return passEvaluation();
      },
    },
  };
  const service = new SceneService({
    rootDirectory: directory,
    ...dependencies,
    maxManualRetries,
  });
  await service.initialize();
  const request = {
    idempotencyKey: 'scene-request-0001',
    approvedLookReference: {
      look_id: lookId,
      image_sha256: sha256(lookBytes),
      receipt_sha256: sha256(lookReceiptBytes),
    },
    presetReference: {
      preset_id: PRESET_ID,
      preset_version: PRESET_VERSION,
      preset_sha256: sha256(presetBytes),
      reference_pack_id: PACK_ID,
      reference_pack_version: PACK_VERSION,
      reference_pack_sha256: sha256(referencePackBytes),
      prompt_sha256: sha256(prompt),
    },
  };
  return {
    root: directory,
    service,
    request,
    calls,
    dependencies,
    documents: { lookBytes, lookReceipt, lookReceiptBytes, preset, presetBytes, prompt, referencePack, referencePackBytes, roleAssets },
  };
}

async function waitFor(service, sceneId) {
  const running = service.running.get(sceneId);
  if (running) await running;
  return service.getScene(sceneId);
}

async function waitForTerminal(services, sceneId, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const service of services) {
      const state = await service.getScene(sceneId);
      if (state && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(state.status)) return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${sceneId}`);
}

async function waitForSceneServicesIdle(services, sceneId) {
  const pending = services
    .map((service) => service.running.get(sceneId))
    .filter(Boolean);
  const results = await Promise.allSettled(pending);
  const rejected = results.find((result) => result.status === 'rejected');
  if (rejected) throw rejected.reason;
}

async function rewriteLegacyFramingFailure(service, sceneId, attemptNumber, bbox) {
  const state = JSON.parse(await readFile(service.statePath(sceneId), 'utf8'));
  const attempt = state.attempts.find((item) => item.number === attemptNumber);
  assert.ok(attempt, `attempt ${attemptNumber} must exist`);
  const framing = assessFramingEvidence({
    subject_bbox_xywh_px: bbox,
    full_head_visible: true,
    full_footwear_visible: true,
  }, {
    width: 1024,
    height: 1280,
    expectedSubjectHeightPercent: [74, 78],
  }).evidence;
  attempt.qa.framing_evidence = framing;
  if (state.attempts.at(-1).number === attemptNumber) {
    state.qa = {
      ...state.qa,
      framing_evidence: framing,
      reviewer: attempt.qa.reviewer,
    };
  }
  const stateBytes = Buffer.from(`${JSON.stringify(state, null, 2)}\n`);
  const attemptBytes = Buffer.from(`${JSON.stringify(attempt, null, 2)}\n`);
  await Promise.all([
    writeFile(service.statePath(sceneId), stateBytes),
    writeFile(
      path.join(service.attemptDirectory(sceneId, attemptNumber), 'attempt.json'),
      attemptBytes,
    ),
  ]);
  return { state, attempt, framing };
}

function postReleaseRejection(outputSha256, overrides = {}) {
  return {
    idempotencyKey: 'post-release-rejection-0001',
    expectedOutputSha256: outputSha256,
    gateId: 'SCENE_MATCH',
    evidence: 'The released environment does not match the approved scene direction.',
    defects: ['ENVIRONMENT_DIRECTION_MISMATCH'],
    reviewer: {
      type: 'HUMAN',
      id: 'production-art-director',
      version: 'art-review-policy-2026-07-23',
      request_id: 'human-review-0001',
    },
    ...overrides,
  };
}

test('creates one immutable scene, normalizes it to exact 4:5, and releases only after all nine gates pass', async (t) => {
  const { root, service, request, calls } = await fixture(t);
  const created = await service.createScene(request);
  assert.equal(created.status, 'QUEUED');
  const completed = await waitFor(service, created.scene_id);
  assert.equal(completed.status, 'COMPLETED', JSON.stringify(completed, null, 2));
  assert.equal(completed.phase, 'COMPLETED');
  assert.deepEqual(completed.qa.gates.map((gate) => gate.id), SCENE_QA_GATES);
  assert.ok(completed.qa.gates.every((gate) => gate.decision === 'PASS'));
  assert.equal(completed.qa.score, 100);
  assert.equal(calls.generator.length, 1);
  assert.equal(calls.generator[0].aspect_ratio, '4:5');
  assert.equal(calls.generator[0].width, 1024);
  assert.equal(calls.generator[0].height, 1280);
  assert.equal(calls.generator[0].model_version, 'gpt_image_2');
  assert.equal(calls.generator[0].approved_look.sha256, request.approvedLookReference.image_sha256);
  assert.equal(calls.generator[0].references.length, 5);
  assert.equal(calls.evaluator[0].references.length, 5);
  assert.deepEqual(calls.evaluator[0].required_gates, SCENE_EVALUATOR_GATES);

  const outputPath = await service.outputFile(created.scene_id);
  const outputMetadata = await sharp(outputPath).metadata();
  assert.deepEqual([outputMetadata.width, outputMetadata.height, outputMetadata.format], [1024, 1280, 'png']);
  assert.equal(sha256(await readFile(outputPath)), completed.output.sha256);
  const manifestPath = await service.outputFile(created.scene_id, 'scene-manifest.json');
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(sha256(manifestBytes), completed.output.manifest_sha256);
  assert.equal(manifest.approved_look.sha256, request.approvedLookReference.image_sha256);
  assert.equal(manifest.preset.sha256, request.presetReference.preset_sha256);
  assert.equal(manifest.reference_pack.sha256, request.presetReference.reference_pack_sha256);
  assert.equal(manifest.reference_pack.source_ledger.sources.length, 2);
  assert.equal(manifest.generation.model_version, 'gpt_image_2');
  assert.equal(manifest.prompt.sha256, sha256(Buffer.from(manifest.prompt.exact_text)));
  assert.deepEqual(manifest.qa.gates.map((gate) => gate.id), SCENE_QA_GATES);
  const evidencePath = await service.outputFile(created.scene_id, 'scene-evidence-manifest.json');
  const qaReceiptPath = await service.outputFile(created.scene_id, 'scene-qa-receipt.json');
  const privacyReportPath = await service.outputFile(created.scene_id, 'scene-privacy-report.json');
  const evidenceBytes = await readFile(evidencePath);
  const qaReceiptBytes = await readFile(qaReceiptPath);
  const privacyReportBytes = await readFile(privacyReportPath);
  const qaReceipt = JSON.parse(qaReceiptBytes);
  const privacyReport = JSON.parse(privacyReportBytes);
  assert.equal(manifest.evidence_manifest.sha256, sha256(evidenceBytes));
  assert.equal(manifest.qa_receipt.sha256, sha256(qaReceiptBytes));
  assert.equal(manifest.qa_receipt.evidence_subject_sha256, sha256(evidenceBytes));
  assert.equal(qaReceipt.evidence_subject_sha256, sha256(evidenceBytes));
  assert.equal(qaReceipt.asset_results[0].sha256, completed.output.sha256);
  assert.deepEqual(qaReceipt.asset_results[0].gate_results.map((gate) => gate.id), SCENE_QA_GATES);
  assert.equal(manifest.privacy_report.sha256, sha256(privacyReportBytes));
  assert.equal(privacyReport.status, 'PASS');
  assert.deepEqual(privacyReport.findings, []);
  assert.doesNotMatch(JSON.stringify(completed), /inputs\/|attempts\/|private-path|exact_text/);

  const sourceLedgerSchema = JSON.parse(await readFile(path.resolve('schemas/scene-source-ledger.schema.json'), 'utf8'));
  const manifestSchema = JSON.parse(await readFile(path.resolve('schemas/scene-production-receipt.schema.json'), 'utf8'));
  const manifestAjv = new Ajv2020({ strict: false, validateFormats: false });
  manifestAjv.addSchema(sourceLedgerSchema);
  const validateManifest = manifestAjv.compile(manifestSchema);
  assert.equal(validateManifest(manifest), true, JSON.stringify({
    errors: validateManifest.errors,
    urls: manifest.reference_pack.source_ledger.sources.map((source) => source.url),
  }, null, 2));
  const qaSchema = JSON.parse(await readFile(path.resolve('schemas/scene-qa-receipt.schema.json'), 'utf8'));
  const privacySchema = JSON.parse(await readFile(path.resolve('schemas/scene-privacy-report.schema.json'), 'utf8'));
  assert.equal(
    new Ajv2020({ strict: false, validateFormats: false }).compile(qaSchema)(qaReceipt),
    true,
  );
  assert.equal(
    new Ajv2020({ strict: false, validateFormats: false }).compile(privacySchema)(privacyReport),
    true,
  );

  const schema = JSON.parse(await readFile(path.resolve('schemas/scene-job.schema.json'), 'utf8'));
  const state = JSON.parse(await readFile(path.join(root, created.scene_id, 'scene.json'), 'utf8'));
  const jobAjv = new Ajv2020({ strict: false, validateFormats: false });
  jobAjv.addSchema(sourceLedgerSchema);
  const validate = jobAjv.compile(schema);
  assert.equal(validate(state), true, JSON.stringify(validate.errors, null, 2));
  for (const mutate of [
    (copy) => { copy.bindings.prompt.relative_path = '../../private.txt'; },
    (copy) => { copy.delivery.height = 999; },
    (copy) => {
      copy.model_route.entries[0].job_set_type = 'runway';
      copy.model_route.entries[0].model_version = 'latest';
      copy.model_route.entries[0].quality = 'low';
    },
    (copy) => { copy.attempts = ['garbage']; },
    (copy) => { copy.updated_at = 'never'; },
  ]) {
    const adversarial = structuredClone(state);
    mutate(adversarial);
    assert.equal(validate(adversarial), false, 'adversarial persisted scene must fail the strict schema');
  }

  const packSchema = JSON.parse(await readFile(path.resolve('schemas/scene-reference-pack.schema.json'), 'utf8'));
  const packAjv = new Ajv2020({ strict: false, validateFormats: false });
  packAjv.addSchema(sourceLedgerSchema);
  const validatePack = packAjv.compile(packSchema);
  const storedPack = JSON.parse(await readFile(path.join(root, created.scene_id, 'inputs/reference-pack.json'), 'utf8'));
  assert.equal(validatePack(storedPack), true, JSON.stringify(validatePack.errors, null, 2));

  const lookSchema = JSON.parse(await readFile(path.resolve('schemas/scene-approved-look-receipt.schema.json'), 'utf8'));
  const validateLook = new Ajv2020({ strict: false }).compile(lookSchema);
  const storedLookReceipt = JSON.parse(await readFile(path.join(root, created.scene_id, 'inputs/approved-look-receipt.json'), 'utf8'));
  assert.equal(validateLook(storedLookReceipt), true, JSON.stringify(validateLook.errors, null, 2));
});

test('post-release rejection is stale-hash guarded, append-only, idempotent, and quarantines every original PASS receipt', async (t) => {
  const current = await fixture(t);
  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'post-release-rejection-source',
  });
  const completed = await waitFor(current.service, created.scene_id);
  assert.equal(completed.status, 'COMPLETED');
  const stateBefore = JSON.parse(await readFile(current.service.statePath(created.scene_id), 'utf8'));
  const originalAttempt = structuredClone(stateBefore.attempts.at(-1));
  const originalArtifacts = {};
  for (const name of [
    'scene.png',
    'scene-manifest.json',
    'scene-evidence-manifest.json',
    'scene-qa-receipt.json',
    'scene-privacy-report.json',
  ]) {
    originalArtifacts[name] = await readFile(
      path.join(current.service.sceneDirectory(created.scene_id), 'outputs', name),
    );
  }

  await assert.rejects(
    () => current.service.rejectCompletedScene(
      created.scene_id,
      postReleaseRejection('f'.repeat(64), { idempotencyKey: 'stale-rejection-token' }),
    ),
    (error) => error.code === 'SCENE_REJECTION_STALE_OUTPUT' && error.statusCode === 409,
  );
  await assert.rejects(
    () => current.service.rejectCompletedScene(
      created.scene_id,
      postReleaseRejection(completed.output.sha256, {
        idempotencyKey: 'invalid-gate-rejection',
        gateId: 'PROVENANCE',
      }),
    ),
    /six visual scene QA gates/,
  );

  const request = postReleaseRejection(completed.output.sha256);
  const rejected = await current.service.rejectCompletedScene(created.scene_id, request);
  assert.equal(rejected.status, 'FAILED');
  assert.equal(rejected.phase, 'POST_RELEASE_REJECTED');
  assert.equal(rejected.error.code, 'POST_RELEASE_REJECTED');
  assert.equal(rejected.output, null);
  assert.equal(await current.service.outputFile(created.scene_id), null);
  await assert.rejects(
    () => readdir(path.join(current.service.sceneDirectory(created.scene_id), 'outputs')),
    (error) => error.code === 'ENOENT',
  );

  const receiptDirectory = path.join(
    current.service.sceneDirectory(created.scene_id),
    'rejections',
    'receipts',
  );
  const [receiptName] = await readdir(receiptDirectory);
  const receiptBytes = await readFile(path.join(receiptDirectory, receiptName));
  const receipt = JSON.parse(receiptBytes);
  const [ledgerName] = await readdir(path.join(
    current.service.sceneDirectory(created.scene_id),
    'rejections',
    'ledger',
  ));
  const ledgerBytes = await readFile(path.join(
    current.service.sceneDirectory(created.scene_id),
    'rejections',
    'ledger',
    ledgerName,
  ));
  const ledger = JSON.parse(ledgerBytes);
  assert.equal(receipt.decision, 'REJECTED');
  assert.equal(receipt.rejected_release.output.sha256, completed.output.sha256);
  assert.equal(receipt.rejected_release.attempt, originalAttempt.number);
  assert.equal(receipt.repair_source.sha256, completed.output.sha256);
  assert.equal(ledger.receipt_sha256, sha256(receiptBytes));
  assert.equal(ledger.previous_entry_sha256, null);

  const receiptSchema = JSON.parse(await readFile(
    path.resolve('schemas/scene-rejection-receipt.schema.json'),
    'utf8',
  ));
  const ledgerSchema = JSON.parse(await readFile(
    path.resolve('schemas/scene-rejection-ledger-entry.schema.json'),
    'utf8',
  ));
  assert.equal(
    new Ajv2020({ strict: false, validateFormats: false }).compile(receiptSchema)(receipt),
    true,
  );
  assert.equal(
    new Ajv2020({ strict: false, validateFormats: false }).compile(ledgerSchema)(ledger),
    true,
  );

  const stateAfter = JSON.parse(await readFile(current.service.statePath(created.scene_id), 'utf8'));
  assert.deepEqual(stateAfter.attempts.at(-1), originalAttempt, 'the original QA_PASS attempt is immutable');
  assert.equal(stateAfter.attempts.at(-1).status, 'QA_PASS');
  const quarantineOutput = path.join(
    current.service.sceneDirectory(created.scene_id),
    receipt.quarantine_relative_path,
    'outputs',
  );
  for (const [name, bytes] of Object.entries(originalArtifacts)) {
    assert.deepEqual(await readFile(path.join(quarantineOutput, name)), bytes);
  }

  const replay = await current.service.rejectCompletedScene(created.scene_id, request);
  assert.equal(replay.status, 'FAILED');
  assert.deepEqual(await readdir(receiptDirectory), [receiptName]);
  await assert.rejects(
    () => current.service.rejectCompletedScene(created.scene_id, {
      ...request,
      evidence: 'A different payload cannot reuse the same idempotency key.',
    }),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT' && error.statusCode === 409,
  );
});

test('restart treats the immutable rejection ledger as a fail-closed deny marker and completes interrupted quarantine', async (t) => {
  const current = await fixture(t);
  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'rejection-restart-source',
  });
  const completed = await waitFor(current.service, created.scene_id);
  const sceneDirectory = current.service.sceneDirectory(created.scene_id);
  const completedState = await readFile(current.service.statePath(created.scene_id));
  await current.service.rejectCompletedScene(
    created.scene_id,
    postReleaseRejection(completed.output.sha256, {
      idempotencyKey: 'rejection-restart-marker',
    }),
  );
  const [receiptName] = await readdir(path.join(sceneDirectory, 'rejections', 'receipts'));
  const receipt = JSON.parse(await readFile(path.join(
    sceneDirectory,
    'rejections',
    'receipts',
    receiptName,
  )));
  await rename(
    path.join(sceneDirectory, receipt.quarantine_relative_path, 'outputs'),
    path.join(sceneDirectory, 'outputs'),
  );
  await writeFile(current.service.statePath(created.scene_id), completedState);
  assert.equal(
    await current.service.outputFile(created.scene_id),
    null,
    'the committed ledger denies output before state reconciliation finishes',
  );

  const restarted = new SceneService({
    rootDirectory: current.root,
    ...current.dependencies,
  });
  await restarted.initialize();
  const denied = await restarted.getScene(created.scene_id);
  assert.equal(denied.status, 'FAILED');
  assert.equal(denied.error.code, 'POST_RELEASE_REJECTED');
  assert.equal(await restarted.outputFile(created.scene_id), null);
  assert.ok(await readFile(path.join(
    sceneDirectory,
    receipt.repair_source.relative_path,
  )));
  await assert.rejects(
    () => readdir(path.join(sceneDirectory, 'outputs')),
    (error) => error.code === 'ENOENT',
  );
});

test('one post-release repair cycle bypasses the manual limit, uses the exact quarantined source, runs full QA, and records supersession', async (t) => {
  const original = await image({ width: 800, height: 1000, color: '#c79782' });
  const repaired = await image({ width: 800, height: 1000, color: '#ceb09c' });
  const generatorCalls = [];
  const current = await fixture(t, {
    maxManualRetries: 0,
    generator: {
      async generateScene(context) {
        generatorCalls.push(context);
        const bytes = context.attempt === 1 ? original : repaired;
        return {
          image: bytes,
          media_type: 'image/png',
          metadata: providerMetadata(context, bytes, `post-release-repair-${context.attempt}`),
        };
      },
    },
  });
  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'post-release-repair-source',
  });
  const firstRelease = await waitFor(current.service, created.scene_id);
  assert.equal(firstRelease.status, 'COMPLETED');
  const rejection = postReleaseRejection(firstRelease.output.sha256, {
    idempotencyKey: 'post-release-repair-rejection',
    gateId: 'LIGHT_AND_CONTACT_SHADOW',
    evidence: 'The contact shadow direction contradicts the approved key light.',
    defects: ['CONTACT_SHADOW_DIRECTION'],
  });
  await current.service.rejectCompletedScene(created.scene_id, rejection);
  const queued = await current.service.retryScene(created.scene_id, {
    idempotencyKey: 'post-release-repair-cycle',
  });
  assert.equal(queued.status, 'QUEUED');
  assert.equal(queued.execution.manual_retries, 0);
  const repairedRelease = await waitFor(current.service, created.scene_id);
  assert.equal(repairedRelease.status, 'COMPLETED', JSON.stringify(repairedRelease, null, 2));
  assert.notEqual(repairedRelease.output.sha256, firstRelease.output.sha256);
  assert.equal(repairedRelease.execution.cycle, 2);
  assert.equal(repairedRelease.execution.manual_retries, 0);
  assert.equal(generatorCalls.length, 2);
  assert.equal(current.calls.evaluator.length, 2, 'the changed repair must run all visual QA gates');
  assert.deepEqual(generatorCalls[1].required_gates, undefined);
  assert.equal(generatorCalls[1].repair_candidate.sha256, firstRelease.output.sha256);
  assert.equal(
    sha256(await readFile(generatorCalls[1].repair_candidate.path)),
    firstRelease.output.sha256,
  );
  assert.match(generatorCalls[1].prompt, /REPAIR MODE/);
  assert.match(generatorCalls[1].prompt, /CONTACT_SHADOW_DIRECTION/);

  const state = JSON.parse(await readFile(current.service.statePath(created.scene_id), 'utf8'));
  assert.equal(state.attempts[0].status, 'QA_PASS');
  assert.equal(state.attempts[1].status, 'QA_PASS');
  assert.equal(
    state.attempts[1].provider_metadata.repair_candidate_sha256,
    firstRelease.output.sha256,
  );
  const manifest = JSON.parse(await readFile(
    await current.service.outputFile(created.scene_id, 'scene-manifest.json'),
    'utf8',
  ));
  const [receiptName] = await readdir(path.join(
    current.service.sceneDirectory(created.scene_id),
    'rejections',
    'receipts',
  ));
  const rejectionReceiptBytes = await readFile(path.join(
    current.service.sceneDirectory(created.scene_id),
    'rejections',
    'receipts',
    receiptName,
  ));
  const rejectionReceipt = JSON.parse(rejectionReceiptBytes);
  assert.deepEqual(manifest.supersedes, {
    rejection_id: rejectionReceipt.rejection_id,
    rejection_receipt_sha256: sha256(rejectionReceiptBytes),
    rejected_output_sha256: firstRelease.output.sha256,
    rejected_manifest_sha256: rejectionReceipt.rejected_release.output.manifest_sha256,
    source_attempt: 1,
    repaired_by_attempt: 2,
  });
  assert.equal(
    manifest.generation.provider_metadata.rejection_receipt_sha256,
    sha256(rejectionReceiptBytes),
  );
  const sourceLedgerSchema = JSON.parse(await readFile(
    path.resolve('schemas/scene-source-ledger.schema.json'),
    'utf8',
  ));
  const productionSchema = JSON.parse(await readFile(
    path.resolve('schemas/scene-production-receipt.schema.json'),
    'utf8',
  ));
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  ajv.addSchema(sourceLedgerSchema);
  const validate = ajv.compile(productionSchema);
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors, null, 2));
  const missingSupersession = structuredClone(manifest);
  delete missingSupersession.supersedes;
  assert.equal(validate(missingSupersession), false, 'repair metadata cannot omit supersession lineage');
  const missingRejectionBinding = structuredClone(manifest);
  delete missingRejectionBinding.generation.provider_metadata.rejection_receipt_sha256;
  assert.equal(validate(missingRejectionBinding), false, 'supersession cannot omit its rejection receipt binding');
  const jobSchema = JSON.parse(await readFile(
    path.resolve('schemas/scene-job.schema.json'),
    'utf8',
  ));
  const jobAjv = new Ajv2020({ strict: false, validateFormats: false });
  jobAjv.addSchema(sourceLedgerSchema);
  const validateJob = jobAjv.compile(jobSchema);
  assert.equal(validateJob(state), true, JSON.stringify(validateJob.errors, null, 2));

  await current.service.rejectCompletedScene(
    created.scene_id,
    postReleaseRejection(repairedRelease.output.sha256, {
      idempotencyKey: 'post-release-second-rejection',
      gateId: 'ITEM_FIDELITY',
      evidence: 'A second independent review found a product-detail mismatch.',
      defects: ['PRODUCT_DETAIL_MISMATCH'],
      reviewer: {
        type: 'HUMAN',
        id: 'production-art-director',
        version: 'art-review-policy-2026-07-23',
        request_id: 'human-review-0002',
      },
    }),
  );
  const ledgerDirectory = path.join(
    current.service.sceneDirectory(created.scene_id),
    'rejections',
    'ledger',
  );
  const ledgerNames = (await readdir(ledgerDirectory)).sort();
  assert.deepEqual(ledgerNames, ['000001.json', '000002.json']);
  const firstLedgerBytes = await readFile(path.join(ledgerDirectory, ledgerNames[0]));
  const secondLedger = JSON.parse(await readFile(path.join(ledgerDirectory, ledgerNames[1])));
  assert.equal(secondLedger.sequence, 2);
  assert.equal(secondLedger.previous_entry_sha256, sha256(firstLedgerBytes));
  assert.equal(secondLedger.rejected_output_sha256, repairedRelease.output.sha256);
});

test('byte-identical post-release repairs are rejected across the route and cannot consume a second repair cycle', async (t) => {
  const unchanged = await image({ width: 800, height: 1000, color: '#c79782' });
  let generatorCalls = 0;
  const current = await fixture(t, {
    maxManualRetries: 0,
    generator: {
      async generateScene(context) {
        generatorCalls += 1;
        return {
          image: unchanged,
          media_type: 'image/png',
          metadata: providerMetadata(context, unchanged, `identical-repair-${context.attempt}`),
        };
      },
    },
  });
  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'identical-repair-source',
  });
  const released = await waitFor(current.service, created.scene_id);
  await current.service.rejectCompletedScene(
    created.scene_id,
    postReleaseRejection(released.output.sha256, {
      idempotencyKey: 'identical-repair-rejection',
    }),
  );
  await current.service.retryScene(created.scene_id, {
    idempotencyKey: 'identical-repair-cycle',
  });
  const failed = await waitFor(current.service, created.scene_id);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.phase, 'GENERATION_EXHAUSTED');
  assert.equal(failed.output, null);
  assert.equal(generatorCalls, 4, 'one original generation plus the fixed three-model repair route');
  assert.equal(current.calls.evaluator.length, 1, 'byte-identical outputs never masquerade as a new QA result');
  const state = JSON.parse(await readFile(current.service.statePath(created.scene_id), 'utf8'));
  assert.equal(state.attempts[0].status, 'QA_PASS');
  assert.deepEqual(
    state.attempts.slice(1).map((attempt) => attempt.error?.code),
    Array(3).fill('REPAIR_OUTPUT_IDENTICAL_TO_REJECTED_RELEASE'),
  );
  await assert.rejects(
    () => current.service.retryScene(created.scene_id, {
      idempotencyKey: 'identical-repair-second-cycle',
    }),
    (error) => error.code === 'SCENE_REJECTION_REPAIR_CONSUMED' && error.statusCode === 409,
  );
});

test('post-release QA infrastructure can recheck the preserved repair without opening a second generation cycle', async (t) => {
  const original = await image({ width: 800, height: 1000, color: '#c79782' });
  const repaired = await image({ width: 800, height: 1000, color: '#d1b5a2' });
  let generatorCalls = 0;
  let evaluatorCalls = 0;
  const current = await fixture(t, {
    maxManualRetries: 0,
    generator: {
      async generateScene(context) {
        generatorCalls += 1;
        const bytes = context.attempt === 1 ? original : repaired;
        return {
          image: bytes,
          media_type: 'image/png',
          metadata: providerMetadata(context, bytes, `qa-recheck-${context.attempt}`),
        };
      },
    },
    evaluator: {
      async evaluateScene() {
        evaluatorCalls += 1;
        const result = passEvaluation();
        if (evaluatorCalls >= 2 && evaluatorCalls <= 4) {
          result.framing_evidence.full_head_visible = 'true';
        }
        return result;
      },
    },
  });
  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'post-release-qa-recheck-source',
  });
  const released = await waitFor(current.service, created.scene_id);
  await current.service.rejectCompletedScene(
    created.scene_id,
    postReleaseRejection(released.output.sha256, {
      idempotencyKey: 'post-release-qa-recheck-rejection',
    }),
  );
  await current.service.retryScene(created.scene_id, {
    idempotencyKey: 'post-release-qa-recheck-generation',
  });
  const qaFailed = await waitFor(current.service, created.scene_id);
  assert.equal(qaFailed.status, 'FAILED');
  assert.equal(qaFailed.error.code, 'QA_INFRASTRUCTURE_FAILED');
  assert.equal(generatorCalls, 2);
  assert.equal(evaluatorCalls, 4);

  const queued = await current.service.retryScene(created.scene_id, {
    idempotencyKey: 'post-release-qa-recheck-only',
  });
  assert.equal(queued.status, 'QUEUED');
  assert.equal(queued.execution.cycle, 2);
  assert.equal(queued.execution.manual_retries, 0);
  const completed = await waitFor(current.service, created.scene_id);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(generatorCalls, 2, 'QA-only recovery must not invoke another image model');
  assert.equal(evaluatorCalls, 5);
  assert.equal(completed.execution.cycle, 2);
});

test('a tampered quarantined rejection source fails closed before repair generation', async (t) => {
  const current = await fixture(t, { maxManualRetries: 0 });
  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'tampered-rejection-source',
  });
  const released = await waitFor(current.service, created.scene_id);
  await current.service.rejectCompletedScene(
    created.scene_id,
    postReleaseRejection(released.output.sha256, {
      idempotencyKey: 'tampered-rejection-receipt',
    }),
  );
  const [receiptName] = await readdir(path.join(
    current.service.sceneDirectory(created.scene_id),
    'rejections',
    'receipts',
  ));
  const receipt = JSON.parse(await readFile(path.join(
    current.service.sceneDirectory(created.scene_id),
    'rejections',
    'receipts',
    receiptName,
  )));
  await writeFile(
    path.join(
      current.service.sceneDirectory(created.scene_id),
      receipt.repair_source.relative_path,
    ),
    Buffer.from('tampered'),
  );
  await assert.rejects(
    () => current.service.retryScene(created.scene_id, {
      idempotencyKey: 'tampered-rejection-repair',
    }),
    (error) => error.code === 'BOUND_INPUT_INTEGRITY_FAILED' && error.statusCode === 409,
  );
  assert.equal(current.calls.generator.length, 1);
});

test('concurrent create is idempotent and a reused key cannot be rebound to different hashes', async (t) => {
  const { service, request, calls } = await fixture(t);
  const [first, replay] = await Promise.all([
    service.createScene(request),
    service.createScene(request),
  ]);
  assert.equal(first.scene_id, replay.scene_id);
  await waitFor(service, first.scene_id);
  assert.equal(calls.lookResolver, 1);
  assert.equal(calls.presetResolver, 1);
  assert.equal(calls.generator.length, 1);

  const completedReplay = await service.createScene(request);
  assert.equal(completedReplay.status, 'COMPLETED');
  assert.equal(calls.generator.length, 1);
  await assert.rejects(
    () => service.createScene({
      ...request,
      presetReference: {
        ...request.presetReference,
        prompt_sha256: 'f'.repeat(64),
      },
    }),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT' && error.statusCode === 409,
  );
});

test('separate scene requests for the same look and preset receive distinct restart-stable provider operation keys', async (t) => {
  const { service, request, calls } = await fixture(t);
  const first = await service.createScene({
    ...request,
    idempotencyKey: 'same-look-scene-a',
  });
  await waitFor(service, first.scene_id);
  const second = await service.createScene({
    ...request,
    idempotencyKey: 'same-look-scene-b',
  });
  await waitFor(service, second.scene_id);

  assert.notEqual(first.scene_id, second.scene_id);
  assert.equal(calls.generator.length, 2);
  assert.notEqual(
    calls.generator[0].idempotency_key,
    calls.generator[1].idempotency_key,
    'provider journals from separate scenes must never alias',
  );

  const reloaded = new SceneService({
    rootDirectory: service.rootDirectory,
    ...({
      approvedLookResolver: service.approvedLookResolver,
      presetResolver: service.presetResolver,
      generator: service.generator,
      evaluator: service.evaluator,
    }),
  });
  await reloaded.initialize();
  const firstState = JSON.parse(
    await readFile(path.join(service.sceneDirectory(first.scene_id), 'scene.json'), 'utf8'),
  );
  assert.equal(
    firstState.attempts[0].generation_idempotency_key,
    calls.generator[0].idempotency_key,
  );
});

test('two service instances share durable create/execution locks and generate only once', async (t) => {
  const current = await fixture(t);
  const second = new SceneService({
    rootDirectory: current.root,
    ...current.dependencies,
  });
  await second.initialize();
  const [firstCreate, secondCreate] = await Promise.all([
    current.service.createScene(current.request),
    second.createScene(current.request),
  ]);
  assert.equal(firstCreate.scene_id, secondCreate.scene_id);
  const completed = await waitForTerminal([current.service, second], firstCreate.scene_id);
  await waitForSceneServicesIdle([current.service, second], firstCreate.scene_id);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(current.calls.lookResolver, 1);
  assert.equal(current.calls.presetResolver, 1);
  assert.equal(current.calls.generator.length, 1);
});

test('strict standard SceneSpec rejects a catalog-incomplete preset before provider work', async (t) => {
  const current = await fixture(t);
  const incomplete = structuredClone(current.documents.preset);
  delete incomplete.lighting;
  const incompleteBytes = canonicalJsonBytes(incomplete);
  current.dependencies.presetResolver.resolveScenePreset = async () => ({
    preset: incomplete,
    preset_bytes: incompleteBytes,
    prompt: current.documents.prompt,
    reference_pack: current.documents.referencePack,
    reference_pack_bytes: current.documents.referencePackBytes,
    assets: current.documents.roleAssets,
  });
  await assert.rejects(
    () => current.service.createScene({
      ...current.request,
      idempotencyKey: 'strict-scenespec-rejection',
      presetReference: {
        ...current.request.presetReference,
        preset_sha256: sha256(incompleteBytes),
      },
    }),
    /Resolved standard SceneSpec must contain exactly/,
  );
  assert.equal(current.calls.generator.length, 0);
});

test('rejects tampered approved-look and reference-pack bindings before generation', async (t) => {
  const first = await fixture(t);
  await assert.rejects(
    () => first.service.createScene({
      ...first.request,
      approvedLookReference: {
        ...first.request.approvedLookReference,
        image_sha256: '1'.repeat(64),
      },
    }),
    /Approved look image SHA-256 mismatch/,
  );
  assert.equal(first.calls.generator.length, 0);

  const second = await fixture(t);
  const originalResolve = second.dependencies.approvedLookResolver.resolveApprovedLook;
  second.dependencies.approvedLookResolver.resolveApprovedLook = async (...args) => {
    const resolved = await originalResolve(...args);
    const receipt = { ...second.documents.lookReceipt, decision: 'FAIL' };
    const bytes = canonicalJsonBytes(receipt);
    return { ...resolved, receipt: bytes };
  };
  await assert.rejects(
    () => second.service.createScene({
      ...second.request,
      idempotencyKey: 'tampered-receipt-request',
      approvedLookReference: {
        ...second.request.approvedLookReference,
        receipt_sha256: sha256(canonicalJsonBytes({ ...second.documents.lookReceipt, decision: 'FAIL' })),
      },
    }),
    /not a PASS receipt/,
  );
  assert.equal(second.calls.generator.length, 0);

  const third = await fixture(t);
  const originalPresetResolve = third.dependencies.presetResolver.resolveScenePreset;
  third.dependencies.presetResolver.resolveScenePreset = async (...args) => {
    const resolved = await originalPresetResolve(...args);
    const tamperedPack = structuredClone(third.documents.referencePack);
    tamperedPack.references[0].sha256 = '2'.repeat(64);
    return {
      ...resolved,
      reference_pack: tamperedPack,
      reference_pack_bytes: canonicalJsonBytes(tamperedPack),
    };
  };
  await assert.rejects(
    () => third.service.createScene({
      ...third.request,
      idempotencyKey: 'tampered-pack-request',
    }),
    /reference pack SHA-256 mismatch|reference .* SHA-256 mismatch/i,
  );
  assert.equal(third.calls.generator.length, 0);
});

test('accepts the existing completed run manifest only when both avatar and outfit QA bind the exact look bytes', async (t) => {
  const current = await fixture(t);
  const sourceRunId = 'completed-source-run';
  const legacyReceipt = {
    schema_version: '1.0.0',
    job_id: `web-${sourceRunId}`,
    state: 'COMPLETED',
    outputs: {
      avatar_outfit: { sha256: sha256(current.documents.lookBytes) },
    },
    qa: {
      avatar: { decision: 'PASS' },
      outfit: { decision: 'PASS' },
    },
  };
  const legacyBytes = canonicalJsonBytes(legacyReceipt);
  current.dependencies.approvedLookResolver.resolveApprovedLook = async () => ({
    look_id: current.request.approvedLookReference.look_id,
    source_run_id: sourceRunId,
    image: current.documents.lookBytes,
    receipt: legacyBytes,
  });
  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'legacy-run-receipt-scene',
    approvedLookReference: {
      ...current.request.approvedLookReference,
      receipt_sha256: sha256(legacyBytes),
    },
  });
  assert.equal((await waitFor(current.service, created.scene_id)).status, 'COMPLETED');
});

test('a blocking QA defect retries scene-only on the next stable model without resolving the look again', async (t) => {
  let evaluations = 0;
  const { service, request, calls } = await fixture(t, {
    evaluator: {
      async evaluateScene(context) {
        calls?.evaluator?.push?.(context);
        evaluations += 1;
        return evaluations === 1
          ? passEvaluation({ ITEM_FIDELITY: 'FAIL' })
          : passEvaluation();
      },
    },
  });
  const created = await service.createScene(request);
  const completed = await waitFor(service, created.scene_id);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(evaluations, 2);
  assert.equal(calls.generator.length, 2);
  assert.deepEqual(
    calls.generator.map((context) => context.model_version),
    ['gpt_image_2', 'nano_banana_flash'],
  );
  assert.equal(calls.lookResolver, 1);
  assert.equal(calls.presetResolver, 1);
  const state = JSON.parse(await readFile(path.join(service.sceneDirectory(created.scene_id), 'scene.json'), 'utf8'));
  assert.equal(state.attempts[0].status, 'QA_FAILED');
  assert.equal(state.attempts[0].qa.gates.find((gate) => gate.id === 'ITEM_FIDELITY').decision, 'FAIL');
  assert.equal(state.attempts[1].status, 'QA_PASS');
});

test('measured framing violations become QA_FAILED evidence and advance the image route without consuming QA infrastructure retries', async (t) => {
  let evaluations = 0;
  const { root, service, request, calls } = await fixture(t, {
    evaluator: {
      async evaluateScene(context) {
        calls?.evaluator?.push?.(context);
        evaluations += 1;
        const result = passEvaluation();
        if (evaluations === 1) {
          result.framing_evidence = {
            subject_bbox_xywh_px: [100, 64, 824, 1088],
            full_head_visible: true,
            full_footwear_visible: true,
          };
        }
        return result;
      },
    },
  });

  const created = await service.createScene({
    ...request,
    idempotencyKey: 'framing-lock-route-advance',
  });
  const completed = await waitFor(service, created.scene_id);
  assert.equal(completed.status, 'COMPLETED', JSON.stringify(completed, null, 2));
  assert.equal(evaluations, 2);
  assert.equal(calls.generator.length, 2);
  assert.deepEqual(
    calls.generator.map((context) => context.model_version),
    ['gpt_image_2', 'nano_banana_flash'],
  );
  assert.match(calls.generator[1].prompt, /SUBJECT_HEIGHT_OUTSIDE_PRESET_RANGE/);
  assert.match(calls.generator[1].prompt, /INSUFFICIENT_CLEAR_SPACE_ABOVE_HAIR/);
  assert.match(calls.generator[1].prompt, /ATTACHMENT_2 is the hash-bound failed scene candidate from attempt 1/);
  assert.match(calls.generator[1].prompt, /Outpaint the existing scene and pull the camera back/);
  assert.match(calls.generator[1].prompt, /Scale the complete locked person-and-look group to approximately 0\.894/);
  assert.equal(calls.generator[1].repair_candidate.attempt, 1);
  assert.equal(calls.generator[1].repair_candidate.role, 'failed_candidate');
  assert.match(calls.generator[1].repair_candidate.path, /attempts\/001\/candidate\.png$/);

  const state = JSON.parse(
    await readFile(path.join(service.sceneDirectory(created.scene_id), 'scene.json'), 'utf8'),
  );
  const rejected = state.attempts[0];
  const accepted = state.attempts[1];
  const framingGate = rejected.qa.gates.find((gate) => gate.id === 'FRAMING_AND_ANATOMY');
  assert.equal(rejected.status, 'QA_FAILED');
  assert.equal(rejected.qa_infrastructure_attempts, 0);
  assert.equal(rejected.error.code, 'BLOCKING_QA_FAILED');
  assert.equal(rejected.qa.framing_evidence.subject_height_percent, 85);
  assert.equal(rejected.qa.score, 99);
  assert.match(rejected.qa.summary, /Deterministic framing lock failed/);
  assert.equal(framingGate.decision, 'FAIL');
  assert.deepEqual(framingGate.defects, [
    'SUBJECT_HEIGHT_OUTSIDE_PRESET_RANGE',
    'INSUFFICIENT_CLEAR_SPACE_ABOVE_HAIR',
  ]);
  assert.equal(accepted.status, 'QA_PASS');
  assert.equal(calls.generator[1].repair_candidate.sha256, rejected.candidate.sha256);
  assert.equal(
    accepted.provider_metadata.repair_candidate_sha256,
    rejected.candidate.sha256,
  );
  assert.equal(accepted.provider_metadata.repair_from_attempt, 1);

  const schema = JSON.parse(await readFile(path.resolve('schemas/scene-job.schema.json'), 'utf8'));
  const sourceLedgerSchema = JSON.parse(
    await readFile(path.resolve('schemas/scene-source-ledger.schema.json'), 'utf8'),
  );
  const jobAjv = new Ajv2020({ strict: false, validateFormats: false });
  jobAjv.addSchema(sourceLedgerSchema);
  const validate = jobAjv.compile(schema);
  assert.equal(validate(state), true, JSON.stringify(validate.errors, null, 2));

  const impossibleCompletedPass = structuredClone(state);
  impossibleCompletedPass.qa.framing_evidence = structuredClone(
    rejected.qa.framing_evidence,
  );
  assert.equal(
    validate(impossibleCompletedPass),
    false,
    'a completed PASS job must retain strict passing framing evidence',
  );

  const manifest = JSON.parse(
    await readFile(await service.outputFile(created.scene_id, 'scene-manifest.json'), 'utf8'),
  );
  const manifestSchema = JSON.parse(
    await readFile(path.resolve('schemas/scene-production-receipt.schema.json'), 'utf8'),
  );
  const manifestAjv = new Ajv2020({ strict: false, validateFormats: false });
  manifestAjv.addSchema(sourceLedgerSchema);
  const validateManifest = manifestAjv.compile(manifestSchema);
  assert.equal(
    validateManifest(manifest),
    true,
    JSON.stringify(validateManifest.errors, null, 2),
  );
  assert.equal(manifest.attempt_history[0].qa.framing_evidence.subject_height_percent, 85);
  assert.equal(
    manifest.generation.provider_metadata.repair_candidate_sha256,
    rejected.candidate.sha256,
  );
  assert.equal(manifest.generation.provider_metadata.repair_from_attempt, 1);

  const impossibleApprovedManifest = structuredClone(manifest);
  impossibleApprovedManifest.qa.framing_evidence = structuredClone(
    manifest.attempt_history[0].qa.framing_evidence,
  );
  assert.equal(
    validateManifest(impossibleApprovedManifest),
    false,
    'the approved manifest QA must reject framing evidence retained only for a failed attempt',
  );
});

test('repair selection keeps the strongest earlier candidate instead of editing a later candidate with more failed gates', async (t) => {
  const generated = await Promise.all([
    image({ width: 800, height: 1000, color: '#c79782' }),
    image({ width: 800, height: 1000, color: '#9b7868' }),
    image({ width: 800, height: 1000, color: '#c3a28f' }),
  ]);
  const generatorCalls = [];
  let evaluations = 0;
  const current = await fixture(t, {
    generator: {
      async generateScene(context) {
        generatorCalls.push(context);
        const bytes = generated[context.attempt - 1];
        return {
          image: bytes,
          media_type: 'image/png',
          metadata: providerMetadata(
            context,
            bytes,
            `strongest-repair-request-${context.attempt}`,
          ),
        };
      },
    },
    evaluator: {
      async evaluateScene() {
        evaluations += 1;
        if (evaluations === 1) {
          const result = passEvaluation();
          result.framing_evidence = {
            subject_bbox_xywh_px: [100, 64, 824, 1088],
            full_head_visible: true,
            full_footwear_visible: true,
          };
          return result;
        }
        if (evaluations === 2) {
          return passEvaluation({
            IDENTITY: 'FAIL',
            ITEM_FIDELITY: 'FAIL',
          });
        }
        return passEvaluation();
      },
    },
  });

  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'strongest-repair-candidate-selection',
  });
  const completed = await waitFor(current.service, created.scene_id);
  assert.equal(completed.status, 'COMPLETED', JSON.stringify(completed, null, 2));
  assert.equal(generatorCalls.length, 3);
  assert.equal(generatorCalls[0].repair_candidate, null);
  assert.equal(generatorCalls[1].repair_candidate.attempt, 1);
  assert.equal(
    generatorCalls[2].repair_candidate.attempt,
    1,
    'attempt 3 must edit attempt 1 because it has one failed gate; attempt 2 has two',
  );
  assert.match(generatorCalls[2].prompt, /FRAMING_AND_ANATOMY/);
  assert.match(generatorCalls[2].prompt, /SUBJECT_HEIGHT_OUTSIDE_PRESET_RANGE/);
  assert.doesNotMatch(generatorCalls[2].prompt, /IDENTITY_DEFECT|ITEM_FIDELITY_DEFECT/);

  const state = JSON.parse(
    await readFile(path.join(current.service.sceneDirectory(created.scene_id), 'scene.json'), 'utf8'),
  );
  assert.equal(
    state.attempts[0].qa.gates.filter((gate) => gate.decision === 'FAIL').length,
    1,
  );
  assert.equal(
    state.attempts[1].qa.gates.filter((gate) => gate.decision === 'FAIL').length,
    2,
  );
  assert.equal(
    generatorCalls[2].repair_candidate.sha256,
    state.attempts[0].candidate.sha256,
  );
  assert.equal(
    state.attempts[2].provider_metadata.repair_candidate_sha256,
    state.attempts[0].candidate.sha256,
  );
  assert.equal(state.attempts[2].provider_metadata.repair_from_attempt, 1);
});

test('repair selection prefers the framing-only candidate closest to the required range over a higher-scored oversize candidate', async (t) => {
  const generated = await Promise.all([
    image({ width: 800, height: 1000, color: '#d1a991' }),
    image({ width: 800, height: 1000, color: '#b88e78' }),
    image({ width: 800, height: 1000, color: '#a27765' }),
  ]);
  const generatorCalls = [];
  let evaluations = 0;
  const current = await fixture(t, {
    generator: {
      async generateScene(context) {
        generatorCalls.push(context);
        const bytes = generated[context.attempt - 1];
        return {
          image: bytes,
          media_type: 'image/png',
          metadata: providerMetadata(context, bytes, `closest-framing-${context.attempt}`),
        };
      },
    },
    evaluator: {
      async evaluateScene() {
        evaluations += 1;
        if (evaluations === 1) {
          const result = passEvaluation();
          result.score = 0.98;
          result.framing_evidence = {
            subject_bbox_xywh_px: [120, 45, 760, 1190],
            full_head_visible: true,
            full_footwear_visible: true,
          };
          return result;
        }
        if (evaluations === 2) {
          const result = passEvaluation();
          result.score = 0.82;
          result.framing_evidence = {
            subject_bbox_xywh_px: [250, 100, 520, 1024],
            full_head_visible: true,
            full_footwear_visible: true,
          };
          return result;
        }
        return passEvaluation();
      },
    },
  });

  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'closest-framing-repair-candidate',
  });
  const completed = await waitFor(current.service, created.scene_id);
  assert.equal(completed.status, 'COMPLETED', JSON.stringify(completed, null, 2));
  assert.equal(generatorCalls.length, 3);
  assert.equal(
    generatorCalls[2].repair_candidate.attempt,
    2,
    '80% is closer to 74–78 than 93.0%, even when the larger candidate has a higher aesthetic score',
  );
  assert.match(generatorCalls[2].prompt, /Scale the complete locked person-and-look group to approximately 0\.95/);
  assert.match(generatorCalls[2].prompt, /Outpaint the existing scene and pull the camera back/);
});

test('an undersized framing-only candidate is deterministically cropped and rechecked without another provider generation', async (t) => {
  const evaluatorCandidates = [];
  const generatorCalls = [];
  let evaluations = 0;
  const accent = await image({ width: 260, height: 420, color: '#eed6c4' });
  const patternedCandidate = await sharp({
    create: {
      width: 800,
      height: 1000,
      channels: 3,
      background: '#7f6658',
    },
  }).composite([{ input: accent, left: 270, top: 210 }]).png().toBuffer();
  const current = await fixture(t, {
    generator: {
      async generateScene(context) {
        generatorCalls.push(context);
        return {
          image: patternedCandidate,
          media_type: 'image/png',
          metadata: providerMetadata(context, patternedCandidate, 'deterministic-crop-provider'),
        };
      },
    },
    evaluator: {
      async evaluateScene(context) {
        evaluatorCandidates.push(context.candidate);
        evaluations += 1;
        if (evaluations === 1) {
          const result = passEvaluation();
          result.framing_evidence = {
            subject_bbox_xywh_px: [361, 230, 280, 850],
            full_head_visible: true,
            full_footwear_visible: true,
          };
          return result;
        }
        return passEvaluation();
      },
    },
  });

  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'deterministic-undersized-framing-repair',
  });
  const completed = await waitFor(current.service, created.scene_id);
  assert.equal(completed.status, 'COMPLETED', JSON.stringify(completed, null, 2));
  assert.equal(generatorCalls.length, 1, 'framing crop must not spend another image-model call');
  assert.equal(evaluatorCandidates.length, 2, 'the exact derived hash must pass a fresh full QA evaluation');
  assert.notEqual(evaluatorCandidates[0].sha256, evaluatorCandidates[1].sha256);
  assert.match(evaluatorCandidates[1].path, /candidate-framing-repair\.png$/);

  const state = JSON.parse(
    await readFile(path.join(current.service.sceneDirectory(created.scene_id), 'scene.json'), 'utf8'),
  );
  const attempt = state.attempts[0];
  assert.equal(attempt.status, 'QA_PASS');
  assert.equal(attempt.normalization.strategy, 'deterministic_bbox_crop');
  assert.equal(attempt.normalization.source_attempt, attempt.number);
  assert.equal(attempt.normalization.source_candidate_sha256, evaluatorCandidates[0].sha256);
  assert.deepEqual(attempt.normalization.crop_xywh_px, [53, 95, 896, 1120]);
  assert.equal(attempt.normalization.target_subject_height_percent, 76);
  assert.equal(attempt.normalization.trigger_framing_evidence.subject_height_percent, 66.4063);
  assert.equal(attempt.candidate.sha256, evaluatorCandidates[1].sha256);
});

test('a legacy undersized failure at the manual limit is repaired locally and exports without another provider call', async (t) => {
  let evaluations = 0;
  const current = await fixture(t, {
    maxManualRetries: 0,
    evaluator: {
      async evaluateScene() {
        evaluations += 1;
        if (evaluations <= 3) {
          const result = passEvaluation();
          result.framing_evidence = {
            subject_bbox_xywh_px: [100, 64, 824, 1088],
            full_head_visible: true,
            full_footwear_visible: true,
          };
          return result;
        }
        return passEvaluation();
      },
    },
  });
  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'legacy-local-framing-pass',
  });
  const exhausted = await waitFor(current.service, created.scene_id);
  assert.equal(exhausted.status, 'FAILED');
  assert.equal(exhausted.error.code, 'SCENE_QA_EXHAUSTED');
  assert.equal(current.calls.generator.length, 3);
  const failedEvidence = await current.service.verifiedExecutionResult(created.scene_id);
  assert.equal(failedEvidence.decision, 'FAIL');
  assert.equal(failedEvidence.output, null);
  assert.deepEqual(
    failedEvidence.gates.map((gate) => gate.id),
    SCENE_QA_GATES,
    'a terminal visual FAIL must still expose the exact nine-gate contract',
  );

  await rewriteLegacyFramingFailure(
    current.service,
    created.scene_id,
    3,
    [361, 230, 280, 850],
  );
  const queued = await current.service.retryScene(created.scene_id, {
    idempotencyKey: 'legacy-local-framing-pass-retry',
  });
  assert.equal(queued.status, 'QUEUED');
  assert.equal(queued.execution.manual_retries, 0);
  const completed = await waitFor(current.service, created.scene_id);
  assert.equal(completed.status, 'COMPLETED', JSON.stringify(completed, null, 2));
  assert.equal(completed.execution.cycle, 2);
  assert.equal(completed.execution.manual_retries, 0);
  assert.equal(current.calls.generator.length, 3, 'local crop must not call a provider');
  assert.equal(evaluations, 4, 'only the derived candidate receives one fresh full QA pass');

  const state = JSON.parse(await readFile(current.service.statePath(created.scene_id), 'utf8'));
  const derived = state.attempts.at(-1);
  assert.equal(derived.number, 4);
  assert.equal(derived.status, 'QA_PASS');
  assert.equal(derived.normalization.strategy, 'deterministic_bbox_crop');
  assert.equal(derived.normalization.source_attempt, 3);
  assert.equal(derived.generation_idempotency_key, state.attempts[2].generation_idempotency_key);

  const manifest = JSON.parse(await readFile(
    await current.service.outputFile(created.scene_id, 'scene-manifest.json'),
    'utf8',
  ));
  assert.equal(manifest.generation.normalization.source_attempt, 3);
  const sourceLedgerSchema = JSON.parse(
    await readFile(path.resolve('schemas/scene-source-ledger.schema.json'), 'utf8'),
  );
  const receiptSchema = JSON.parse(
    await readFile(path.resolve('schemas/scene-production-receipt.schema.json'), 'utf8'),
  );
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  ajv.addSchema(sourceLedgerSchema);
  const validate = ajv.compile(receiptSchema);
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors, null, 2));

  const replay = await current.service.retryScene(created.scene_id, {
    idempotencyKey: 'legacy-local-framing-pass-retry',
  });
  assert.equal(replay.status, 'COMPLETED');
  assert.equal(current.calls.generator.length, 3);
});

test('a failed local framing cycle never falls through to a provider and cannot consume the same source twice', async (t) => {
  let evaluations = 0;
  const current = await fixture(t, {
    maxManualRetries: 0,
    evaluator: {
      async evaluateScene() {
        evaluations += 1;
        const result = passEvaluation();
        result.framing_evidence = evaluations <= 3
          ? {
            subject_bbox_xywh_px: [100, 64, 824, 1088],
            full_head_visible: true,
            full_footwear_visible: true,
          }
          : {
            subject_bbox_xywh_px: [361, 230, 280, 850],
            full_head_visible: true,
            full_footwear_visible: true,
          };
        return result;
      },
    },
  });
  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'legacy-local-framing-fail',
  });
  assert.equal((await waitFor(current.service, created.scene_id)).status, 'FAILED');
  await rewriteLegacyFramingFailure(
    current.service,
    created.scene_id,
    3,
    [361, 230, 280, 850],
  );

  await current.service.retryScene(created.scene_id, {
    idempotencyKey: 'legacy-local-framing-fail-retry',
  });
  const failed = await waitFor(current.service, created.scene_id);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.error.code, 'SCENE_QA_EXHAUSTED');
  assert.equal(failed.execution.cycle, 2);
  assert.equal(failed.execution.manual_retries, 0);
  assert.equal(current.calls.generator.length, 3, 'a failed local-only cycle must stay zero-provider');
  assert.equal(evaluations, 4);

  await assert.rejects(
    () => current.service.retryScene(created.scene_id, {
      idempotencyKey: 'legacy-local-framing-second-token',
    }),
    (error) => error.code === 'SCENE_RETRY_LIMIT' && error.statusCode === 409,
  );
  assert.equal(current.calls.generator.length, 3);
  const state = JSON.parse(await readFile(current.service.statePath(created.scene_id), 'utf8'));
  assert.equal(state.attempts.length, 4, 'the consumed source must not create another crop attempt');
});

test('a manual scene-only retry restarts the model route but still edits the best hash-bound candidate from the prior cycle', async (t) => {
  const generated = await Promise.all([
    image({ width: 800, height: 1000, color: '#c79782' }),
    image({ width: 800, height: 1000, color: '#9b7868' }),
    image({ width: 800, height: 1000, color: '#826658' }),
    image({ width: 800, height: 1000, color: '#c8aa98' }),
  ]);
  const generatorCalls = [];
  let evaluations = 0;
  const current = await fixture(t, {
    generator: {
      async generateScene(context) {
        generatorCalls.push(context);
        const bytes = generated[context.attempt - 1];
        return {
          image: bytes,
          media_type: 'image/png',
          metadata: providerMetadata(
            context,
            bytes,
            `manual-repair-request-${context.attempt}`,
          ),
        };
      },
    },
    evaluator: {
      async evaluateScene() {
        evaluations += 1;
        if (evaluations === 1) {
          const result = passEvaluation();
          result.framing_evidence = {
            subject_bbox_xywh_px: [100, 64, 824, 1088],
            full_head_visible: true,
            full_footwear_visible: true,
          };
          return result;
        }
        if (evaluations === 2) {
          return passEvaluation({
            IDENTITY: 'FAIL',
            ITEM_FIDELITY: 'FAIL',
          });
        }
        if (evaluations === 3) {
          return passEvaluation({
            IDENTITY: 'FAIL',
            ITEM_FIDELITY: 'FAIL',
            SCENE_MATCH: 'FAIL',
          });
        }
        return passEvaluation();
      },
    },
  });

  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'manual-repair-across-cycles',
  });
  const exhausted = await waitFor(current.service, created.scene_id);
  assert.equal(exhausted.status, 'FAILED');
  assert.equal(exhausted.phase, 'QA_EXHAUSTED');

  const queued = await current.service.retryScene(created.scene_id, {
    idempotencyKey: 'manual-repair-across-cycles-retry',
  });
  assert.equal(queued.status, 'QUEUED');
  const completed = await waitFor(current.service, created.scene_id);
  assert.equal(completed.status, 'COMPLETED', JSON.stringify(completed, null, 2));
  assert.equal(generatorCalls.length, 4);
  assert.equal(generatorCalls[3].attempt, 4);
  assert.equal(generatorCalls[3].cycle, 2);
  assert.equal(generatorCalls[3].cycle_attempt, 1);
  assert.equal(generatorCalls[3].model_version, 'gpt_image_2');
  assert.equal(generatorCalls[3].repair_candidate.attempt, 1);
  assert.match(generatorCalls[3].prompt, /ATTACHMENT_2/);
  assert.match(generatorCalls[3].prompt, /Outpaint the existing scene and pull the camera back/);

  const state = JSON.parse(
    await readFile(path.join(current.service.sceneDirectory(created.scene_id), 'scene.json'), 'utf8'),
  );
  assert.equal(
    generatorCalls[3].repair_candidate.sha256,
    state.attempts[0].candidate.sha256,
  );
  assert.equal(state.attempts[3].provider_metadata.repair_from_attempt, 1);
});

test('three measured framing failures exhaust the image route with the last visual defects exposed truthfully', async (t) => {
  let evaluations = 0;
  const current = await fixture(t, {
    evaluator: {
      async evaluateScene() {
        evaluations += 1;
        const result = passEvaluation();
        result.framing_evidence = {
          subject_bbox_xywh_px: [100, 64, 824, 1088],
          full_head_visible: true,
          full_footwear_visible: true,
        };
        return result;
      },
    },
  });

  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'framing-lock-route-exhaustion',
  });
  const failed = await waitFor(current.service, created.scene_id);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.phase, 'QA_EXHAUSTED');
  assert.equal(failed.error.code, 'SCENE_QA_EXHAUSTED');
  assert.equal(current.calls.generator.length, 3);
  assert.equal(evaluations, 3);
  assert.equal(failed.qa.decision, 'FAIL');
  assert.equal(failed.qa.framing_evidence.subject_height_percent, 85);
  assert.equal(
    failed.qa.gates.find((gate) => gate.id === 'FRAMING_AND_ANATOMY').decision,
    'FAIL',
  );
  assert.match(failed.qa.summary, /Deterministic framing lock failed/);
});

test('malformed framing visibility retries only QA for the preserved candidate and fails as infrastructure', async (t) => {
  let evaluations = 0;
  const current = await fixture(t, {
    evaluator: {
      async evaluateScene() {
        evaluations += 1;
        const result = passEvaluation();
        result.framing_evidence.full_head_visible = 'true';
        return result;
      },
    },
  });

  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'malformed-framing-evidence',
  });
  const failed = await waitFor(current.service, created.scene_id);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.phase, 'QA_INFRASTRUCTURE_FAILED');
  assert.equal(failed.error.code, 'QA_INFRASTRUCTURE_FAILED');
  assert.equal(current.calls.generator.length, 1);
  assert.equal(evaluations, 3);
  const state = JSON.parse(
    await readFile(path.join(current.service.sceneDirectory(created.scene_id), 'scene.json'), 'utf8'),
  );
  assert.equal(state.attempts.length, 1);
  assert.equal(state.attempts[0].status, 'QA_PENDING');
  assert.equal(state.attempts[0].qa_infrastructure_attempts, 3);
});

test('initialize resumes QA_PENDING from the durable candidate without repeating generation', async (t) => {
  const initial = await fixture(t);
  const created = await initial.service.createScene(initial.request);
  const completed = await waitFor(initial.service, created.scene_id);
  assert.equal(completed.status, 'COMPLETED');
  const directory = initial.service.sceneDirectory(created.scene_id);
  const statePath = path.join(directory, 'scene.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const attempt = state.attempts.at(-1);
  attempt.status = 'QA_PENDING';
  attempt.qa = null;
  state.attempts[state.attempts.length - 1] = attempt;
  state.status = 'RUNNING';
  state.phase = 'QA';
  state.output = null;
  state.qa = {
    decision: 'PENDING',
    gates: state.qa.gates.slice(0, 2),
    score: null,
    summary: '',
  };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  await writeFile(
    path.join(directory, 'attempts', String(attempt.number).padStart(3, '0'), 'attempt.json'),
    `${JSON.stringify(attempt, null, 2)}\n`,
  );
  await rm(path.join(directory, 'outputs'), { recursive: true, force: true });

  const restartCalls = { generator: 0, evaluator: 0 };
  const restarted = new SceneService({
    rootDirectory: initial.root,
    approvedLookResolver: initial.dependencies.approvedLookResolver,
    presetResolver: initial.dependencies.presetResolver,
    generator: {
      async generateScene() {
        restartCalls.generator += 1;
        throw new Error('generation must not repeat');
      },
    },
    evaluator: {
      async evaluateScene() {
        restartCalls.evaluator += 1;
        return passEvaluation();
      },
    },
  });
  await restarted.initialize();
  const recovered = await waitFor(restarted, created.scene_id);
  assert.equal(recovered.status, 'COMPLETED');
  assert.equal(restartCalls.generator, 0);
  assert.equal(restartCalls.evaluator, 1);
  assert.equal((await sharp(await restarted.outputFile(created.scene_id)).metadata()).height, 1280);
});

test('initialize quarantines malformed persisted jobs and exposes a sanitized incident', async (t) => {
  const current = await fixture(t);
  const malformedSceneId = 'scene_malformed_fixture';
  const malformedDirectory = path.join(current.root, malformedSceneId);
  await mkdir(malformedDirectory, { recursive: true });
  await writeFile(
    path.join(malformedDirectory, 'scene.json'),
    JSON.stringify({
      schema_version: '1.0.0',
      scene_id: malformedSceneId,
      bindings: { prompt: { relative_path: '../../private.txt' } },
    }),
  );
  const restarted = new SceneService({
    rootDirectory: current.root,
    ...current.dependencies,
  });
  await restarted.initialize();
  const incident = await restarted.getIncident(malformedSceneId);
  assert.equal(incident.code, 'MALFORMED_PERSISTED_SCENE');
  assert.equal(incident.status, 'QUARANTINED');
  assert.doesNotMatch(JSON.stringify(incident), /\/Users\/|\/tmp\/|private\.txt/);
  assert.ok((await readdir(path.join(current.root, 'quarantine')))
    .some((name) => name.startsWith(`malformed-${malformedSceneId}-`)));
  await assert.rejects(
    () => readFile(path.join(malformedDirectory, 'scene.json')),
    (error) => error.code === 'ENOENT',
  );
  assert.equal(current.calls.generator.length, 0);
});

test('release privacy gate blocks credential-shaped evaluator evidence and keeps it out of public output', async (t) => {
  const current = await fixture(t, {
    evaluator: {
      async evaluateScene() {
        const result = passEvaluation();
        result.gates[0].evidence = 'PASS receipt sk-1234567890abcdef1234567890abcdef';
        return result;
      },
    },
  });
  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'privacy-injection-scene',
  });
  const failed = await waitFor(current.service, created.scene_id);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.phase, 'PRIVACY_GATE_FAILED');
  assert.equal(failed.error.code, 'PRIVACY_GATE_FAILED');
  assert.doesNotMatch(JSON.stringify(failed), /sk-1234567890abcdef/);
  assert.equal(await current.service.outputFile(created.scene_id), null);
  assert.ok((await readdir(path.join(current.service.sceneDirectory(created.scene_id), 'quarantine')))
    .some((name) => name.startsWith('privacy-report-')));
});

test('cancel is durable and a retry token starts one new scene-only cycle', async (t) => {
  let invocation = 0;
  let entered;
  const enteredGeneration = new Promise((resolve) => { entered = resolve; });
  const generated = await image({ width: 800, height: 1000, color: '#dfb49f' });
  const customGenerator = {
    async generateScene(context) {
      invocation += 1;
      if (invocation === 1) {
        entered();
        await new Promise((resolve, reject) => {
          const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          if (context.signal.aborted) abort();
          else context.signal.addEventListener('abort', abort, { once: true });
        });
      }
      return {
        image: generated,
        media_type: 'image/png',
        metadata: providerMetadata(context, generated, `cancel-request-${invocation}`),
      };
    },
  };
  const { service, request } = await fixture(t, { generator: customGenerator });
  const created = await service.createScene(request);
  await enteredGeneration;
  const cancelled = await service.cancelScene(created.scene_id, 'test cancellation');
  assert.equal(cancelled.status, 'CANCELLED');
  await service.running.get(created.scene_id);
  assert.equal((await service.getScene(created.scene_id)).status, 'CANCELLED');

  const queued = await service.retryScene(created.scene_id, { idempotencyKey: 'retry-scene-0001' });
  assert.equal(queued.status, 'QUEUED');
  const completed = await waitFor(service, created.scene_id);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.execution.cycle, 2);
  assert.equal(completed.execution.manual_retries, 1);
  assert.equal(invocation, 2);
  const replay = await service.retryScene(created.scene_id, { idempotencyKey: 'retry-scene-0001' });
  assert.equal(replay.status, 'COMPLETED', 'same retry token is an idempotent read after completion');
});

test('output lookup verifies hashes and terminal deletion is idempotent', async (t) => {
  const { service, request } = await fixture(t);
  const created = await service.createScene(request);
  const completed = await waitFor(service, created.scene_id);
  assert.equal(completed.status, 'COMPLETED');
  const outputPath = await service.outputFile(created.scene_id);
  await writeFile(outputPath, Buffer.from('tampered'));
  assert.equal(await service.outputFile(created.scene_id), null);
  assert.equal(await service.outputFile(created.scene_id, '../scene.png'), null);
  assert.equal(await service.deleteScene(created.scene_id), true);
  assert.equal(await service.getScene(created.scene_id), null);
  assert.equal(await service.deleteScene(created.scene_id), false);
  await assert.rejects(
    () => service.createScene(request),
    (error) => error.code === 'SCENE_DELETED' && error.statusCode === 410,
  );
  await assert.rejects(
    () => service.retryScene(created.scene_id, { idempotencyKey: 'retry-after-delete' }),
    (error) => error.code === 'SCENE_DELETED' && error.statusCode === 410,
  );
});

test('restart quarantines a corrupted completed release and retry writes a clean replacement', async (t) => {
  const current = await fixture(t);
  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'corrupt-release-recovery',
  });
  assert.equal((await waitFor(current.service, created.scene_id)).status, 'COMPLETED');
  await writeFile(await current.service.outputFile(created.scene_id), Buffer.from('corrupt'));
  const restarted = new SceneService({
    rootDirectory: current.root,
    ...current.dependencies,
  });
  await restarted.initialize();
  const failed = await restarted.getScene(created.scene_id);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.error.code, 'OUTPUT_INTEGRITY_FAILED');
  assert.ok((await readdir(path.join(restarted.sceneDirectory(created.scene_id), 'quarantine')))
    .some((name) => name.startsWith('invalid-output-')));
  await restarted.retryScene(created.scene_id, { idempotencyKey: 'corrupt-release-retry' });
  const completed = await waitForTerminal([restarted], created.scene_id);
  assert.equal(completed.status, 'COMPLETED');
  assert.ok(await restarted.outputFile(created.scene_id, 'scene-qa-receipt.json'));
});

test('a running scene must be cancelled before it can be deleted', async (t) => {
  let entered;
  const generating = new Promise((resolve) => { entered = resolve; });
  const { service, request } = await fixture(t, {
    generator: {
      async generateScene(context) {
        entered();
        await new Promise((resolve, reject) => {
          const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          if (context.signal.aborted) abort();
          else context.signal.addEventListener('abort', abort, { once: true });
        });
      },
    },
  });
  const created = await service.createScene({
    ...request,
    idempotencyKey: 'delete-running-scene',
  });
  await generating;
  await assert.rejects(
    () => service.deleteScene(created.scene_id),
    (error) => error.code === 'SCENE_RUNNING' && error.statusCode === 409,
  );
  await service.cancelScene(created.scene_id);
  await service.running.get(created.scene_id);
  assert.equal(await service.deleteScene(created.scene_id), true);
});

test('delete and retry share one lifecycle lock so a tombstoned scene cannot be resurrected', async (t) => {
  let invocation = 0;
  let entered;
  const enteredGeneration = new Promise((resolve) => { entered = resolve; });
  const generated = await image({ width: 800, height: 1000, color: '#d9a88f' });
  const current = await fixture(t, {
    generator: {
      async generateScene(context) {
        invocation += 1;
        if (invocation === 1) {
          entered();
          await new Promise((resolve, reject) => {
            const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            if (context.signal.aborted) abort();
            else context.signal.addEventListener('abort', abort, { once: true });
          });
        }
        return {
          image: generated,
          media_type: 'image/png',
          metadata: providerMetadata(context, generated, `race-request-${invocation}`),
        };
      },
    },
  });
  const created = await current.service.createScene({
    ...current.request,
    idempotencyKey: 'delete-retry-race-scene',
  });
  await enteredGeneration;
  await current.service.cancelScene(created.scene_id);
  await current.service.running.get(created.scene_id);

  const [retryResult, deleteResult] = await Promise.allSettled([
    current.service.retryScene(created.scene_id, { idempotencyKey: 'race-retry-token' }),
    current.service.deleteScene(created.scene_id),
  ]);
  const retryWon = retryResult.status === 'fulfilled';
  const deleteWon = deleteResult.status === 'fulfilled' && deleteResult.value === true;
  assert.notEqual(retryWon, deleteWon, 'exactly one lifecycle action must win');
  if (deleteWon) {
    assert.equal(retryResult.reason.code, 'SCENE_DELETED');
    assert.equal(await current.service.getScene(created.scene_id), null);
  } else {
    assert.equal(deleteResult.reason.code, 'SCENE_RUNNING');
    assert.equal((await waitForTerminal([current.service], created.scene_id)).status, 'COMPLETED');
  }
});
