import assert from 'node:assert/strict';
import test from 'node:test';

import Fastify from 'fastify';

import { registerVideoRoutes } from '../../src/web/video-routes.js';

function fixture() {
  const projected = [];
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
    async createClip() {
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
  return { profiles, projected, videoService };
}

test('create projects the exact approved-look binding expected by ProfileService', async (t) => {
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
  assert.equal(current.projected.length, 1);
  assert.deepEqual(current.projected[0].clip.bindings, {
    approved_look: { look_id: '33333333-3333-4333-8333-333333333333' },
    motion_mode: 'editorial_micro_moment',
    surface: 'mirror',
  });
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
