import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWebApp } from '../../src/web/app.js';

test('manifest download sanitizes a historical receipt without rewriting it', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'public-manifest-route-'));
  const filename = path.join(root, 'run-manifest.json');
  const historical = {
    schema_version: '1.0.0',
    run_id: 'historical-run',
    job_id: 'web-historical-run',
    state: 'COMPLETED',
    outputs: { avatar: { path: '/Users/private-user/runtime/avatar.png', sha256: 'a'.repeat(64) } },
    models: { avatar: { name: 'GPT Image 2', job_set_type: 'gpt_image_2' } },
    prompts: { avatar: { phase: 'avatar', attempt: 1, sha256: 'b'.repeat(64), path: '/Users/private-user/prompt.txt', text: 'Zeely internal prompt' } },
    qa: { avatar: { decision: 'PASS', reason: 'verified', checks: [], defects: [], artifact: { digest: 'c'.repeat(64), path: '/Users/private-user/qa.json' } } },
  };
  await writeFile(filename, `${JSON.stringify(historical, null, 2)}\n`);
  const internalBytes = await readFile(filename);
  const service = {
    async outputFile(runId, name) {
      return runId === 'historical-run' && name === 'run-manifest.json' ? filename : null;
    },
  };
  const app = await createWebApp({ service });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const response = await app.inject({ method: 'GET', url: '/api/runs/historical-run/files/run-manifest.json' });

  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.headers['content-type'], /^application\/json/u);
  assert.deepEqual(response.json().outputs.avatar, { sha256: 'a'.repeat(64) });
  assert.deepEqual(response.json().prompts.avatar, { phase: 'avatar', attempt: 1, sha256: 'b'.repeat(64) });
  assert.doesNotMatch(response.body, /\/Users\/|private-user|zeely|"path"|"text"/iu);
  assert.deepEqual(await readFile(filename), internalBytes, 'HTTP projection must not mutate a historical hash-bound receipt');
});
