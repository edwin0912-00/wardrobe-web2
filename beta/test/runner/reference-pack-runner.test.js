import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MockProvider } from '../../src/providers/mock-provider.js';
import { PipelineRunner } from '../../src/runner/pipeline-runner.js';
import { STATES } from '../../src/runner/state-machine.js';

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function put(directory, relativePath, contents) {
  const filename = path.join(directory, relativePath);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, contents);
  return filename;
}

async function putJson(directory, relativePath, value) {
  return put(directory, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zeely-reference-pack-'));
  const identityRaw = Buffer.from('raw-identity');
  const outfitRaw = Buffer.from('raw-outfit');
  await put(directory, 'input/person.jpg', identityRaw);
  await put(directory, 'input/hoodie.webp', outfitRaw);
  await put(directory, 'avatar.txt', 'avatar={{IDENTITY_REFERENCE}}\n');
  await put(
    directory,
    'outfit.txt',
    'identity={{ORIGINAL_IDENTITY_REFERENCE}} avatar={{APPROVED_AVATAR_REFERENCE}} outfit={{OUTFIT_REFERENCE}}\n',
  );

  const identityMedia = {
    normalized: Buffer.from('conditioned-normalized'),
    face: Buffer.from('conditioned-face'),
    person: Buffer.from('conditioned-person'),
  };
  const outfitMedia = {
    cutout: Buffer.from('garment-cutout'),
    card: Buffer.from('garment-reference-card'),
  };
  await put(directory, 'conditioned/identity/normalized.png', identityMedia.normalized);
  await put(directory, 'conditioned/identity/face.png', identityMedia.face);
  await put(directory, 'conditioned/identity/person.png', identityMedia.person);
  await put(directory, 'conditioned/outfit/cutout.png', outfitMedia.cutout);
  await put(directory, 'conditioned/outfit/card.png', outfitMedia.card);

  const identityPackPath = await putJson(directory, 'packs/identity/reference-pack.json', {
    schema_version: '1.0.0',
    asset_id: 'human-001',
    kind: 'HUMAN',
    source: {
      path: 'input/person.jpg',
      sha256: digest(identityRaw),
      immutable: true,
    },
    // Deliberately shuffled: explicit order, never JSON array order, controls generation.
    generation_bindings: [
      {
        order: 3,
        role: 'IDENTITY_PERSON_CONTEXT',
        path: 'conditioned/identity/person.png',
        sha256: digest(identityMedia.person),
      },
      {
        order: 1,
        role: 'IDENTITY_PRIMARY',
        path: 'conditioned/identity/normalized.png',
        sha256: digest(identityMedia.normalized),
      },
      {
        order: 2,
        role: 'IDENTITY_FACE_DETAIL',
        path: 'conditioned/identity/face.png',
        sha256: digest(identityMedia.face),
      },
    ],
  });
  const outfitPackPath = await putJson(directory, 'packs/outfit/reference-pack.json', {
    schema_version: '1.0.0',
    asset_id: 'hoodie-001',
    kind: 'GARMENT',
    source: {
      path: 'input/hoodie.webp',
      sha256: digest(outfitRaw),
      immutable: true,
    },
    generation_bindings: [
      {
        order: 2,
        role: 'GARMENT_REFERENCE_CARD',
        path: 'conditioned/outfit/card.png',
        sha256: digest(outfitMedia.card),
      },
      {
        order: 1,
        role: 'GARMENT_PRIMARY',
        path: 'conditioned/outfit/cutout.png',
        sha256: digest(outfitMedia.cutout),
      },
    ],
  });

  const jobPath = await putJson(directory, 'job.json', {
    job_id: 'pack-test-001',
    identity_reference: './input/person.jpg',
    identity_reference_pack: './packs/identity/reference-pack.json',
    output_directory: './output',
    prompts: { avatar: './avatar.txt', outfit: './outfit.txt' },
    outfit: {
      mode: 'reference_image_plus_text',
      text: 'Exact forest-green reference hoodie',
      reference: './input/hoodie.webp',
      reference_pack: './packs/outfit/reference-pack.json',
    },
    quality_references: [],
  });

  return {
    directory,
    jobPath,
    identityPackPath,
    outfitPackPath,
    identityNormalizedPath: path.join(directory, 'conditioned/identity/normalized.png'),
    expected: {
      avatar: [
        ['identity', 'IDENTITY_PRIMARY', path.join(directory, 'conditioned/identity/normalized.png')],
        ['identity', 'IDENTITY_FACE_DETAIL', path.join(directory, 'conditioned/identity/face.png')],
        ['identity', 'IDENTITY_PERSON_CONTEXT', path.join(directory, 'conditioned/identity/person.png')],
      ],
      outfit: [
        ['avatar', 'AVATAR_BASE'],
        ['identity', 'IDENTITY_PRIMARY', path.join(directory, 'conditioned/identity/normalized.png')],
        ['identity', 'IDENTITY_FACE_DETAIL', path.join(directory, 'conditioned/identity/face.png')],
        ['identity', 'IDENTITY_PERSON_CONTEXT', path.join(directory, 'conditioned/identity/person.png')],
        ['outfit', 'GARMENT_PRIMARY', path.join(directory, 'conditioned/outfit/cutout.png')],
        ['outfit', 'GARMENT_REFERENCE_CARD', path.join(directory, 'conditioned/outfit/card.png')],
      ],
    },
  };
}

test('passes every reference-pack derivative to generation in explicit deterministic order', async () => {
  const files = await fixture();
  const provider = new MockProvider();
  const result = await new PipelineRunner({ provider }).runJobFile(files.jobPath);
  assert.equal(result.status, STATES.COMPLETED);

  const generationCalls = provider.calls.filter((call) => call.operation === 'generate');
  const avatarReferences = generationCalls.find((call) => call.context.phase === 'avatar').context.references;
  const outfitReferences = generationCalls.find((call) => call.context.phase === 'outfit').context.references;

  assert.deepEqual(
    avatarReferences.ordered.map((item) => [item.scope, item.role, item.path]),
    files.expected.avatar,
  );
  assert.deepEqual(avatarReferences.ordered.map((item) => item.order), [1, 2, 3]);
  assert.ok(avatarReferences.ordered.every((item) => item.source === 'REFERENCE_PACK'));
  assert.ok(avatarReferences.ordered.every((item) => item.packPath === files.identityPackPath));
  assert.ok(avatarReferences.ordered.every((item) => item.packSha256 === avatarReferences.packs.identity.sha256));

  assert.deepEqual(
    outfitReferences.ordered.map((item) => [item.scope, item.role]),
    files.expected.outfit.map(([scope, role]) => [scope, role]),
  );
  assert.ok(outfitReferences.ordered[0].path.endsWith('.png'));
  assert.deepEqual(
    outfitReferences.ordered.slice(1).map((item) => item.path),
    files.expected.outfit.slice(1).map(([, , filename]) => filename),
  );
  assert.deepEqual(outfitReferences.ordered.map((item) => item.order), [1, 2, 3, 4, 5, 6]);
  assert.equal(outfitReferences.ordered[0].source, 'APPROVED_AVATAR');
  assert.ok(outfitReferences.ordered.slice(1).every((item) => item.source === 'REFERENCE_PACK'));

  const checkpoint = JSON.parse(await readFile(result.checkpointPath, 'utf8'));
  assert.equal(checkpoint.inputs.identity_reference_pack.path, files.identityPackPath);
  assert.equal(checkpoint.inputs.identity_reference_pack.sha256, avatarReferences.packs.identity.sha256);
  assert.equal(checkpoint.inputs.identity_reference_pack_binding_001.role, 'IDENTITY_PRIMARY');
  assert.equal(
    checkpoint.inputs.identity_reference_pack_binding_001.sha256,
    avatarReferences.ordered[0].sha256,
  );
  assert.equal(checkpoint.inputs.outfit_reference_pack.path, files.outfitPackPath);
  assert.equal(checkpoint.inputs.outfit_reference_pack_binding_002.role, 'GARMENT_REFERENCE_CARD');
});

test('detects an immutable reference-pack JSON change before checkpoint reuse', async () => {
  const files = await fixture();
  const runner = new PipelineRunner({ provider: new MockProvider() });
  await runner.runJobFile(files.jobPath);
  const pack = JSON.parse(await readFile(files.identityPackPath, 'utf8'));
  pack.audit_note = 'pack bytes changed';
  await writeFile(files.identityPackPath, `${JSON.stringify(pack, null, 2)}\n`);
  await assert.rejects(
    () => runner.runJobFile(files.jobPath),
    /referenced input or prompt changed/,
  );
});

test('detects derivative byte changes against the SHA locked by the reference pack', async () => {
  const files = await fixture();
  const runner = new PipelineRunner({ provider: new MockProvider() });
  await runner.runJobFile(files.jobPath);
  await writeFile(files.identityNormalizedPath, Buffer.from('tampered-conditioned-normalized'));
  await assert.rejects(
    () => runner.runJobFile(files.jobPath),
    /identity reference pack binding 1 sha256 mismatch/,
  );
});
