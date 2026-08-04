import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FilesystemArtifactStore } from '../../src/runner/artifact-store.js';

async function storeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'artifact-integrity-'));
  const store = new FilesystemArtifactStore(path.join(root, 'run'));
  await store.initialize();
  return { root, store };
}

test('content-addressed store refuses to reuse a corrupted existing blob', async () => {
  const { store } = await storeFixture();
  const bytes = Buffer.from('immutable-content');
  const artifact = await store.putBinary(bytes, {
    extension: '.bin',
    mediaType: 'application/octet-stream',
  });
  await writeFile(artifact.path, Buffer.from('mutated-content'));

  await assert.rejects(
    () => store.putBinary(bytes, {
      extension: '.bin',
      mediaType: 'application/octet-stream',
    }),
    /artifact is corrupted/i,
  );
});

test('artifact reader rejects a digest-correct file outside its own blob store', async () => {
  const { root, store } = await storeFixture();
  const artifact = await store.putJson({ approved: true });
  const externalPath = path.join(root, `${artifact.digest}.json`);
  await writeFile(externalPath, await readFile(artifact.path));

  await assert.rejects(
    () => store.readJsonArtifact({ ...artifact, path: externalPath }),
    /escapes the content-addressed store/i,
  );
});

test('materialization verifies source bytes before creating a public output', async () => {
  const { root, store } = await storeFixture();
  const artifact = await store.putBinary(Buffer.from('approved-output'), {
    extension: '.bin',
    mediaType: 'application/octet-stream',
  });
  await writeFile(artifact.path, Buffer.from('tampered-output'));
  const destination = path.join(root, 'public', 'output.bin');

  await assert.rejects(
    () => store.materialize(artifact, destination),
    /source no longer matches its digest/i,
  );
  await assert.rejects(() => readFile(destination), { code: 'ENOENT' });
});
