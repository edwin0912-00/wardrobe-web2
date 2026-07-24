import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  ApprovedItemEvidenceError,
  RunService,
} from '../../src/web/run-service.js';
import { ProfileService } from '../../src/web/profile-service.js';
import { createProfileApprovedLookResolver } from '../../src/web/scene-resolvers.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function png(color = '#275b36') {
  return sharp({
    create: {
      width: 320,
      height: 480,
      channels: 4,
      background: color,
    },
  }).png().toBuffer();
}

async function evidenceFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'approved-item-evidence-'));
  const runId = 'completed-item-run';
  const runDirectory = path.join(root, runId);
  const garmentDirectory = path.join(runDirectory, 'conditioned', 'garments');
  const cutoutPath = path.join(garmentDirectory, '01', 'cutout.png');
  const sourcePath = path.join(runDirectory, 'inputs', 'garment-01.png');
  const cutout = await png();
  await mkdir(path.dirname(cutoutPath), { recursive: true });
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(cutoutPath, cutout);
  await writeFile(sourcePath, await png('#183522'));
  const pack = {
    schema_version: '1.0.0',
    asset_id: `${runId}-wardrobe`,
    kind: 'GARMENT',
    source: {
      path: sourcePath,
      sha256: sha256(await readFile(sourcePath)),
      immutable: true,
    },
    extraction: {
      method: 'codex_vlm_strict_schema',
      provenance: 'OBSERVED',
      items: [{
        source_index: 0,
        source_indexes: [0],
        reference_set_id: 'set-0',
        same_item_confidence: 0.99,
        grouping_evidence: ['Same construction and exact visible logo.'],
        category: 'top',
        confidence: 0.98,
        observed: {
          garment_type: 'hooded sweatshirt',
          colors: ['dark green', 'white'],
          material: ['cotton-blend fleece'],
          pattern: ['front graphic'],
          logo_text: ['FIRENZE 1921'],
          construction: ['attached hood', 'rib-knit cuffs'],
        },
        unknowns: ['Exact fiber composition'],
      }],
    },
    readiness: {
      decision: 'READY',
      reasons: ['ALL_GARMENTS_CANONICALIZED_AND_QA_PASSED'],
      actions: [],
      terminal: false,
    },
    generation_bindings: [{
      order: 1,
      role: 'GARMENT_TOP',
      path: cutoutPath,
      sha256: sha256(cutout),
    }],
    created_at: '2026-07-23T00:00:00.000Z',
  };
  const packPath = path.join(garmentDirectory, 'reference-pack.json');
  const packBytes = Buffer.from(`${JSON.stringify(pack, null, 2)}\n`);
  await writeFile(packPath, packBytes);
  const jobPath = path.join(runDirectory, 'job.json');
  const jobBytes = Buffer.from(`${JSON.stringify({ job_id: `web-${runId}` }, null, 2)}\n`);
  await writeFile(jobPath, jobBytes);
  const checkpoint = {
    state: 'COMPLETED',
    job_id: `web-${runId}`,
    job_source: jobPath,
    job_hash: sha256(jobBytes),
    inputs: {
      outfit_reference_pack: {
        path: packPath,
        sha256: sha256(packBytes),
        kind: 'REFERENCE_PACK',
        scope: 'outfit',
      },
      outfit_reference_pack_binding_001: {
        path: cutoutPath,
        sha256: sha256(cutout),
        kind: 'REFERENCE_PACK_MEDIA',
        scope: 'outfit',
        role: 'GARMENT_TOP',
        binding_order: 1,
        declared_sha256: sha256(cutout),
      },
    },
  };
  checkpoint.execution_hash = sha256(
    `${checkpoint.job_hash}:${JSON.stringify(checkpoint.inputs)}`,
  );
  const checkpointPath = path.join(
    runDirectory,
    'outputs',
    '.zeely-run',
    'checkpoint.json',
  );
  await mkdir(path.dirname(checkpointPath), { recursive: true });
  await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  const manifestPath = path.join(runDirectory, 'outputs', 'run-manifest.json');
  const manifest = {
    job_id: `web-${runId}`,
    state: 'COMPLETED',
    job_hash: checkpoint.job_hash,
    execution_hash: checkpoint.execution_hash,
    outputs: {
      avatar_outfit: { sha256: 'a'.repeat(64) },
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const runPath = path.join(runDirectory, 'run.json');
  await writeFile(runPath, `${JSON.stringify({
    schema_version: '1.0.0',
    run_id: runId,
    status: 'COMPLETED',
    phase: 'COMPLETED',
    message: 'done',
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
    inputs: {
      person: path.join(runDirectory, 'inputs', 'person.png'),
      identity_detail: null,
      garments: [sourcePath],
      outfit_text: '',
      generate_scene: false,
    },
    garments: [],
    conflicts: [],
    qa: {},
    outputs: {},
    error: null,
  }, null, 2)}\n`);
  const service = new RunService({ rootDirectory: root });
  await service.initialize();
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    runId,
    garmentDirectory,
    cutoutPath,
    packPath,
    runPath,
    checkpointPath,
    checkpoint,
    jobPath,
    manifestPath,
    manifest,
    pack,
    cutout,
    service,
  };
}

async function rewriteExecutionReceipt(fixture) {
  const jobBytes = await readFile(fixture.jobPath);
  fixture.checkpoint.job_hash = sha256(jobBytes);
  fixture.checkpoint.execution_hash = sha256(
    `${fixture.checkpoint.job_hash}:${JSON.stringify(fixture.checkpoint.inputs)}`,
  );
  fixture.manifest.job_hash = fixture.checkpoint.job_hash;
  fixture.manifest.execution_hash = fixture.checkpoint.execution_hash;
  await Promise.all([
    writeFile(fixture.checkpointPath, `${JSON.stringify(fixture.checkpoint, null, 2)}\n`),
    writeFile(fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`),
  ]);
}

function assertNoTransportPaths(value) {
  if (value === null || value === undefined || Buffer.isBuffer(value)) return;
  if (typeof value === 'string') {
    assert.doesNotMatch(value, /\/(?:Users|home|root|tmp|private|var|Volumes)\//);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertNoTransportPaths);
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    assert.ok(!['path', 'paths', 'source_path', 'source_paths', 'filename'].includes(key));
    assertNoTransportPaths(item);
  }
}

test('completed garment run resolves hash-bound logical item facts and cutout bytes without paths', async (t) => {
  const fixture = await evidenceFixture(t);
  const evidence = await fixture.service.approvedItemEvidenceForRun(fixture.runId);
  const packBytes = await readFile(fixture.packPath);

  assert.equal(evidence.schema_version, '1.0.0');
  assert.equal(evidence.kind, 'APPROVED_ITEM_EVIDENCE');
  assert.equal(evidence.source_run_id, fixture.runId);
  assert.equal(evidence.reference_pack.sha256, sha256(packBytes));
  assert.equal(evidence.reference_pack.asset_id, `${fixture.runId}-wardrobe`);
  assert.equal(evidence.items.length, 1);
  assert.equal(evidence.items[0].order, 1);
  assert.equal(evidence.items[0].role, 'GARMENT_TOP');
  assert.equal(evidence.items[0].category, 'top');
  assert.equal(evidence.items[0].reference_set_id, 'set-0');
  assert.deepEqual(evidence.items[0].source_indexes, [0]);
  assert.equal(evidence.items[0].same_item_confidence, 0.99);
  assert.deepEqual(evidence.items[0].grouping_evidence, ['Same construction and exact visible logo.']);
  assert.deepEqual(evidence.items[0].observed.logo_text, ['FIRENZE 1921']);
  assert.equal(evidence.items[0].sha256, sha256(fixture.cutout));
  assert.deepEqual(evidence.items[0].data, fixture.cutout);
  assertNoTransportPaths(evidence);
});

test('completed text-only runs resolve no item evidence without changing the approved-look API', async (t) => {
  const fixture = await evidenceFixture(t);
  const state = JSON.parse(await readFile(fixture.runPath, 'utf8'));
  state.inputs.garments = [];
  await writeFile(fixture.runPath, `${JSON.stringify(state, null, 2)}\n`);
  assert.equal(await fixture.service.approvedItemEvidenceForRun(fixture.runId), null);
});

test('item evidence fails closed when a cutout no longer matches its declared hash', async (t) => {
  const fixture = await evidenceFixture(t);
  await writeFile(fixture.cutoutPath, await png('#ff0000'));

  await assert.rejects(
    () => fixture.service.approvedItemEvidenceForRun(fixture.runId),
    (error) => error instanceof ApprovedItemEvidenceError
      && error.code === 'APPROVED_ITEM_EVIDENCE_HASH_MISMATCH',
  );
});

test('item evidence rejects post-run edits to extracted facts not bound by the completed checkpoint', async (t) => {
  const fixture = await evidenceFixture(t);
  fixture.pack.extraction.items[0].observed.colors = ['substituted red'];
  await writeFile(fixture.packPath, `${JSON.stringify(fixture.pack, null, 2)}\n`);

  await assert.rejects(
    () => fixture.service.approvedItemEvidenceForRun(fixture.runId),
    (error) => error instanceof ApprovedItemEvidenceError
      && error.code === 'APPROVED_ITEM_EVIDENCE_CHECKPOINT_MISMATCH',
  );
});

test('item evidence rejects a binding that escapes its conditioned garment directory', async (t) => {
  const fixture = await evidenceFixture(t);
  const outsidePath = path.join(fixture.root, 'outside', 'cutout.png');
  const outside = await png('#0000ff');
  await mkdir(path.dirname(outsidePath), { recursive: true });
  await writeFile(outsidePath, outside);
  fixture.pack.generation_bindings[0].path = outsidePath;
  fixture.pack.generation_bindings[0].sha256 = sha256(outside);
  const changedPackBytes = Buffer.from(`${JSON.stringify(fixture.pack, null, 2)}\n`);
  await writeFile(fixture.packPath, changedPackBytes);
  fixture.checkpoint.inputs.outfit_reference_pack.sha256 = sha256(changedPackBytes);
  fixture.checkpoint.inputs.outfit_reference_pack_binding_001.path = outsidePath;
  fixture.checkpoint.inputs.outfit_reference_pack_binding_001.sha256 = sha256(outside);
  fixture.checkpoint.inputs.outfit_reference_pack_binding_001.declared_sha256 = sha256(outside);
  await rewriteExecutionReceipt(fixture);

  await assert.rejects(
    () => fixture.service.approvedItemEvidenceForRun(fixture.runId),
    (error) => error instanceof ApprovedItemEvidenceError
      && error.code === 'APPROVED_ITEM_EVIDENCE_PATH_ESCAPE',
  );
});

test('item evidence rejects symlinked pack components even when target bytes and hash are valid', async (t) => {
  const fixture = await evidenceFixture(t);
  const target = path.join(fixture.garmentDirectory, '01', 'actual-cutout.png');
  await writeFile(target, fixture.cutout);
  await unlink(fixture.cutoutPath);
  await symlink(target, fixture.cutoutPath);

  await assert.rejects(
    () => fixture.service.approvedItemEvidenceForRun(fixture.runId),
    (error) => error instanceof ApprovedItemEvidenceError
      && error.code === 'APPROVED_ITEM_EVIDENCE_SYMLINK',
  );
});

test('profile approved-look resolution adds item evidence and the scene adapter rejects transport paths', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'approved-item-profile-'));
  const outputs = path.join(root, 'outputs');
  await mkdir(outputs, { recursive: true });
  const image = Buffer.from('approved-look');
  const imagePath = path.join(outputs, 'avatar_outfit.png');
  const receiptPath = path.join(outputs, 'run-manifest.json');
  const runId = 'profile-item-run';
  const cutout = await png();
  const itemEvidence = {
    schema_version: '1.0.0',
    kind: 'APPROVED_ITEM_EVIDENCE',
    source_run_id: runId,
    reference_pack: {
      schema_version: '1.0.0',
      asset_id: `${runId}-wardrobe`,
      kind: 'GARMENT',
      sha256: 'a'.repeat(64),
      extraction: { method: 'strict_schema', provenance: 'OBSERVED' },
      readiness: { decision: 'READY', reasons: ['PASS'], actions: [], terminal: false },
    },
    items: [{
      order: 1,
      role: 'GARMENT_TOP',
      category: 'top',
      reference_set_id: 'set-0',
      source_indexes: [0],
      same_item_confidence: 1,
      grouping_evidence: ['single view'],
      confidence: 0.99,
      observed: {
        garment_type: 'top',
        colors: ['green'],
        material: [],
        pattern: [],
        logo_text: [],
        construction: [],
      },
      unknowns: [],
      sha256: sha256(cutout),
      media_type: 'image/png',
      data: cutout,
    }],
  };
  const receipt = Buffer.from(`${JSON.stringify({
    job_id: `web-${runId}`,
    state: 'COMPLETED',
    outputs: { avatar_outfit: { sha256: sha256(image) } },
    qa: {
      avatar: { decision: 'PASS' },
      outfit: { decision: 'PASS' },
    },
  })}\n`);
  await writeFile(imagePath, image);
  await writeFile(receiptPath, receipt);
  const runService = {
    async getRun() { return { run_id: runId, status: 'COMPLETED' }; },
    async outputFile(_runId, filename) {
      return filename === 'avatar_outfit.png' ? imagePath : receiptPath;
    },
    async approvedItemEvidenceForRun() { return itemEvidence; },
  };
  const profiles = new ProfileService({ databasePath: path.join(root, 'profiles.sqlite') });
  await profiles.initialize();
  const session = profiles.createSession();
  profiles.claimRun(session.profileId, runId);
  const saved = profiles.saveClaimedRun(session.profileId, runId);
  const reference = await profiles.approvedLookReference(
    session.profileId,
    saved.look.look_id,
    runService,
  );
  const resolver = createProfileApprovedLookResolver({ profiles, runService });
  const resolved = await resolver.resolveApprovedLook(reference);
  assert.equal(resolved.approved_item_evidence, itemEvidence);

  const unsafeResolver = createProfileApprovedLookResolver({
    runService,
    profiles: {
      async resolveApprovedLook() {
        return {
          ...resolved,
          approved_item_evidence: {
            ...itemEvidence,
            reference_pack: {
              ...itemEvidence.reference_pack,
              path: '/Users/private/reference-pack.json',
            },
          },
        };
      },
    },
  });
  await assert.rejects(
    () => unsafeResolver.resolveApprovedLook(reference),
    /private transport metadata/,
  );
  profiles.close();
  await rm(root, { recursive: true, force: true });
});
