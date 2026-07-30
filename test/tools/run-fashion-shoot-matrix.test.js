import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertReadySmokeMatrix,
  buildMatrixWaves,
  discoverFashionShootHeroes,
  matrixApprovalPlan,
  renderSmokeReport,
} from '../../tools/run-fashion-shoot-matrix.mjs';

function sha256(seed) {
  return seed.repeat(64).slice(0, 64);
}

async function writeShoot(root, index) {
  const id = `shoot_${index.toString(16).padStart(48, '0')}`;
  const token = (index + 1).toString(16);
  const directory = path.join(root, 'editorial-shoots', id);
  await mkdir(directory, { recursive: true });
  const attempts = index === 7
    ? [{ number: 1, status: 'FAIL', error: { code: 'EXECUTOR_FAILED' } }, { number: 2, status: 'PASS', error: null }]
    : [{ number: 1, status: 'PASS', error: null }];
  await writeFile(path.join(directory, 'shoot.json'), JSON.stringify({
    shoot_id: id,
    created_at: '2026-07-30T19:00:00.000Z',
    status: 'HERO_PENDING_APPROVAL',
    bindings: { shoot_bible: { mode_id: `shoot.style_${String(index).padStart(2, '0')}`, sha256: sha256(token) } },
    shots: [{
      status: 'QA_PASSED',
      retry_count: attempts.length - 1,
      output: { sha256: sha256(token), receipt_sha256: sha256((index + 2).toString(16)) },
      attempts,
    }],
  }));
}

test('Fashion Shoot matrix dispatches all 15 legacy smoke records while service owns the eight-job ceiling', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-fashion-matrix-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (let index = 0; index < 15; index += 1) await writeShoot(root, index);
  const rows = await discoverFashionShootHeroes(root, { since: '2026-07-30T19:00:00.000Z' });
  assert.equal(rows.length, 15);
  assertReadySmokeMatrix(rows);
  const waves = buildMatrixWaves(rows);
  assert.deepEqual(waves.map((wave) => wave.length), [15]);
  const plan = matrixApprovalPlan(rows);
  assert.equal(plan.maximum_inflight_generation_requests, 8);
  assert.equal(plan.total_customer_frames, 75);
  assert.equal(plan.launch_policy, 'start_all_five_frames_on_create');
  assert.match(renderSmokeReport(rows), /15\/15/);
  assert.match(renderSmokeReport(rows), /shoot\.style_07/);
});
