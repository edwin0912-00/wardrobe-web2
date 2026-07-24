import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import {
  validatePresetSnapshot,
  validateReferencePack,
  validateResolvedReferenceAssets,
} from '../../src/web/scene-contract.js';
import { FilesystemScenePresetResolver } from '../../src/web/scene-resolvers.js';

const root = path.resolve(import.meta.dirname, '../..');
const selectedPath = path.join(root, 'config', 'scene-release-candidates.json');
const indexPath = path.join(root, 'assets', 'scene-presets', 'index.json');
const privatePathPattern = /(?:\/Users\/|[A-Za-z]:\\|file:\/\/|\.local\/share|mvp-zeely|madeforthisjob)/i;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function json(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

test('five selected reference packs are schema-valid and retain pending human approval', async () => {
  const [candidate, index, packSchema, ledgerSchema] = await Promise.all([
    json(selectedPath),
    json(indexPath),
    json(path.join(root, 'schemas', 'scene-reference-pack.schema.json')),
    json(path.join(root, 'schemas', 'scene-source-ledger.schema.json')),
  ]);
  assert.equal(candidate.approval.status, 'PENDING');
  assert.equal(index.approval.status, 'PENDING');
  assert.equal(candidate.selected_preset_ids.length, 5);
  assert.deepEqual(index.selected_preset_ids, candidate.selected_preset_ids);
  assert.equal(index.presets.length, 5);

  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  ajv.addSchema(ledgerSchema);
  const validate = ajv.compile(packSchema);
  for (const descriptor of index.presets) {
    const packPath = path.join(root, descriptor.reference_pack_path);
    const packBytes = await readFile(packPath);
    const pack = JSON.parse(packBytes);
    assert.equal(validate(pack), true, JSON.stringify(validate.errors, null, 2));
    assert.equal(sha256(packBytes), descriptor.reference_pack_sha256);
    assert.equal(pack.version, '1.1.0');
    assert.equal(pack.references.length, 5);
    assert.deepEqual(
      pack.references.map((reference) => reference.role),
      [
        'environment_anchor',
        'lighting_anchor',
        'composition_anchor',
        'palette_anchor',
        'negative_reference',
      ],
    );
    assert.ok(
      pack.references.every((reference) => reference.media_type === 'application/json'),
      `${descriptor.preset_id} must send strict extraction facts rather than preview pixels`,
    );
    assert.equal(
      new Set(pack.references.map((reference) => reference.sha256)).size,
      5,
      `${descriptor.preset_id} must not reuse one visual or fact asset across scene roles`,
    );
    assert.equal(pack.source_ledger.status, 'VERIFIED_FOR_RELEASE');
    assert.ok(pack.source_ledger.sources.length >= 2);
  }
});

test('every selected reference byte, source snapshot and rights receipt is hash-bound', async () => {
  const [index, structuredSchema] = await Promise.all([
    json(indexPath),
    json(path.join(root, 'schemas', 'scene-structured-reference.schema.json')),
  ]);
  const validateStructured = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  }).compile(structuredSchema);
  for (const descriptor of index.presets) {
    const pack = await json(path.join(root, descriptor.reference_pack_path));
    for (const binding of descriptor.references) {
      const bytes = await readFile(path.join(root, binding.path));
      assert.equal(sha256(bytes), binding.sha256, `${descriptor.preset_id}:${binding.role}`);
      assert.doesNotMatch(binding.path, privatePathPattern);
      if (binding.media_type.startsWith('image/')) {
        const metadata = await sharp(bytes).metadata();
        assert.ok(metadata.width && metadata.height);
      } else {
        const document = JSON.parse(bytes);
        assert.equal(
          validateStructured(document),
          true,
          `${descriptor.preset_id}:${binding.role}\n${JSON.stringify(validateStructured.errors, null, 2)}`,
        );
        assert.equal(document.role, binding.role);
      }
    }
    for (const source of pack.source_ledger.sources) {
      const [snapshotBytes, rightsBytes] = await Promise.all([
        readFile(path.join(root, source.snapshot_uri)),
        readFile(path.join(root, source.rights.evidence_uri)),
      ]);
      assert.equal(sha256(snapshotBytes), source.content_sha256);
      assert.equal(sha256(rightsBytes), source.rights.evidence_sha256);
      assert.equal(source.rights.status, 'VERIFIED');
      assert.equal(source.rights.basis, 'LICENSED');
      assert.doesNotMatch(JSON.stringify(source), privatePathPattern);
    }
  }
});

test('filesystem resolver fully loads all five immutable packs and every role asset', async () => {
  const index = await json(indexPath);
  const resolver = new FilesystemScenePresetResolver({
    rootDirectory: path.join(root, 'assets', 'scene-presets'),
    projectRoot: root,
  });
  await resolver.initialize();

  for (const descriptor of index.presets) {
    const reference = await resolver.presetReference({
      presetId: descriptor.preset_id,
      presetVersion: descriptor.preset_version,
    });
    const resolved = await resolver.resolveScenePreset(reference);
    assert.deepEqual(
      Object.keys(resolved.preset).sort(),
      [
        'camera',
        'environment',
        'family',
        'hard_negatives',
        'lighting',
        'mvp_assets',
        'palette',
        'post_selection_assets',
        'preset_id',
        'prompt_path',
        'source_authorities',
        'ui_name_uk',
        'version',
      ],
      `${descriptor.preset_id} must be an exact standard SceneSpec snapshot`,
    );
    assert.equal(resolved.assets.length, 5);
    assert.deepEqual(
      resolved.assets.map((asset) => asset.role),
      [
        'environment_anchor',
        'lighting_anchor',
        'composition_anchor',
        'palette_anchor',
        'negative_reference',
      ],
    );
    for (const asset of resolved.assets) {
      assert.equal(sha256(asset.data), asset.sha256);
    }
    assert.equal(validatePresetSnapshot(resolved.preset, reference), resolved.preset);
    assert.equal(
      validateReferencePack(
        resolved.reference_pack,
        reference,
        reference.preset_sha256,
        reference.prompt_sha256,
        resolved.preset,
      ),
      resolved.reference_pack,
    );
    assert.equal(
      validateResolvedReferenceAssets(resolved.reference_pack, resolved.assets),
      resolved.assets,
    );
  }
});

test('production prompts bind the look master and fail closed on framing and item drift', async () => {
  const index = await json(indexPath);
  for (const descriptor of index.presets) {
    const promptBytes = await readFile(path.join(root, descriptor.production_prompt_path));
    const prompt = promptBytes.toString('utf8');
    assert.equal(sha256(promptBytes), descriptor.prompt_sha256);
    assert.match(prompt, /LOOK_MASTER/);
    assert.match(prompt, /74–78%/);
    assert.match(prompt, /at least 8%/);
    assert.match(prompt, /2%/);
    assert.match(prompt, /both shoes/);
    assert.match(prompt, /identity drift/i);
    assert.match(prompt, /altered logo or text/i);
    assert.doesNotMatch(prompt, privatePathPattern);
  }
});

test('candidate provenance is explicit about missing provider receipts', async () => {
  const index = await json(indexPath);
  for (const descriptor of index.presets) {
    const provenance = await json(
      path.join(root, 'assets', 'scene-presets', descriptor.preset_id, 'v1', 'candidate-provenance.json'),
    );
    assert.equal(provenance.release_status, 'BLOCKED_MISSING_STABLE_PROVIDER_RECEIPTS');
    assert.equal(provenance.assets.length, 2);
    assert.ok(
      provenance.assets.every(
        (asset) => asset.provider_receipt_status === 'MISSING_FROM_BUILTIN_IMAGE_TOOL',
      ),
    );
  }
});
