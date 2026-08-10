import { spawnSync } from 'node:child_process';
import path from 'node:path';

const PYTHON_TAR_MANIFEST = String.raw`
import json
import sys
import tarfile

with tarfile.open(sys.argv[1], mode="r:*") as archive:
    entries = []
    for member in archive.getmembers():
        if member.isfile():
            kind = "file"
        elif member.isdir():
            kind = "directory"
        elif member.issym():
            kind = "symlink"
        elif member.islnk():
            kind = "hardlink"
        elif member.ischr():
            kind = "character-device"
        elif member.isblk():
            kind = "block-device"
        elif member.isfifo():
            kind = "fifo"
        else:
            kind = "other"
        entries.append({"name": member.name, "kind": kind})
    print(json.dumps(entries, ensure_ascii=False))
`;

export function inspectTarArchive(archivePath, {
  python = 'python3',
  run = spawnSync,
} = {}) {
  const result = run(python, ['-c', PYTHON_TAR_MANIFEST, archivePath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`tar manifest inspector could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`tar manifest inspection failed: ${result.stderr?.trim() || 'unknown error'}`);
  }
  let entries;
  try {
    entries = JSON.parse(result.stdout);
  } catch {
    throw new Error('tar manifest inspector returned invalid JSON');
  }
  if (!Array.isArray(entries)) throw new Error('tar manifest inspector did not return an array');
  return entries;
}

export function validateTarManifest(entries, lock) {
  if (entries.length !== lock.file_count) {
    throw new Error(`archive file count mismatch: expected ${lock.file_count}, got ${entries.length}`);
  }
  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string' || typeof entry.kind !== 'string') {
      throw new Error('archive manifest contains a malformed entry');
    }
    if (!['file', 'directory'].includes(entry.kind)) {
      throw new Error(`archive contains unsupported ${entry.kind}: ${entry.name}`);
    }
    const normalized = path.posix.normalize(entry.name);
    if (
      !entry.name
      || entry.name.includes('\\')
      || entry.name.startsWith('/')
      || normalized !== entry.name
      || normalized.startsWith('../')
    ) {
      throw new Error(`unsafe archive path: ${entry.name}`);
    }
    if (!lock.allowed_prefixes.some((prefix) => entry.name.startsWith(prefix))) {
      throw new Error(`archive path is outside the allowlist: ${entry.name}`);
    }
  }
  return entries;
}
