import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function exists(filename) {
  try {
    await access(filename, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(filename, data) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await writeFile(temporary, data, { flag: 'wx' });
  await rename(temporary, filename);
}

async function binaryFrom(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (input && typeof input === 'object' && typeof input.path === 'string') {
    return readFile(input.path);
  }
  if (input && typeof input === 'object' && typeof input.base64 === 'string') {
    return Buffer.from(input.base64, 'base64');
  }
  throw new Error('Artifact binary must be a Buffer, Uint8Array, { path }, or { base64 }');
}

function normalizeExtension(extension) {
  if (!extension) return '.bin';
  const normalized = extension.startsWith('.') ? extension : `.${extension}`;
  if (!/^\.[a-zA-Z0-9]{1,10}$/.test(normalized)) throw new Error(`Unsafe artifact extension: ${extension}`);
  return normalized.toLowerCase();
}

export class FilesystemArtifactStore {
  constructor(rootDirectory) {
    this.rootDirectory = path.resolve(rootDirectory);
    this.blobDirectory = path.join(this.rootDirectory, 'artifacts', 'sha256');
    this.receiptDirectory = path.join(this.rootDirectory, 'receipts');
    this.checkpointPath = path.join(this.rootDirectory, 'checkpoint.json');
  }

  async initialize() {
    await mkdir(this.blobDirectory, { recursive: true });
    await mkdir(this.receiptDirectory, { recursive: true });
  }

  async putBinary(input, { extension = '.bin', mediaType = 'application/octet-stream' } = {}) {
    const bytes = await binaryFrom(input);
    const digest = sha256(bytes);
    const ext = normalizeExtension(extension);
    const blobPath = path.join(this.blobDirectory, `${digest}${ext}`);
    if (await exists(blobPath)) {
      const stored = await readFile(blobPath);
      if (sha256(stored) !== digest) {
        throw new Error(`Content-addressed artifact is corrupted: ${blobPath}`);
      }
    } else {
      await atomicWrite(blobPath, bytes);
    }
    return Object.freeze({ digest, path: blobPath, size: bytes.length, mediaType, extension: ext });
  }

  async putJson(value) {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    return this.putBinary(bytes, { extension: '.json', mediaType: 'application/json' });
  }

  async readArtifact(artifact) {
    if (!artifact
      || typeof artifact.path !== 'string'
      || !/^[a-f0-9]{64}$/.test(artifact.digest ?? '')
      || typeof artifact.extension !== 'string') {
      throw new Error('Invalid content-addressed artifact reference');
    }
    const resolved = path.resolve(artifact.path);
    const relative = path.relative(this.blobDirectory, resolved);
    if (relative === ''
      || relative.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative)
      || path.basename(resolved) !== `${artifact.digest}${artifact.extension}`) {
      throw new Error('Artifact reference escapes the content-addressed store');
    }
    const bytes = await readFile(resolved);
    if (sha256(bytes) !== artifact.digest) {
      throw new Error(`Content-addressed artifact failed integrity verification: ${resolved}`);
    }
    if (Number.isSafeInteger(artifact.size) && bytes.length !== artifact.size) {
      throw new Error(`Content-addressed artifact size changed: ${resolved}`);
    }
    return bytes;
  }

  async readJsonArtifact(artifact) {
    if (artifact?.mediaType !== 'application/json' || artifact?.extension !== '.json') {
      throw new Error('Expected a content-addressed JSON artifact');
    }
    const bytes = await this.readArtifact(artifact);
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new Error('Content-addressed JSON artifact is not valid JSON');
    }
  }

  receiptPath(idempotencyKey) {
    if (!/^[a-f0-9]{64}$/.test(idempotencyKey)) throw new Error('Invalid receipt idempotency key');
    return path.join(this.receiptDirectory, `${idempotencyKey}.json`);
  }

  async readReceipt(idempotencyKey) {
    const filename = this.receiptPath(idempotencyKey);
    if (!(await exists(filename))) return null;
    return JSON.parse(await readFile(filename, 'utf8'));
  }

  async writeReceipt(idempotencyKey, receipt) {
    const filename = this.receiptPath(idempotencyKey);
    const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
    if (await exists(filename)) {
      const current = await readFile(filename, 'utf8');
      if (current !== serialized) throw new Error(`Conflicting receipt for ${idempotencyKey}`);
      return filename;
    }
    await atomicWrite(filename, serialized);
    return filename;
  }

  async readCheckpoint() {
    if (!(await exists(this.checkpointPath))) return null;
    return JSON.parse(await readFile(this.checkpointPath, 'utf8'));
  }

  async writeCheckpoint(checkpoint) {
    await atomicWrite(this.checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  }

  async materialize(artifact, destination) {
    if (!artifact || typeof artifact.path !== 'string' || typeof artifact.digest !== 'string') {
      throw new Error('Cannot materialize an invalid artifact reference');
    }
    const source = await readFile(artifact.path);
    if (sha256(source) !== artifact.digest) {
      throw new Error(`Artifact source no longer matches its digest: ${artifact.path}`);
    }
    const target = path.resolve(destination);
    await mkdir(path.dirname(target), { recursive: true });
    if (await exists(target)) {
      const current = await readFile(target);
      if (sha256(current) !== artifact.digest) {
        throw new Error(`Refusing to overwrite an unrelated output: ${target}`);
      }
      return target;
    }
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await copyFile(artifact.path, temporary, fsConstants.COPYFILE_EXCL);
    const copied = await readFile(temporary);
    if (sha256(copied) !== artifact.digest) {
      await unlink(temporary);
      throw new Error(`Materialized artifact copy failed integrity verification: ${target}`);
    }
    await rename(temporary, target);
    if (sha256(await readFile(target)) !== artifact.digest) {
      await unlink(target);
      throw new Error(`Materialized output failed integrity verification: ${target}`);
    }
    return target;
  }

  async verifyMaterialized(artifact, destination) {
    try {
      const fileStat = await stat(destination);
      if (!fileStat.isFile()) return false;
      return sha256(await readFile(destination)) === artifact.digest;
    } catch {
      return false;
    }
  }

  async acquireLock() {
    await mkdir(this.rootDirectory, { recursive: true });
    const lockPath = path.join(this.rootDirectory, 'runner.lock');
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`);
      await handle.close();
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const lock = JSON.parse(await readFile(lockPath, 'utf8'));
        try {
          process.kill(lock.pid, 0);
        } catch (killError) {
          stale = killError.code === 'ESRCH';
        }
      } catch {
        stale = true;
      }
      if (!stale) throw new Error(`Run is already locked: ${this.rootDirectory}`);
      await unlink(lockPath);
      return this.acquireLock();
    }
    return async () => {
      try {
        await unlink(lockPath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    };
  }
}
