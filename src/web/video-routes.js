// Video clip routes — registered as an isolated module (same pattern as
// post-shoot-routes.js) so that app.js stays minimal: one import + one call.
//
// Endpoints:
//   POST   /api/profile/video-clips              — create a clip from a look
//   GET    /api/profile/video-clips/:clipId       — get clip status
//   GET    /api/profile/video-clips/:clipId/video — stream the clip mp4
//   DELETE /api/profile/video-clips/:clipId       — delete a clip
//   GET    /api/profile/looks/:lookId/video-clips — list clips for a look

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { ProfileError } from './profile-service.js';
import { VideoServiceError } from './video-service.js';

function sameOriginMutation(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') {
    throw new ProfileError(403, 'CROSS_SITE_REQUEST', 'Cross-site profile mutation is not allowed');
  }
  const origin = request.headers.origin;
  if (!origin) return;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ProfileError(403, 'INVALID_ORIGIN', 'Invalid profile mutation origin');
  }
  const requestHost = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '')
    .split(',')[0]
    .trim();
  if (!requestHost || originHost !== requestHost) {
    throw new ProfileError(403, 'CROSS_SITE_REQUEST', 'Cross-site profile mutation is not allowed');
  }
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {object} options
 * @param {object} options.profileApi — return value of registerProfileRoutes
 * @param {import('./profile-service.js').ProfileService} options.profiles
 * @param {import('./video-service.js').VideoService} options.videoService
 * @param {import('./run-service.js').RunService} options.runService
 */
export async function registerVideoRoutes(app, {
  profileApi,
  profiles,
  videoService,
  runService,
}) {
  if (!profileApi || !profiles || !videoService || !runService) {
    throw new Error('registerVideoRoutes requires profileApi, profiles, videoService, and runService');
  }

  // POST /api/profile/video-clips — create a new video clip
  app.post('/api/profile/video-clips', async (request, reply) => {
    sameOriginMutation(request);
    const session = await profileApi.resolveRequestProfile(request, reply);
    const { look_id, surface, motion_mode, duration_seconds, style_note } = request.body ?? {};

    if (typeof look_id !== 'string' || look_id.length === 0) {
      throw new ProfileError(400, 'MISSING_LOOK_ID', 'look_id is required');
    }
    if (typeof surface !== 'string') {
      throw new ProfileError(400, 'MISSING_SURFACE', 'surface is required (tv or mirror)');
    }
    if (typeof motion_mode !== 'string') {
      throw new ProfileError(400, 'MISSING_MOTION_MODE', 'motion_mode is required');
    }

    // Verify look ownership
    if (!profiles.ownsLook(session.profileId, look_id)) {
      throw new ProfileError(404, 'LOOK_NOT_FOUND', 'Look not found');
    }

    // Resolve the look source image path
    const lookDescriptor = profiles.lookAsset(session.profileId, look_id);
    if (!lookDescriptor) {
      throw new ProfileError(404, 'LOOK_NOT_FOUND', 'Look asset not found');
    }
    const sourceImagePath = await runService.outputFile(lookDescriptor.runId, lookDescriptor.filename);
    if (!sourceImagePath) {
      throw new ProfileError(404, 'LOOK_IMAGE_NOT_FOUND', 'Look source image not found on disk');
    }

    try {
      const result = await videoService.createClip({
        modeId: motion_mode,
        surfaceId: surface,
        durationSeconds: duration_seconds ?? undefined,
        styleNote: style_note ?? null,
        sourceImagePath,
        lookBinding: {
          profileId: session.profileId,
          lookId: look_id,
        },
      });

      // Project into profile database
      const now = new Date().toISOString();
      profiles.projectVideoClip(session.profileId, look_id, {
        clip_id: result.clipId,
        bindings: { motion_mode, surface },
        status: result.status,
        job_id: result.jobId ?? null,
        created_at: now,
        updated_at: now,
      });

      return reply.code(202).send({
        clip_id: result.clipId,
        job_id: result.jobId,
        status: result.status,
        surface,
        motion_mode,
        look_id,
      });
    } catch (err) {
      if (err instanceof VideoServiceError) {
        return reply.code(err.status).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  // GET /api/profile/video-clips/:clipId — get clip status + metadata
  app.get('/api/profile/video-clips/:clipId', async (request, reply) => {
    const session = await profileApi.resolveRequestProfile(request, reply);
    const clip = profiles.videoClipProjection(session.profileId, request.params.clipId);
    if (!clip) {
      return reply.code(404).send({ error: 'Video clip not found', code: 'CLIP_NOT_FOUND' });
    }
    // Merge with live service state if available
    const liveClip = await videoService.getClip(request.params.clipId);
    return reply.header('Cache-Control', 'private, no-store').send({
      ...clip,
      qa: liveClip?.qa ?? null,
      video_url: clip.video_url ?? null,
    });
  });

  // GET /api/profile/video-clips/:clipId/video — stream the mp4
  app.get('/api/profile/video-clips/:clipId/video', async (request, reply) => {
    const session = await profileApi.resolveRequestProfile(request, reply);
    const clip = profiles.videoClipProjection(session.profileId, request.params.clipId);
    if (!clip) {
      return reply.code(404).send({ error: 'Video clip not found', code: 'CLIP_NOT_FOUND' });
    }
    const liveClip = await videoService.getClip(request.params.clipId);
    if (!liveClip?.videoPath) {
      return reply.code(404).send({ error: 'Video file not available', code: 'VIDEO_NOT_READY' });
    }
    try {
      const fileStat = await stat(liveClip.videoPath);
      return reply
        .type('video/mp4')
        .header('Cache-Control', 'private, no-store')
        .header('Content-Length', fileStat.size)
        .header('Content-Disposition', `inline; filename="${request.params.clipId}.mp4"`)
        .send(createReadStream(liveClip.videoPath));
    } catch {
      return reply.code(404).send({ error: 'Video file not found on disk', code: 'VIDEO_FILE_MISSING' });
    }
  });

  // DELETE /api/profile/video-clips/:clipId — delete a clip
  app.delete('/api/profile/video-clips/:clipId', async (request, reply) => {
    sameOriginMutation(request);
    const session = await profileApi.resolveRequestProfile(request, reply);
    const deleted = profiles.deleteVideoClip(session.profileId, request.params.clipId);
    if (!deleted) {
      return reply.code(404).send({ error: 'Video clip not found', code: 'CLIP_NOT_FOUND' });
    }
    return reply.code(204).send();
  });

  // GET /api/profile/looks/:lookId/video-clips — list clips for a look
  app.get('/api/profile/looks/:lookId/video-clips', async (request, reply) => {
    const session = await profileApi.resolveRequestProfile(request, reply);
    const clips = profiles.listVideoClips(session.profileId, request.params.lookId);
    if (clips === null) {
      return reply.code(404).send({ error: 'Look not found', code: 'LOOK_NOT_FOUND' });
    }
    return reply.header('Cache-Control', 'private, no-store').send({ clips });
  });

  return { videoService };
}
