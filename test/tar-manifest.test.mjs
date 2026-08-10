import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectTarArchive, validateTarManifest } from '../scripts/tar-manifest.mjs';

test('AppleDouble sidecars are validated but are not counted or extracted', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wardrobe-tar-manifest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = path.join(root, 'fixture.tar');
  const create = spawnSync('python3', ['-c', String.raw`
import io
import sys
import tarfile

with tarfile.open(sys.argv[1], mode="w", format=tarfile.PAX_FORMAT) as archive:
    for name, payload in (
        ("b/assets/._one.txt", b"apple-double-one"),
        ("b/assets/one.txt", b"one"),
        ("b/assets/._two.txt", b"apple-double-two"),
        ("b/assets/two.txt", b"two"),
    ):
        entry = tarfile.TarInfo(name)
        entry.size = len(payload)
        entry.pax_headers = {"SCHILY.xattr.user.test": "value"}
        archive.addfile(entry, io.BytesIO(payload))
`, archive], { encoding: 'utf8' });
  assert.equal(create.status, 0, create.stderr);

  const entries = inspectTarArchive(archive);
  assert.deepEqual(validateTarManifest(entries, {
    file_count: 2,
    allowed_prefixes: ['b/assets/'],
  }), [
    { name: 'b/assets/one.txt', kind: 'file' },
    { name: 'b/assets/two.txt', kind: 'file' },
  ]);
});

test('manifest validation rejects links and traversal before extraction', () => {
  const lock = { file_count: 1, allowed_prefixes: ['b/assets/'] };
  assert.throws(
    () => validateTarManifest([{ name: 'b/assets/escape', kind: 'symlink' }], lock),
    /unsupported symlink/,
  );
  assert.throws(
    () => validateTarManifest([{ name: 'b/assets/..\/escape', kind: 'file' }], lock),
    /unsafe archive path/,
  );
  assert.throws(
    () => validateTarManifest([{ name: 'b/assets/._orphan.png', kind: 'file' }], lock),
    /unmatched AppleDouble sidecar/,
  );
});
