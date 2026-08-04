#!/usr/bin/env node
// Offline contract test for the VIDEO pipeline. It validates the motion plan,
// wire contract and any checked-in clip fixtures. `--server-smoke` adds only
// read-only health/catalog checks. `--live` is an explicit paid avatar/look
// generator smoke; Fashion Video provider-to-delivery E2E is covered by the
// persisted runtime audit and the dedicated test/video suite.
//
// Usage:
//   # Start the server first:
//   ZEELY_COOKIE_SECURE=false node src/web/start.js
//
//   # Then in another terminal:
//   node tools/test-video-pipeline.mjs --server-smoke
//
// The script never starts paid work unless both --live and
// ZEELY_ALLOW_PAID_TESTS=1 are supplied with explicit fixture paths.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const BASE = process.env.ZEELY_BASE_URL ?? 'http://localhost:4176';
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const LIVE = process.argv.includes('--live');
const SERVER_SMOKE = LIVE || process.argv.includes('--server-smoke');
const PAID_CONFIRMED = process.env.ZEELY_ALLOW_PAID_TESTS === '1';
const PERSON_FIXTURE = process.env.ZEELY_TEST_PERSON_PATH ?? null;
const GARMENT_FIXTURE = process.env.ZEELY_TEST_GARMENT_PATH ?? null;

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

const {
  buildMotionPlan,
  VIDEO_SURFACES,
  MOTION_MODES,
  videoSurface,
} = await import('../src/web/video-motion-plan.js');
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
  const s = videoSurface(surfaceId);
  const plan = buildMotionPlan({
    modeId: 'editorial_micro_moment',
    surface: surfaceId,
  });
  if (plan.surface === surfaceId) pass(`${surfaceId}: surface=${plan.surface}`);
  else fail(`${surfaceId}: expected surface=${surfaceId}, got ${plan.surface}`);

  if (plan.aspectRatio === s.aspectRatio) pass(`${surfaceId}: aspect=${plan.aspectRatio}`);
  else fail(`${surfaceId}: expected aspect=${s.aspectRatio}, got ${plan.aspectRatio}`);

  // Check that the prompt contains the hint but no geometry digits
  if (plan.prompt.includes(s.framingNote)) pass(`${surfaceId}: framing note in prompt`);
  else fail(`${surfaceId}: hint NOT in prompt`);

  if (!/\b\d+:\d+\b/.test(s.framingNote)) pass(`${surfaceId}: hint has no digit ratios`);
  else fail(`${surfaceId}: hint contains digit ratios — geometry guard will reject`);
}

// Verify all 8 mode+surface combos work
let comboCount = 0;
for (const mode of Object.values(MOTION_MODES)) {
  for (const surfaceId of Object.keys(VIDEO_SURFACES)) {
    try {
      buildMotionPlan({ modeId: mode.id, surface: surfaceId, sourceCapabilities: { full_length: true } });
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
section('Phase 4: Read-only server contract smoke');

let serverUp = false;
if (!SERVER_SMOKE) {
  info('Skipping server checks — pass --server-smoke (or --live) explicitly');
} else try {
  const healthRes = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
  const health = await healthRes.json();
  if (healthRes.ok && health.status === 'ready') {
    pass(`Server healthy: status=${health.status}, generation=${health.generation}`);
    serverUp = true;
    const [presetsRes, modesRes] = await Promise.all([
      fetch(`${BASE}/api/scene-presets`, { signal: AbortSignal.timeout(3000) }),
      fetch(`${BASE}/api/editorial-modes`, { signal: AbortSignal.timeout(3000) }),
    ]);
    if (!presetsRes.ok || !modesRes.ok) {
      fail(`Public catalogs unavailable: scenes=${presetsRes.status}, modes=${modesRes.status}`);
    } else {
      const [presets, modes] = await Promise.all([presetsRes.json(), modesRes.json()]);
      if (Array.isArray(presets.presets) && presets.presets.length > 0) {
        pass(`Scene catalog: ${presets.presets.length} presets`);
      } else fail('Scene catalog is empty or malformed');
      if (Array.isArray(modes.modes) && modes.modes.length > 0) {
        pass(`Creative catalog: ${modes.modes.length} modes`);
      } else fail('Creative catalog is empty or malformed');
    }
  } else {
    fail(`Server is not ready: HTTP ${healthRes.status}, status=${String(health.status)}`);
  }
} catch (error) {
  fail(`Server smoke failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (serverUp && LIVE && !PAID_CONFIRMED) {
  fail('--live requires ZEELY_ALLOW_PAID_TESTS=1');
}
if (serverUp && LIVE && (!PERSON_FIXTURE || !GARMENT_FIXTURE)) {
  fail('--live requires ZEELY_TEST_PERSON_PATH and ZEELY_TEST_GARMENT_PATH');
}

if (serverUp && LIVE && PAID_CONFIRMED && PERSON_FIXTURE && GARMENT_FIXTURE) {
  // Step 1: Upload person + garment to create a run
  info('Creating a run (simulating UI file upload)...');

  const personPath = path.resolve(PERSON_FIXTURE);
  const garmentPath = path.resolve(GARMENT_FIXTURE);

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
    const maxWait = 300_000;
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
        fail(`Avatar not available: ${avatarRes.status}`);
      }

      const lookRes = await fetch(`${BASE}/api/runs/${run.run_id}/files/avatar_outfit.png`);
      if (lookRes.ok) {
        const lookBytes = Buffer.from(await lookRes.arrayBuffer());
        pass(`Look downloaded: ${lookBytes.length} bytes, sha256=${sha256(lookBytes).slice(0, 12)}…`);

        // This look image is what would become the source for video generation
        info('This look image would be the locked source for video generation.');
        info('To run with real Seedance credits, pass --live flag.');
      } else {
        fail(`Look not available: ${lookRes.status}`);
      }
    } else if (current.status === 'NEEDS_INPUT') {
      fail(`Run needs input: ${current.message ?? 'garment selection required'}`);
    } else {
      fail(`Run ended with status: ${current.status} (waited ${((Date.now() - start) / 1000).toFixed(0)}s)`);
    }
  } else if (runRes.status === 503) {
    const err = await runRes.json();
    fail(`Generation unavailable (preflight degraded): ${err.code}`);
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
