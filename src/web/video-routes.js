// Video clip routes — registered as an isolated module (same pattern as
// post-shoot-routes.js) so that app.js stays minimal: one import + one call.
//
// Endpoints:
//   GET    /api/profile/looks/:lookId/video-capability — truthful create readiness
//   POST   /api/profile/video-clips              — create a clip from a look
//   GET    /api/profile/video-clips/:clipId       — get clip status
//   GET    /api/profile/video-clips/:clipId/video — stream the clip mp4
//   DELETE /api/profile/video-clips/:clipId       — delete a clip
//   GET    /api/profile/looks/:lookId/video-clips — list clips for a look

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { ProfileError } from './profile-service.js';
import { fashionVideoCapability } from './video-capability.js';
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

function byteRange(rangeHeader, size) {
  if (typeof rangeHeader !== 'string') return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return undefined;
  const start = match[1] === '' ? null : Number(match[1]);
  const requestedEnd = match[2] === '' ? null : Number(match[2]);
  if ((!Number.isInteger(start) && start !== null)
    || (!Number.isInteger(requestedEnd) && requestedEnd !== null)
    || (start !== null && start < 0)
    || (requestedEnd !== null && requestedEnd < 0)) return undefined;
  if (start === null && requestedEnd === null) return undefined;
  if (start === null) {
    const length = Math.min(requestedEnd, size);
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  if (start >= size) return undefined;
  const end = Math.min(requestedEnd ?? size - 1, size - 1);
  if (end < start) return undefined;
  return { start, end };
}

function hasVerifiedFashionStyle(liveClip) {
  const binding = liveClip?.motionReferenceBinding;
  return liveClip?.status === 'PASS'
    && /^[a-f0-9]{64}$/.test(binding?.sha256 ?? '')
    && /^[a-f0-9]{64}$/.test(binding?.packSha256 ?? '')
    && liveClip?.referenceAdherenceQa?.pass === true;
}

function publicVideoFailure(liveClip) {
  if (liveClip?.failureCode === 'VIDEO_PROVIDER_JOB_NOT_FOUND') {
    return 'Higgsfield більше не має цей job. Нове відео не створювалося автоматично.';
  }
  return null;
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

  const projectClip = (profileId, lookId, liveClip) => profiles.projectVideoClip(
    profileId,
    lookId,
    {
      clip_id: liveClip.clipId,
      bindings: {
        approved_look: { look_id: lookId },
        motion_mode: liveClip.mode,
        surface: liveClip.surface,
      },
      status: liveClip.status,
      job_id: liveClip.jobId ?? null,
      output: liveClip.videoSha256
        ? {
            sha256: liveClip.videoSha256,
            duration_seconds: liveClip.durationSeconds,
          }
        : null,
      created_at: liveClip.createdAt,
      updated_at: liveClip.updatedAt,
    },
  );

  // `createClip` deliberately returns after persisting the paid provider job.
  // The second phase must nevertheless be owned by the server, not by a tab
  // polling for a fixed number of minutes.  A restart can safely enter this
  // path again: `finalizeClip` waits on the recorded provider job id and never
  // issues another create request.  The in-process map only prevents duplicate
  // waits/downloads while this server instance is alive.
  const activeFinalizers = new Map();
  const finalizePersistedClip = ({ profileId, lookId, clipId }) => {
    const active = activeFinalizers.get(clipId);
    if (active) return active;
    const finalizer = (async () => {
      try {
        await videoService.finalizeClip(clipId);
      } catch (error) {
        // Finalization is resumable.  Keep the immutable provider job and let
        // the next status request retry the wait; do not turn a transport blip
        // into a fresh paid generation or a false terminal result.
        app.log?.warn?.({ err: error, clip_id: clipId }, 'fashion video finalization paused');
      } finally {
        try {
          const liveClip = await videoService.getClip(clipId);
          projectClip(profileId, lookId, liveClip);
        } catch (error) {
          app.log?.warn?.({ err: error, clip_id: clipId }, 'fashion video projection refresh failed');
        }
        activeFinalizers.delete(clipId);
      }
    })();
    activeFinalizers.set(clipId, finalizer);
    return finalizer;
  };

  const isResumableVideoStatus = (status) => ['CREATED', 'GENERATING'].includes(status);

  // GET /api/profile/looks/:lookId/video-capability — the saved-look action
  // hub reads this before enabling Fashion Video. The optional service hook
  // must return two immutable hashes: the selected style/reference pack and
  // the motion authority. Missing hook or hashes remains fail-closed.
  app.get('/api/profile/looks/:lookId/video-capability', async (request, reply) => {
    const session = await profileApi.resolveRequestProfile(request, reply);
    const lookId = request.params.lookId;
    if (!profiles.ownsLook(session.profileId, lookId)) {
      return reply.code(404).send({ error: 'Look not found', code: 'LOOK_NOT_FOUND' });
    }
    const approvedLook = await profiles.approvedLookReference(
      session.profileId,
      lookId,
      runService,
    );
    const motionReference = typeof videoService.fashionVideoCapability === 'function'
      ? await videoService.fashionVideoCapability({
          profileId: session.profileId,
          lookId,
          approvedLook,
        })
      : null;

    return reply
      .header('Cache-Control', 'private, no-store')
      .header('Vary', 'Cookie')
      .send(fashionVideoCapability({ lookId, approvedLook, motionReference }));
  });

  app.get('/api/profile/looks/:lookId/video-styles/:styleId/preview', async (request, reply) => {
    const session = await profileApi.resolveRequestProfile(request, reply);
    const { lookId, styleId } = request.params;
    if (!profiles.ownsLook(session.profileId, lookId)) {
      return reply.code(404).send({ error: 'Look not found', code: 'LOOK_NOT_FOUND' });
    }
    const approvedLook = await profiles.approvedLookReference(session.profileId, lookId, runService);
    const motionReference = typeof videoService.fashionVideoCapability === 'function'
      ? await videoService.fashionVideoCapability({
          profileId: session.profileId,
          lookId,
          approvedLook,
          referenceId: styleId,
        })
      : null;
    if (!motionReference?.preview_path) {
      return reply.code(404).send({ error: 'Video style preview not found', code: 'VIDEO_STYLE_NOT_FOUND' });
    }
    return reply
      .type('image/jpeg')
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(createReadStream(motionReference.preview_path));
  });

  // The three Fashion Video cards are video-derived style units, not generic
  // motion presets. Stream the hash-verified source MP4, privately, so the
  // user can inspect the actual temporal/style authority before submission.
  app.get('/api/profile/looks/:lookId/video-styles/:styleId/reference', async (request, reply) => {
    const session = await profileApi.resolveRequestProfile(request, reply);
    const { lookId, styleId } = request.params;
    if (!profiles.ownsLook(session.profileId, lookId)) {
      return reply.code(404).send({ error: 'Look not found', code: 'LOOK_NOT_FOUND' });
    }
    const approvedLook = await profiles.approvedLookReference(session.profileId, lookId, runService);
    const motionReference = typeof videoService.fashionVideoCapability === 'function'
      ? await videoService.fashionVideoCapability({
          profileId: session.profileId,
          lookId,
          approvedLook,
        referenceId: styleId,
      })
      : null;
    if (!motionReference?.reference_path || motionReference.selected_style_id !== styleId) {
      return reply.code(404).send({ error: 'Video style not found', code: 'VIDEO_STYLE_NOT_FOUND' });
    }
    const details = await stat(motionReference.reference_path);
    if (!details.isFile() || details.size < 1) {
      return reply.code(404).send({ error: 'Video style reference not found', code: 'VIDEO_STYLE_NOT_FOUND' });
    }
    const range = byteRange(request.headers.range, details.size);
    if (range === undefined) {
      return reply
        .code(416)
        .header('Content-Range', `bytes */${details.size}`)
        .send();
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? details.size - 1;
    const response = reply
      .code(range ? 206 : 200)
      .type('video/mp4')
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Accept-Ranges', 'bytes')
      .header('Content-Length', String(end - start + 1));
    if (range) response.header('Content-Range', `bytes ${start}-${end}/${details.size}`);
    return response.send(createReadStream(motionReference.reference_path, { start, end }));
  });

  // POST /api/profile/video-clips — create a new video clip
  app.post('/api/profile/video-clips', async (request, reply) => {
    sameOriginMutation(request);
    const session = await profileApi.resolveRequestProfile(request, reply);
    const {
      look_id,
      surface,
      style_id,
      motion_mode,
      duration_seconds,
      style_note,
    } = request.body ?? {};

    if (typeof look_id !== 'string' || look_id.length === 0) {
      throw new ProfileError(400, 'MISSING_LOOK_ID', 'look_id is required');
    }
    if (typeof surface !== 'string') {
      throw new ProfileError(400, 'MISSING_SURFACE', 'surface is required (tv or mirror)');
    }
    if (typeof style_id !== 'string' || style_id.length === 0) {
      throw new ProfileError(400, 'MISSING_VIDEO_STYLE_ID', 'style_id is required');
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
    const approvedLook = await profiles.approvedLookReference(
      session.profileId,
      look_id,
      runService,
    );
    const motionReference = typeof videoService.fashionVideoCapability === 'function'
      ? await videoService.fashionVideoCapability({
          profileId: session.profileId,
          lookId: look_id,
          approvedLook,
          referenceId: style_id,
          motionMode: motion_mode,
        })
      : null;
    const capability = fashionVideoCapability({
      lookId: look_id,
      approvedLook,
      motionReference,
    });
    if (!capability.available) {
      return reply.code(409).send({
        error: 'Fashion Video потребує перевірений style pack і motion reference. Запуск без них вимкнено.',
        code: capability.reason_code,
        next_action: capability.next_action,
        requirements: capability.requirements,
      });
    }
    // Video 1 is the selected style MP4 and Image 1 is the approved master
    // look.  A full garment composite helps fidelity, but its Real-time Look
    // taxonomy requirement must never block this independent V2V product.
    const identityReference = await runService.approvedIdentityReferenceForRun(lookDescriptor.runId);
    let garmentReference = null;
    try {
      garmentReference = await profiles.approvedLookLiveReference(
        session.profileId,
        look_id,
        runService,
      );
    } catch (error) {
      if (!(error instanceof ProfileError) || error.code !== 'LIVE_REFERENCE_INCOMPLETE_LOOK') {
        throw error;
      }
    }

    try {
      const result = await videoService.createClip({
        modeId: motion_mode,
        surfaceId: surface,
        durationSeconds: duration_seconds ?? undefined,
        styleNote: style_note ?? null,
        sourceImagePath,
        videoReference: motionReference,
        appearanceReferences: [
          {
            role: identityReference.role,
            bytes: Buffer.from(identityReference.data),
            sha256: identityReference.sha256,
          },
          ...(garmentReference ? [{
            role: 'garment_detail',
            bytes: Buffer.from(garmentReference.image),
            sha256: garmentReference.reference_sha256,
          }] : []),
        ],
        lookBinding: {
          profileId: session.profileId,
          lookId: look_id,
          sourceSha256: approvedLook.image_sha256,
          approvedLookReceiptSha256: approvedLook.receipt_sha256,
        },
      });

      // Project into profile database
      const liveClip = await videoService.getClip(result.clipId);
      projectClip(session.profileId, look_id, liveClip);

      // Return the persisted job immediately, then let the server wait,
      // download and technically verify it.  No browser tab is required for
      // this job to progress and no second provider create is permitted.
      void finalizePersistedClip({
        profileId: session.profileId,
        lookId: look_id,
        clipId: result.clipId,
      });

      return reply.code(202).send({
        clip_id: result.clipId,
        job_id: result.jobId,
        status: result.status,
        surface,
        style_id,
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

  // POST /api/profile/video-clips/:clipId/finalize — resume the persisted job,
  // download its real MP4 and run ffprobe/frame QA. It never creates a new job.
  app.post('/api/profile/video-clips/:clipId/finalize', async (request, reply) => {
    sameOriginMutation(request);
    const session = await profileApi.resolveRequestProfile(request, reply);
    const projection = profiles.videoClipProjection(session.profileId, request.params.clipId);
    if (!projection) {
      return reply.code(404).send({ error: 'Video clip not found', code: 'CLIP_NOT_FOUND' });
    }
    try {
      await finalizePersistedClip({
        profileId: session.profileId,
        lookId: projection.look_id,
        clipId: request.params.clipId,
      });
      const liveClip = await videoService.getClip(request.params.clipId);
      const updated = projectClip(session.profileId, projection.look_id, liveClip);
      return reply.code(200).send({
        ...updated,
        qa: liveClip.qa,
        video_url: liveClip.status === 'PASS'
          ? `/api/profile/video-clips/${liveClip.clipId}/video`
          : null,
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
    // A process restart loses only the in-memory waiter, never the persisted
    // provider job.  Any later status read resumes the same job id.
    if (isResumableVideoStatus(liveClip?.status)) {
      void finalizePersistedClip({
        profileId: session.profileId,
        lookId: clip.look_id,
        clipId: request.params.clipId,
      });
    }
    const verifiedStyle = hasVerifiedFashionStyle(liveClip);
    return reply.header('Cache-Control', 'private, no-store').send({
      ...clip,
      qa: liveClip?.qa ?? null,
      error: publicVideoFailure(liveClip),
      failure_code: liveClip?.failureCode ?? null,
      video_url: verifiedStyle ? clip.video_url ?? null : null,
      delivery_code: verifiedStyle ? null : 'VIDEO_STYLE_PROVENANCE_MISSING',
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
    if (!hasVerifiedFashionStyle(liveClip)) {
      return reply.code(409).send({
        error: 'This legacy clip has no verified video-style binding and is not a Fashion Video delivery.',
        code: 'VIDEO_STYLE_PROVENANCE_MISSING',
      });
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
    const verified = [];
    for (const clip of clips) {
      const liveClip = await videoService.getClip(clip.clip_id);
      if (hasVerifiedFashionStyle(liveClip)) verified.push(clip);
    }
    return reply.header('Cache-Control', 'private, no-store').send({ clips: verified });
  });

  return { videoService };
}
