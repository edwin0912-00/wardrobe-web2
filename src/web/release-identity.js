import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SHA256 = /^[a-f0-9]{40}$/;
const CACHE_TOKEN = /^product-[a-f0-9]{8}-[a-f0-9]{12}$/;

export async function loadReleaseIdentity(projectRoot) {
  try {
    const manifest = JSON.parse(await readFile(
      path.join(projectRoot, 'ops', 'product-release-manifest.json'),
      'utf8',
    ));
    if (!SHA256.test(manifest?.base_commit ?? '')
      || !CACHE_TOKEN.test(manifest?.cache_token ?? '')) {
      throw new Error('RELEASE_IDENTITY_INVALID');
    }
    return Object.freeze({
      release_sha: manifest.base_commit,
      cache_token: manifest.cache_token,
    });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
