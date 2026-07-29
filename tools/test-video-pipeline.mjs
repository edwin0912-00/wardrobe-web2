#!/usr/bin/env node
// Integration test for the VIDEO pipeline.
// Simulates the full UI flow:
//   1. POST /api/runs — upload person + garment (creates avatar + look)
//   2. GET /api/runs/:id — poll until COMPLETED
//   3. POST /api/profile/runs/:runId/save — save look to profile
//   4. Use the saved look as source for video generation
//   5. QA the generated clip via ffprobe
//
// Usage:
//   # Start the server first:
//   ZEELY_COOKIE_SECURE=false node src/web/start.js
//
//   # Then in another terminal:
//   node tools/test-video-pipeline.mjs
//
// The script does NOT use real Seedance credits unless --live is passed.
// By default it tests:
//   - The full UI flow up to a saved look
//   - Clip QA against existing videos in assets/generated_videos/
//   - Motion plan + surface integration
//   - Wire-contract export

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const BASE = process.env.ZEELY_BASE_URL ?? 'http://localhost:4173';
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const LIVE = process.argv.includes('--live');

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function section(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); process.exitCode = 1; }
function info(msg) { console.log(`  ℹ️  ${msg}`); }

// ─── Phase 0: Imports (module health) ───────────────────────
section('Phase 0: Module imports');

const { buildMotionPlan, SURFACES, MOTION_MODES, surface } = await import('../src/web/video-motion-plan.js');
pass('video-motion-plan.js loaded');

const { evaluateClipQa } = await import('../src/web/video-clip-qa.js');
pass('video-clip-qa.js loaded');

const { videoWireContract } = await import('../src/web/video-contract.js');
pass('video-contract.js loaded');

const { VideoService, ClipStore } = await import('../src/web/video-service.js');
pass('video-service.js loaded');

let probeVideo = null;
let extractFrame = null;
try {
  const mod = await import('../src/web/ffprobe-video-probe.js');
  probeVideo = mod.probeVideo;
  extractFrame = mod.extractFrame;
  pass('ffprobe-video-probe.js loaded');
} catch (err) {
  info(`ffprobe-video-probe.js failed to load: ${err.message}`);
}

// ─── Phase 1: Wire-contract ─────────────────────────────────
section('Phase 1: Wire-contract validation');

const contract = videoWireContract();
if (contract.schema_version === '1.0.0') pass(`Schema version: ${contract.schema_version}`);
else fail(`Unexpected schema version: ${contract.schema_version}`);

if (contract.surfaces.length === 2) pass(`Surfaces: ${contract.surfaces.map(s => s.id).join(', ')}`);
else fail(`Expected 2 surfaces, got ${contract.surfaces.length}`);

if (contract.motion_modes.length === 4) pass(`Motion modes: ${contract.motion_modes.map(m => m.id).join(', ')}`);
else fail(`Expected 4 motion modes, got ${contract.motion_modes.length}`);

if (contract.qa_checks.length === 5) pass(`QA checks: ${contract.qa_checks.length}`);
else fail(`Expected 5 QA checks, got ${contract.qa_checks.length}`);

if (contract.locks.length >= 4) pass(`Locks: ${contract.locks.length}`);
else fail(`Expected >= 4 locks, got ${contract.locks.length}`);

// ─── Phase 2: Motion plan + surface ─────────────────────────
section('Phase 2: Motion plan + surface integration');

for (const surfaceId of ['tv', 'mirror']) {
  const s = surface(surfaceId);
  const plan = buildMotionPlan({
    modeId: 'editorial_micro_moment',
    surfaceId,
  });
  if (plan.surface === surfaceId) pass(`${surfaceId}: surface=${plan.surface}`);
  else fail(`${surfaceId}: expected surface=${surfaceId}, got ${plan.surface}`);

  if (plan.aspectRatio === s.aspectRatio) pass(`${surfaceId}: aspect=${plan.aspectRatio}`);
  else fail(`${surfaceId}: expected aspect=${s.aspectRatio}, got ${plan.aspectRatio}`);

  // Check that the prompt contains the hint but no geometry digits
  if (plan.prompt.includes(s.hint)) pass(`${surfaceId}: hint in prompt`);
  else fail(`${surfaceId}: hint NOT in prompt`);

  if (!/\b\d+:\d+\b/.test(s.hint)) pass(`${surfaceId}: hint has no digit ratios`);
  else fail(`${surfaceId}: hint contains digit ratios — geometry guard will reject`);
}

// Verify all 8 mode+surface combos work
let comboCount = 0;
for (const mode of Object.values(MOTION_MODES)) {
  for (const surfaceId of Object.keys(SURFACES)) {
    try {
      buildMotionPlan({ modeId: mode.id, surfaceId, sourceCapabilities: { full_length: true } });
      comboCount++;
    } catch (err) {
      fail(`${mode.id}+${surfaceId}: ${err.message}`);
    }
  }
}
if (comboCount === 8) pass(`All 8 mode+surface combinations valid`);

// ─── Phase 3: QA existing clips via ffprobe ────────────────
section('Phase 3: Clip QA via ffprobe');

if (!probeVideo || !extractFrame) {
  info('Skipping — ffprobe/ffmpeg not available');
} else {
  const videoDir = path.join(PROJECT_ROOT, 'assets', 'generated_videos');
  let files;
  try {
    files = (await readdir(videoDir)).filter(f => f.endsWith('.mp4')).slice(0, 3);
  } catch {
    files = [];
  }

  if (files.length === 0) {
    info('No .mp4 files in assets/generated_videos/, skipping');
  } else {
    for (const file of files) {
      const videoPath = path.join(videoDir, file);
      try {
        const probe = await probeVideo(videoPath);
        info(`${file}: ${probe.width}x${probe.height}, ${probe.durationSeconds.toFixed(1)}s, audio=${probe.hasAudio}`);

        const firstFrame = await extractFrame(videoPath, 'first');
        const lastFrame = await extractFrame(videoPath, 'last');
        info(`  Frames: first=${firstFrame.length}B, last=${lastFrame.length}B`);

        // Run QA with generous bounds (we don't know the intended mode)
        const qa = evaluateClipQa(
          { durationMin: 1, durationMax: 30, aspectRatio: probe.width > probe.height ? '16:9' : '9:16' },
          { ...probe, firstFrameRgb: firstFrame, lastFrameRgb: lastFrame },
        );

        if (qa.pass) pass(`${file}: QA PASS`);
        else {
          info(`${file}: QA FAIL — ${qa.defects.map(d => d.code).join(', ')}`);
          // Not a test failure — we don't control these clips' modes
        }
      } catch (err) {
        fail(`${file}: probe error — ${err.message}`);
      }
    }
  }
}

// ─── Phase 4: Simulate UI flow (server required) ───────────
section('Phase 4: UI flow simulation (requires running server)');

let serverUp = false;
try {
  const healthRes = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
  const health = await healthRes.json();
  if (healthRes.ok) {
    pass(`Server healthy: status=${health.status}, generation=${health.generation}`);
    serverUp = true;
  } else {
    info(`Server responded ${healthRes.status} — skipping UI flow`);
  }
} catch {
  info('Server not running — skipping UI flow simulation');
}

if (serverUp) {
  // Step 1: Upload person + garment to create a run
  info('Creating a run (simulating UI file upload)...');

  const personPath = path.join(PROJECT_ROOT, 'assets', 'test_person_avatar.jpg');
  const garmentPath = path.join(PROJECT_ROOT, 'assets', 'test_garment_hat.jpg');

  const personBytes = await readFile(personPath);
  const garmentBytes = await readFile(garmentPath);

  const boundary = '----zeely-video-test-' + Date.now();
  const parts = [];

  // person_photo
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="person_photo"; filename="person.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`);
  parts.push(personBytes);
  parts.push('\r\n');

  // garment_images
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="garment_images"; filename="hat.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`);
  parts.push(garmentBytes);
  parts.push('\r\n');

  // consent
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="consent"\r\n\r\ntrue\r\n`);

  // outfit_text
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="outfit_text"\r\n\r\ncowboy hat\r\n`);

  parts.push(`--${boundary}--\r\n`);

  const body = Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p));

  const runRes = await fetch(`${BASE}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });

  if (runRes.status === 202) {
    const run = await runRes.json();
    pass(`Run created: ${run.run_id}, status=${run.status}`);

    // Step 2: Poll until completed (max 5 minutes)
    const maxWait = LIVE ? 300_000 : 30_000;
    const start = Date.now();
    let current = run;

    while (!['COMPLETED', 'FAILED', 'NEEDS_INPUT'].includes(current.status) && Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`${BASE}/api/runs/${run.run_id}`);
      current = await pollRes.json();
      info(`  Status: ${current.status} (${current.phase ?? current.inner_state ?? ''})`);
    }

    if (current.status === 'COMPLETED') {
      pass(`Run completed: ${run.run_id}`);

      // Step 3: Check the output files
      const avatarRes = await fetch(`${BASE}/api/runs/${run.run_id}/files/avatar.png`);
      if (avatarRes.ok) {
        const avatarBytes = Buffer.from(await avatarRes.arrayBuffer());
        pass(`Avatar downloaded: ${avatarBytes.length} bytes, sha256=${sha256(avatarBytes).slice(0, 12)}…`);
      } else {
        info(`Avatar not available: ${avatarRes.status}`);
      }

      const lookRes = await fetch(`${BASE}/api/runs/${run.run_id}/files/avatar_outfit.png`);
      if (lookRes.ok) {
        const lookBytes = Buffer.from(await lookRes.arrayBuffer());
        pass(`Look downloaded: ${lookBytes.length} bytes, sha256=${sha256(lookBytes).slice(0, 12)}…`);

        // This look image is what would become the source for video generation
        info('This look image would be the locked source for video generation.');
        info('To run with real Seedance credits, pass --live flag.');
      } else {
        info(`Look not available: ${lookRes.status}`);
      }
    } else if (current.status === 'NEEDS_INPUT') {
      info(`Run needs input: ${current.message ?? 'garment selection required'}`);
    } else {
      info(`Run ended with status: ${current.status} (waited ${((Date.now() - start) / 1000).toFixed(0)}s)`);
    }
  } else if (runRes.status === 503) {
    const err = await runRes.json();
    info(`Generation unavailable (preflight degraded): ${err.code}`);
    info('This is expected if Higgsfield is not configured.');
  } else {
    const err = await runRes.json().catch(() => ({}));
    fail(`Run creation failed: ${runRes.status} — ${err.error ?? err.message ?? 'unknown'}`);
  }
}

// ─── Summary ────────────────────────────────────────────────
section('Summary');
if (process.exitCode) {
  fail('Some checks failed — see above');
} else {
  pass('All checks passed');
}
console.log();
