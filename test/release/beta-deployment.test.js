import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { activeBetaRunIds, activeBetaWorkIds, hasLiveProviderWaitLease, parseBetaReleaseArguments, replaceRunnerAppRoot } from '../../tools/deploy-beta-release.mjs';

test('beta deploy parser requires explicit safe paths and canonical beta health', () => {
  const options = parseBetaReleaseArguments([
    '--release', '/tmp/release', '--runner', '/tmp/runner', '--beta-plist', '/tmp/beta.plist',
  ]);
  assert.equal(options.apply, false);
  assert.equal(options.external_health_url, 'https://beta.madeforthisjob.com/api/health');
  assert.throws(() => parseBetaReleaseArguments(['--release', 'relative', '--runner', '/x', '--beta-plist', '/y']), /must be absolute/);
});

test('beta deploy changes only the exact runner release pointer', () => {
  const source = '#!/bin/zsh\napp_root="/old"\nexport PORT=4176\n';
  assert.equal(replaceRunnerAppRoot(source, '/new'), '#!/bin/zsh\napp_root="/new"\nexport PORT=4176\n');
  assert.throws(() => replaceRunnerAppRoot('export PORT=4176\n', '/new'), /app_root/);
});

test('beta deploy discovers active runs before it can kickstart the service', async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-beta-deploy-'));
  await mkdir(path.join(runtimeRoot, 'runs', 'still-running'), { recursive: true });
  await mkdir(path.join(runtimeRoot, 'runs', 'finished'), { recursive: true });
  await writeFile(path.join(runtimeRoot, 'runs', 'still-running', 'run.json'), JSON.stringify({ run_id: 'still-running', status: 'RUNNING' }));
  await writeFile(path.join(runtimeRoot, 'runs', 'finished', 'run.json'), JSON.stringify({ run_id: 'finished', status: 'COMPLETED' }));
  const runner = `#!/bin/zsh\nruntime_root="${runtimeRoot}"\n`;
  assert.deepEqual(await activeBetaRunIds(runner), ['still-running']);
});

test('beta deploy refuses to restart through active scene, shoot, or video work', async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-beta-work-'));
  const submittingClipId = '11111111-1111-4111-8111-111111111111';
  const createdClipId = '22222222-2222-4222-8222-222222222222';
  const completedClipId = '33333333-3333-4333-8333-333333333333';
  await mkdir(path.join(runtimeRoot, 'scenes', 'scene_running'), { recursive: true });
  await mkdir(path.join(runtimeRoot, 'scenes', 'scene_complete'), { recursive: true });
  await mkdir(path.join(runtimeRoot, 'editorial-shoots', 'shoot_running'), { recursive: true });
  await mkdir(path.join(runtimeRoot, 'editorial-shoots', 'shoot_cancelled'), { recursive: true });
  await mkdir(path.join(runtimeRoot, 'editorial-shoots', 'shoot_pending'), { recursive: true });
  await mkdir(path.join(runtimeRoot, 'video-clips', 'clips', submittingClipId), { recursive: true });
  await mkdir(path.join(runtimeRoot, 'video-clips', 'clips', createdClipId), { recursive: true });
  await mkdir(path.join(runtimeRoot, 'video-clips', 'clips', completedClipId), { recursive: true });
  await mkdir(path.join(runtimeRoot, 'scenes', 'incidents'), { recursive: true });
  await writeFile(path.join(runtimeRoot, 'scenes', 'scene_running', 'scene.json'), JSON.stringify({ scene_id: 'scene_running', status: 'RUNNING' }));
  await writeFile(path.join(runtimeRoot, 'scenes', 'scene_complete', 'scene.json'), JSON.stringify({ scene_id: 'scene_complete', status: 'COMPLETED' }));
  await writeFile(path.join(runtimeRoot, 'editorial-shoots', 'shoot_running', 'shoot.json'), JSON.stringify({ shoot_id: 'shoot_running', status: 'HERO_RUNNING' }));
  await writeFile(path.join(runtimeRoot, 'editorial-shoots', 'shoot_cancelled', 'shoot.json'), JSON.stringify({ shoot_id: 'shoot_cancelled', status: 'CANCELLED' }));
  await writeFile(path.join(runtimeRoot, 'editorial-shoots', 'shoot_pending', 'shoot.json'), JSON.stringify({ shoot_id: 'shoot_pending', status: 'BIBLE_PENDING_APPROVAL' }));
  const now = new Date().toISOString();
  await writeFile(path.join(runtimeRoot, 'video-clips', 'clips', submittingClipId, 'clip.json'), JSON.stringify({
    clipId: submittingClipId, status: 'SUBMITTING', jobId: 'live-job',
    providerWaitLease: { jobId: 'live-job', heartbeatAt: now },
  }));
  await writeFile(path.join(runtimeRoot, 'video-clips', 'clips', createdClipId, 'clip.json'), JSON.stringify({ clipId: createdClipId, status: 'CREATED', jobId: 'durable-provider-job' }));
  await writeFile(path.join(runtimeRoot, 'video-clips', 'clips', completedClipId, 'clip.json'), JSON.stringify({ clipId: completedClipId, status: 'PASS' }));
  const runner = `#!/bin/zsh\nruntime_root="${runtimeRoot}"\n`;
  assert.deepEqual(await activeBetaWorkIds(runner), [
    `clip:${submittingClipId}`,
    'scene:scene_running',
    'shoot:shoot_running',
  ]);
});

test('beta deploy ignores stale video status without a fresh job-bound provider wait lease', async (t) => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'zeely-beta-stale-video-'));
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(runtimeRoot, { recursive: true, force: true })));
  const staleId = '44444444-4444-4444-8444-444444444444';
  await mkdir(path.join(runtimeRoot, 'video-clips', 'clips', staleId), { recursive: true });
  await writeFile(path.join(runtimeRoot, 'video-clips', 'clips', staleId, 'clip.json'), JSON.stringify({
    clipId: staleId, status: 'GENERATING', jobId: 'old-job',
    providerWaitLease: { jobId: 'old-job', heartbeatAt: '2000-01-01T00:00:00.000Z' },
  }));
  const runner = `#!/bin/zsh\nruntime_root="${runtimeRoot}"\n`;
  assert.equal(hasLiveProviderWaitLease({ status: 'NEEDS_QA', jobId: 'old-job' }), false);
  assert.equal(hasLiveProviderWaitLease({ status: 'GENERATING', jobId: 'old-job' }), false);
  assert.deepEqual(await activeBetaWorkIds(runner), []);
});
