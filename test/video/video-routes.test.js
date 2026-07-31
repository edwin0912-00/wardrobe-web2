import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Fastify from 'fastify';

import { registerVideoRoutes } from '../../src/web/video-routes.js';

function fixture() {
  const projected = [];
  const createRequests = [];
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
      status: liveClip.status,
    }),
    deleteVideoClip: () => true,
    listVideoClips: () => [],
  };
  const videoService = {
    async createClip(request) {
      createRequests.push(request);
      return { clipId: liveClip.clipId, jobId: liveClip.jobId, status: liveClip.status };
    },
    async getClip() {
      return liveClip;
    },
    async finalizeClip() {
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
  return { profiles, projected, createRequests, videoService };
}

const availableStyles = [1, 2, 3].map((index) => ({
  id: `style-${index}`,
  title: `Style ${index}`,
  motion_mode: `motion_${index}`,
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
      approvedIdentityReferenceForRun: async () => ({
        role: 'identity_face',
        data: Buffer.from('identity-reference'),
        sha256: 'a'.repeat(64),
      }),
    },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/profile/video-clips',
    payload: {
      look_id: '33333333-3333-4333-8333-333333333333',
      surface: 'mirror',
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
      three_video_styles: false,
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
      preview_url: `/api/profile/looks/33333333-3333-4333-8333-333333333333/video-styles/${style.id}/preview`,
      reference_url: `/api/profile/looks/33333333-3333-4333-8333-333333333333/video-styles/${style.id}/reference`,
    })),
    create_route: '/api/profile/video-clips',
    requirements: {
      approved_master_look: true,
      verified_style_reference: true,
      verified_motion_reference: true,
      three_video_styles: true,
    },
    reason_code: 'FASHION_VIDEO_READY',
    next_action: 'CREATE_FASHION_VIDEO',
  });
  assert.equal(current.createRequests.length, 0);
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
      approvedIdentityReferenceForRun: async () => ({
        role: 'identity_face',
        data: Buffer.from('identity-reference'),
        sha256: 'a'.repeat(64),
      }),
    },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/profile/video-clips',
    payload: {
      look_id: '33333333-3333-4333-8333-333333333333',
      surface: 'mirror',
      motion_mode: 'editorial_micro_moment',
    },
  });
  assert.equal(response.statusCode, 202, response.body);
  assert.equal(response.json().status, 'CREATED');
  assert.equal(current.createRequests.length, 1);
  assert.equal(current.createRequests[0].lookBinding.sourceSha256, 'b'.repeat(64));
  assert.deepEqual(
    current.createRequests[0].appearanceReferences.map((reference) => reference.role),
    ['identity_face', 'garment_detail'],
  );
  assert.equal(current.projected.length, 1);
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
  assert.equal(
    body.video_url,
    '/api/profile/video-clips/11111111-1111-4111-8111-111111111111/video',
  );
  assert.equal(current.projected.at(-1).clip.output.sha256, 'a'.repeat(64));
});
