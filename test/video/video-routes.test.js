import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Fastify from 'fastify';

import { registerVideoRoutes } from '../../src/web/video-routes.js';
import { ProfileError } from '../../src/web/profile-service.js';

function fixture() {
  const projected = [];
  const createRequests = [];
  let finalizeCalls = 0;
  let projectionStatus;
  let liveClip = {
    clipId: '11111111-1111-4111-8111-111111111111',
    jobId: 'higgs-job-1',
    status: 'CREATED',
    mode: 'editorial_micro_moment',
    surface: 'mirror',
    durationSeconds: 5,
    createdAt: '2026-07-29T20:00:00.000Z',
    updatedAt: '2026-07-29T20:00:00.000Z',
  };
  projectionStatus = liveClip.status;
  const profiles = {
    ownsLook: () => true,
    lookAsset: () => ({ runId: '22222222-2222-4222-8222-222222222222', filename: 'avatar_outfit.png' }),
    approvedLookReference: async () => ({
      look_id: '33333333-3333-4333-8333-333333333333',
      image_sha256: 'b'.repeat(64),
      receipt_sha256: 'c'.repeat(64),
    }),
    approvedLookLiveReference: async () => ({
      image: Buffer.from('garment-reference'),
      reference_sha256: 'f'.repeat(64),
    }),
    projectVideoClip(profileId, lookId, clip) {
      projected.push({ profileId, lookId, clip });
      projectionStatus = clip.status;
      return {
        clip_id: clip.clip_id,
        look_id: lookId,
        status: clip.status,
        output_sha256: clip.output?.sha256 ?? null,
      };
    },
    videoClipProjection: () => ({
      clip_id: liveClip.clipId,
      look_id: '33333333-3333-4333-8333-333333333333',
      status: projectionStatus,
    }),
    deleteVideoClip: () => true,
    listVideoClips: () => [],
  };
  const videoService = {
    async createClip(request) {
      createRequests.push(request);
      return {
        clipId: liveClip.clipId,
        jobId: liveClip.jobId,
        status: liveClip.status,
        plan: { surface: liveClip.surface, aspectRatio: '9:16' },
      };
    },
    async getClip() {
      return liveClip;
    },
    async finalizeClip() {
      finalizeCalls++;
      liveClip = {
        ...liveClip,
        status: 'PASS',
        videoSha256: 'a'.repeat(64),
        qa: { pass: true, defects: [] },
        updatedAt: '2026-07-29T20:05:00.000Z',
      };
      return { clipId: liveClip.clipId, status: liveClip.status };
    },
  };
  return {
    profiles,
    projected,
    createRequests,
    videoService,
    finalizeCalls: () => finalizeCalls,
    setLiveClip(next) { liveClip = { ...liveClip, ...next }; },
    setProjectionStatus(next) { projectionStatus = next; },
  };
}

const availableStyles = [1, 2, 3].map((index) => ({
  id: `style-${index}`,
  title: `Style ${index}`,
  motion_mode: `motion_${index}`,
  presentation_surface: 'mirror',
  aspect_ratio: '9:16',
  playback_path: `/runtime/references/playback-${index}.mp4`,
  playback_sha256: String(index + 3).repeat(64),
  preview_sha256: String(index).repeat(64),
}));

test('create fails closed before provider spend while Fashion Video has no reference pack', async (t) => {
  const current = fixture();
  const app = Fastify();
  t.after(() => app.close());
  await registerVideoRoutes(app, {
    profileApi: {
      resolveRequestProfile: async () => ({ profileId: 'profile-1' }),
    },
    profiles: current.profiles,
    videoService: current.videoService,
    runService: {
      outputFile: async () => '/runtime/runs/source/avatar_outfit.png',
      approvedIdentityFaceReferenceForRun: async () => ({
        role: 'identity_face',
        data: Buffer.from('identity-reference'),
        sha256: 'a'.repeat(64),
        white_background_verified: true,
      }),
    },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/profile/video-clips',
    payload: {
      look_id: '33333333-3333-4333-8333-333333333333',
      surface: 'mirror',
      style_id: 'style-1',
      motion_mode: 'editorial_micro_moment',
    },
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().code, 'FASHION_VIDEO_REFERENCE_PACK_REQUIRED');
  assert.equal(current.projected.length, 0);
  assert.equal(current.createRequests.length, 0);
});

test('saved-look capability fails closed when the runtime cannot prove both references', async (t) => {
  const current = fixture();
  const app = Fastify();
  t.after(() => app.close());
  await registerVideoRoutes(app, {
    profileApi: {
      resolveRequestProfile: async () => ({ profileId: 'profile-1' }),
    },
    profiles: current.profiles,
    videoService: current.videoService,
    runService: { outputFile: async () => null },
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/profile/looks/33333333-3333-4333-8333-333333333333/video-capability',
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    capability: 'fashion_video',
    look_id: '33333333-3333-4333-8333-333333333333',
    available: false,
    styles: [],
    create_route: '/api/profile/video-clips',
    requirements: {
      approved_master_look: true,
      verified_style_reference: false,
      verified_motion_reference: false,
      verified_video_style_catalog: false,
    },
    reason_code: 'FASHION_VIDEO_REFERENCE_PACK_REQUIRED',
    next_action: 'SELECT_VERIFIED_VIDEO_STYLE',
  });
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(current.createRequests.length, 0);
});

test('saved-look capability opens only from the server-verified two-reference contract', async (t) => {
  const current = fixture();
  current.videoService.fashionVideoCapability = async () => ({
    state: 'READY',
    reference_path: '/runtime/references/motion.mp4',
    reference_sha256: 'd'.repeat(64),
    reference_pack_sha256: 'e'.repeat(64),
    available_styles: availableStyles,
  });
  const app = Fastify();
  t.after(() => app.close());
  await registerVideoRoutes(app, {
    profileApi: {
      resolveRequestProfile: async () => ({ profileId: 'profile-1' }),
    },
    profiles: current.profiles,
    videoService: current.videoService,
    runService: { outputFile: async () => null },
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/profile/looks/33333333-3333-4333-8333-333333333333/video-capability',
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    capability: 'fashion_video',
    look_id: '33333333-3333-4333-8333-333333333333',
    available: true,
    styles: availableStyles.map((style) => ({
      id: style.id,
      title: style.title,
      motion_mode: style.motion_mode,
      presentation_surface: style.presentation_surface,
      aspect_ratio: style.aspect_ratio,
      preview_url: `/api/profile/looks/33333333-3333-4333-8333-333333333333/video-styles/${style.id}/preview`,
      playback_url: `/api/profile/looks/33333333-3333-4333-8333-333333333333/video-styles/${style.id}/playback?v=${style.playback_sha256.slice(0, 16)}`,
      reference_url: `/api/profile/looks/33333333-3333-4333-8333-333333333333/video-styles/${style.id}/reference`,
    })),
    create_route: '/api/profile/video-clips',
    requirements: {
      approved_master_look: true,
      verified_style_reference: true,
      verified_motion_reference: true,
      verified_video_style_catalog: true,
    },
    reason_code: 'FASHION_VIDEO_READY',
    next_action: 'CREATE_FASHION_VIDEO',
  });
  assert.equal(current.createRequests.length, 0);
});

test('style cards stream the small hash-bound playback derivative with immutable byte ranges', async (t) => {
  const current = fixture();
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-video-playback-route-'));
  const playbackPath = path.join(root, 'playback.mp4');
  const bytes = Buffer.from('small-playback');
  await writeFile(playbackPath, bytes);
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  current.videoService.fashionVideoCapability = async ({ referenceId }) => ({
    state: 'READY',
    selected_style_id: referenceId,
    playback_path: playbackPath,
  });
  const app = Fastify();
  t.after(() => app.close());
  await registerVideoRoutes(app, {
    profileApi: { resolveRequestProfile: async () => ({ profileId: 'profile-1' }) },
    profiles: current.profiles,
    videoService: current.videoService,
    runService: { outputFile: async () => null },
  });
  const response = await app.inject({
    method: 'GET',
    url: '/api/profile/looks/33333333-3333-4333-8333-333333333333/video-styles/style-1/playback?v=hash-version',
    headers: { range: 'bytes=1-5' },
  });
  assert.equal(response.statusCode, 206, response.body);
  assert.equal(response.headers['content-type'], 'video/mp4');
  assert.equal(response.headers['content-range'], 'bytes 1-5/14');
  assert.equal(response.headers['cache-control'], 'private, max-age=31536000, immutable');
  assert.equal(response.headers.vary, 'Cookie');
  assert.equal(response.rawPayload.toString(), 'mall-');
});

test('the visible style card streams the exact verified source video with byte ranges', async (t) => {
  const current = fixture();
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-video-style-route-'));
  const referencePath = path.join(root, 'style.mp4');
  const bytes = Buffer.from('0123456789');
  await writeFile(referencePath, bytes);
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  current.videoService.fashionVideoCapability = async ({ referenceId }) => ({
    state: 'READY',
    selected_style_id: referenceId,
    reference_path: referencePath,
    preview_path: referencePath,
  });
  const app = Fastify();
  t.after(() => app.close());
  await registerVideoRoutes(app, {
    profileApi: { resolveRequestProfile: async () => ({ profileId: 'profile-1' }) },
    profiles: current.profiles,
    videoService: current.videoService,
    runService: { outputFile: async () => null },
  });
  const response = await app.inject({
    method: 'GET',
    url: '/api/profile/looks/33333333-3333-4333-8333-333333333333/video-styles/style-1/reference',
    headers: { range: 'bytes=2-5' },
  });
  assert.equal(response.statusCode, 206, response.body);
  assert.equal(response.headers['content-type'], 'video/mp4');
  assert.equal(response.headers['content-range'], 'bytes 2-5/10');
  assert.equal(response.rawPayload.toString(), '2345');
});

test('a legacy generic animation is never delivered as Fashion Video', async (t) => {
  const current = fixture();
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeely-video-style-delivery-'));
  const videoPath = path.join(root, 'legacy.mp4');
  await writeFile(videoPath, 'legacy-video');
  current.setLiveClip({ status: 'PASS', videoPath, videoSha256: 'a'.repeat(64) });
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const app = Fastify();
  t.after(() => app.close());
  await registerVideoRoutes(app, {
    profileApi: { resolveRequestProfile: async () => ({ profileId: 'profile-1' }) },
    profiles: current.profiles,
    videoService: current.videoService,
    runService: { outputFile: async () => null },
  });
  const response = await app.inject({
    method: 'GET',
    url: '/api/profile/video-clips/11111111-1111-4111-8111-111111111111/video',
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().code, 'VIDEO_STYLE_PROVENANCE_MISSING');
});

test('status gives the real terminal provider reason instead of a connection or timeout fiction', async (t) => {
  const current = fixture();
  current.setLiveClip({ status: 'FAILED', failureCode: 'VIDEO_PROVIDER_JOB_NOT_FOUND' });
  const app = Fastify();
  t.after(() => app.close());
  await registerVideoRoutes(app, {
    profileApi: { resolveRequestProfile: async () => ({ profileId: 'profile-1' }) },
    profiles: current.profiles,
    videoService: current.videoService,
    runService: { outputFile: async () => null },
  });
  const response = await app.inject({
    method: 'GET', url: '/api/profile/video-clips/11111111-1111-4111-8111-111111111111',
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().failure_code, 'VIDEO_PROVIDER_JOB_NOT_FOUND');
  assert.match(response.json().error, /не має цей job/);
  assert.equal(response.json().next_action, 'RETRY_AVAILABLE');
  assert.equal(response.json().retry_available, true);
});

test('status repairs a stale CREATED profile projection from the terminal runtime QA result', async (t) => {
  const current = fixture();
  current.setProjectionStatus('CREATED');
  current.setLiveClip({
    status: 'FAIL',
    qa: { pass: false, defects: [{ code: 'CLIP_UNAUTHORIZED_AUDIO' }] },
  });
  const app = Fastify();
  t.after(() => app.close());
  await registerVideoRoutes(app, {
    profileApi: { resolveRequestProfile: async () => ({ profileId: 'profile-1' }) },
    profiles: current.profiles,
    videoService: current.videoService,
    runService: { outputFile: async () => null },
  });
  const response = await app.inject({
    method: 'GET', url: '/api/profile/video-clips/11111111-1111-4111-8111-111111111111',
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().status, 'FAIL');
  assert.equal(response.json().failure_code, 'CLIP_UNAUTHORIZED_AUDIO');
  assert.match(response.json().error, /неавторизоване аудіо/);
  assert.equal(response.json().next_action, 'RETRY_AVAILABLE');
  assert.equal(response.json().retry_available, true);
  assert.equal(current.projected.at(-1).clip.status, 'FAIL');
});

test('status waits for automatic semantic QA instead of exposing NEEDS_QA as a terminal result', async (t) => {
  const current = fixture();
  current.setLiveClip({ status: 'NEEDS_QA', qa: { pass: true } });
  const app = Fastify();
  t.after(() => app.close());
  await registerVideoRoutes(app, {
    profileApi: { resolveRequestProfile: async () => ({ profileId: 'profile-1' }) },
    profiles: current.profiles,
    videoService: current.videoService,
    runService: { outputFile: async () => null },
  });
  const response = await app.inject({
    method: 'GET', url: '/api/profile/video-clips/11111111-1111-4111-8111-111111111111',
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.notEqual(response.json().status, 'NEEDS_QA');
  assert.equal(current.finalizeCalls(), 1);
});

test('one explicit QA retry creates one child job and same idempotency key reuses it', async (t) => {
  const current = fixture();
  const parent = {
    ...await current.videoService.getClip(),
    status: 'FAIL',
    mode: 'motion_1',
    lookBinding: {
      sourceSha256: 'b'.repeat(64),
      approvedLookReceiptSha256: 'c'.repeat(64),
      whiteBackgroundVerified: true,
    },
    motionReferenceBinding: { referenceId: 'style-1', sha256: 'd'.repeat(64), packSha256: 'e'.repeat(64) },
  };
  const child = {
    ...parent,
    clipId: '44444444-4444-4444-8444-444444444444',
    jobId: 'higgs-job-retry',
    status: 'CREATED',
  };
  let childCreated = false;
  let retryCalls = 0;
  const claims = new Map();
  current.videoService.getClip = async (clipId) => (clipId === child.clipId && childCreated ? child : parent);
  current.videoService.fashionVideoCapability = async ({ referenceId }) => ({
    state: 'READY',
    selected_style_id: referenceId,
    reference_id: referenceId,
    reference_path: '/runtime/references/style.mp4',
    reference_sha256: 'd'.repeat(64),
    reference_pack_sha256: 'e'.repeat(64),
    duration_seconds: 5,
    provider_duration_seconds: 5,
    available_styles: availableStyles,
  });
  current.videoService.claimRetry = async (_parentId, key) => {
    const existing = claims.get(key);
    return existing
      ? { created: false, claim: existing, claimPath: key }
      : { created: true, claim: { state: 'SUBMITTING' }, claimPath: key };
  };
  current.videoService.completeRetryClaim = async (key, childId) => {
    claims.set(key, { state: 'CREATED', child_clip_id: childId });
  };
  current.videoService.retryFailedClip = async () => {
    retryCalls++;
    childCreated = true;
    return { clipId: child.clipId, jobId: child.jobId, status: child.status };
  };
  const app = Fastify();
  t.after(() => app.close());
  await registerVideoRoutes(app, {
    profileApi: { resolveRequestProfile: async () => ({ profileId: 'profile-1' }) },
    profiles: current.profiles,
    videoService: current.videoService,
    runService: { outputFile: async () => null },
  });
  const headers = { 'idempotency-key': 'retry-key-that-is-long-enough-12345' };
  const first = await app.inject({
    method: 'POST', url: '/api/profile/video-clips/11111111-1111-4111-8111-111111111111/retry', headers,
  });
  assert.equal(first.statusCode, 202, first.body);
  assert.equal(first.json().clip_id, child.clipId);
  const duplicate = await app.inject({
    method: 'POST', url: '/api/profile/video-clips/11111111-1111-4111-8111-111111111111/retry', headers,
  });
  assert.equal(duplicate.statusCode, 200, duplicate.body);
  assert.equal(duplicate.json().reused, true);
  assert.equal(retryCalls, 1);
});

test('create reaches VideoService only after the same two-reference contract is ready', async (t) => {
  const current = fixture();
  current.videoService.fashionVideoCapability = async () => ({
    state: 'READY',
    reference_path: '/runtime/references/motion.mp4',
    reference_sha256: 'd'.repeat(64),
    reference_pack_sha256: 'e'.repeat(64),
    available_styles: availableStyles,
  });
  const app = Fastify();
  t.after(() => app.close());
  await registerVideoRoutes(app, {
    profileApi: {
      resolveRequestProfile: async () => ({ profileId: 'profile-1' }),
    },
    profiles: current.profiles,
    videoService: current.videoService,
    runService: {
      outputFile: async () => '/runtime/runs/source/avatar_outfit.png',
      approvedIdentityFaceReferenceForRun: async () => ({
        role: 'identity_face',
        data: Buffer.from('identity-reference'),
        sha256: 'a'.repeat(64),
        white_background_verified: true,
      }),
    },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/profile/video-clips',
    payload: {
      look_id: '33333333-3333-4333-8333-333333333333',
      surface: 'tv',
      style_id: 'style-1',
      motion_mode: 'editorial_micro_moment',
    },
  });
  assert.equal(response.statusCode, 202, response.body);
  assert.equal(response.json().status, 'CREATED');
  assert.equal(response.json().surface, 'mirror');
  assert.equal(response.json().aspect_ratio, '9:16');
  assert.equal(current.createRequests.length, 1);
  assert.equal(Object.hasOwn(current.createRequests[0], 'surfaceId'), false);
  assert.deepEqual(current.createRequests[0].sourceCapabilities, { full_length: true });
  assert.equal(current.createRequests[0].lookBinding.sourceSha256, 'b'.repeat(64));
  assert.deepEqual(
    current.createRequests[0].appearanceReferences.map((reference) => reference.role),
    ['identity_face', 'garment_detail'],
  );
  assert.ok(current.createRequests[0].appearanceReferences.every(
    (reference) => reference.white_background_verified === true,
  ));
  assert.equal(current.projected[0].clip.status, 'CREATED');
  assert.equal(current.projected.at(-1).clip.status, 'PASS');
});

test('create starts server-owned finalization once, and status reads resume the same persisted job', async (t) => {
  const current = fixture();
  let releaseFinalizer;
  let finalizerStarts = 0;
  current.videoService.fashionVideoCapability = async () => ({
    state: 'READY',
    reference_path: '/runtime/references/motion.mp4',
    reference_sha256: 'd'.repeat(64),
    reference_pack_sha256: 'e'.repeat(64),
    available_styles: availableStyles,
  });
  current.videoService.finalizeClip = async () => new Promise((resolve) => {
    finalizerStarts++;
    releaseFinalizer = () => {
      current.setLiveClip({ status: 'PASS', videoSha256: 'a'.repeat(64), qa: { pass: true } });
      resolve({ clipId: '11111111-1111-4111-8111-111111111111', status: 'PASS' });
    };
  });
  const app = Fastify();
  t.after(() => app.close());
  await registerVideoRoutes(app, {
    profileApi: { resolveRequestProfile: async () => ({ profileId: 'profile-1' }) },
    profiles: current.profiles,
    videoService: current.videoService,
    runService: {
      outputFile: async () => '/runtime/runs/source/avatar_outfit.png',
      approvedIdentityReferenceForRun: async () => ({ role: 'identity_face', data: Buffer.from('identity'), sha256: 'a'.repeat(64) }),
    },
  });
  const created = await app.inject({
    method: 'POST',
    url: '/api/profile/video-clips',
    payload: { look_id: '33333333-3333-4333-8333-333333333333', surface: 'mirror', style_id: 'style-1', motion_mode: 'motion_1' },
  });
  assert.equal(created.statusCode, 202, created.body);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof releaseFinalizer, 'function');
  await Promise.all([
    app.inject({ method: 'GET', url: '/api/profile/video-clips/11111111-1111-4111-8111-111111111111' }),
    app.inject({ method: 'GET', url: '/api/profile/video-clips/11111111-1111-4111-8111-111111111111' }),
  ]);
  // Both reads attach to the existing wait: there is still only one job finalizer.
  assert.equal(typeof releaseFinalizer, 'function');
  assert.equal(finalizerStarts, 1);
  releaseFinalizer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(current.createRequests.length, 1);
});

test('Fashion Video uses the selected style id and does not inherit the Real-time Look taxonomy gate', async (t) => {
  const current = fixture();
  current.profiles.approvedLookLiveReference = async () => {
    throw new ProfileError(422, 'LIVE_REFERENCE_INCOMPLETE_LOOK', 'Live needs a complete locked look; missing: top or one_piece');
  };
  current.videoService.fashionVideoCapability = async ({ referenceId, motionMode }) => ({
    state: 'READY',
    selected_style_id: referenceId,
    reference_id: referenceId,
    reference_path: '/runtime/references/style.mp4',
    reference_sha256: 'd'.repeat(64),
    reference_pack_sha256: 'e'.repeat(64),
    motion_modes: [motionMode],
    available_styles: availableStyles,
  });
  const app = Fastify();
  t.after(() => app.close());
  await registerVideoRoutes(app, {
    profileApi: { resolveRequestProfile: async () => ({ profileId: 'profile-1' }) },
    profiles: current.profiles,
    videoService: current.videoService,
    runService: {
      outputFile: async () => '/runtime/runs/source/avatar_outfit.png',
      approvedIdentityReferenceForRun: async () => ({
        role: 'identity_face', data: Buffer.from('identity-reference'), sha256: 'a'.repeat(64),
      }),
    },
  });
  const response = await app.inject({
    method: 'POST',
    url: '/api/profile/video-clips',
    payload: {
      look_id: '33333333-3333-4333-8333-333333333333',
      surface: 'mirror',
      style_id: 'style-2',
      motion_mode: 'motion_2',
    },
  });
  assert.equal(response.statusCode, 202, response.body);
  assert.equal(current.createRequests.at(-1).videoReference.reference_id, 'style-2');
  assert.deepEqual(current.createRequests.at(-1).appearanceReferences.map((reference) => reference.role), []);
});

test('saved-look capability refuses a look outside the browser profile', async (t) => {
  const current = fixture();
  current.profiles.ownsLook = () => false;
  const app = Fastify();
  t.after(() => app.close());
  await registerVideoRoutes(app, {
    profileApi: {
      resolveRequestProfile: async () => ({ profileId: 'profile-1' }),
    },
    profiles: current.profiles,
    videoService: current.videoService,
    runService: { outputFile: async () => null },
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/profile/looks/33333333-3333-4333-8333-333333333333/video-capability',
  });
  assert.equal(response.statusCode, 404, response.body);
  assert.equal(response.json().code, 'LOOK_NOT_FOUND');
});

test('finalize resumes the existing job and projects the real MP4 result', async (t) => {
  const current = fixture();
  const app = Fastify();
  t.after(() => app.close());
  await registerVideoRoutes(app, {
    profileApi: {
      resolveRequestProfile: async () => ({ profileId: 'profile-1' }),
    },
    profiles: current.profiles,
    videoService: current.videoService,
    runService: { outputFile: async () => null },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/profile/video-clips/11111111-1111-4111-8111-111111111111/finalize',
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.status, 'PASS');
  assert.equal(body.video_url, null);
  assert.equal(body.delivery_code, 'VIDEO_STYLE_PROVENANCE_MISSING');
  assert.equal(current.projected.at(-1).clip.output.sha256, 'a'.repeat(64));
});
