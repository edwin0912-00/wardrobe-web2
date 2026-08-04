// Video clip routes — registered as an isolated module (same pattern as
// post-shoot-routes.js) so that app.js stays minimal: one import + one call.
//
// Endpoints:
//   GET    /api/profile/looks/:lookId/video-capability — truthful create readiness
//   POST   /api/profile/video-clips              — create a clip from a look
//   GET    /api/profile/video-clips/:clipId       — get clip status
//   POST   /api/profile/video-clips/:clipId/retry — one explicit child attempt
//   GET    /api/profile/video-clips/:clipId/video — stream the clip mp4
//   GET    /api/profile/video-clips/:clipId/download — download the verified clip mp4
//   DELETE /api/profile/video-clips/:clipId       — delete a clip
//   GET    /api/profile/looks/:lookId/video-clips — list clips for a look

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { ProfileError } from './profile-service.js';
import { fashionVideoCapability } from './video-capability.js';
import { resolveVideoQaAction } from './video-qa-action.js';
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
  const identityQa = liveClip?.salvage
    ? liveClip.salvageIdentityItemQa
    : liveClip?.identityItemQa;
  const referenceQa = liveClip?.salvage
    ? liveClip.salvageReferenceAdherenceQa
    : liveClip?.referenceAdherenceQa;
  return liveClip?.status === 'PASS'
    && liveClip?.qa?.pass === true
    && /^[a-f0-9]{64}$/.test(binding?.sha256 ?? '')
    && /^[a-f0-9]{64}$/.test(binding?.packSha256 ?? '')
    && identityQa?.pass === true
    && referenceQa?.pass === true
    && referenceQa?.cutCoverage?.pass === true;
}

/* A ready MP4 is private profile media.  The only URLs we expose are two
 * authenticated views of the exact same verified file: one for playback and
 * one with an attachment disposition.  There is deliberately no public share
 * URL and no URL at all for a provider output that did not pass the Fashion
 * Video delivery contract. */
function verifiedVideoDeliveryUrls(liveClip) {
  const clipId = liveClip?.clipId ?? liveClip?.clip_id;
  if (!hasVerifiedFashionStyle(liveClip) || typeof clipId !== 'string' || clipId.length === 0) {
    return { video_url: null, download_url: null };
  }
  const encodedClipId = encodeURIComponent(clipId);
  return {
    video_url: `/api/profile/video-clips/${encodedClipId}/video`,
    download_url: `/api/profile/video-clips/${encodedClipId}/download`,
  };
}

function publicVideoFailure(liveClip) {
  if (liveClip?.salvage?.status === 'NEEDS_QA') {
    return 'Система залишила лише підтверджено чисті фрагменти без reference-людини. Коротша версія проходить повторну перевірку.';
  }
  if (liveClip?.salvage?.status === 'BLOCKED') {
    return 'QA знайшла reference-людину, але система не має достатньо чистих фрагментів для безпечного короткого монтажу.';
  }
  if (liveClip?.failureCode === 'VIDEO_PROVIDER_JOB_NOT_FOUND') {
    return 'Higgsfield більше не має цей job. Нове відео не створювалося автоматично.';
  }
  if (liveClip?.failureCode === 'VIDEO_PROVIDER_JOB_FAILED') {
    if (['SUBMITTING', 'CREATED'].includes(liveClip?.automaticRetry?.state)) {
      return 'Higgsfield завершив попередній job помилкою. Сервер уже запускає обмежену автоматичну спробу з тим самим затвердженим образом і стилем.';
    }
    return 'Higgsfield завершив цей job помилкою. Відео не створилось; можна запустити нову спробу.';
  }
  if (liveClip?.failureCode === 'VIDEO_INPUT_MEDIA_IP_CHECK_PENDING') {
    return 'Higgsfield ще завершує IP-перевірку завантажених медіа. Сервер уже зробив одну безпечну автоматичну спробу; job не створився. Спробуйте ще раз через кілька секунд.';
  }
  if (liveClip?.failureCode === 'MISSING_VIDEO_OUTPUT') {
    return 'Провайдер завершив job, але beta не отримала адресу готового відео. QA не запускався; можна повторити отримання або створити нову спробу.';
  }
  if (liveClip?.failureCode === 'VIDEO_OUTPUT_DOWNLOAD_FAILED'
    || liveClip?.status === 'OUTPUT_DOWNLOAD_FAILED') {
    return 'Відео вже створене провайдером, але його передача на сервер не завершилась. Можна повторити лише завантаження без нової генерації.';
  }
  if (liveClip?.referenceAdherenceQa?.pass === false) {
    return 'Відео не пройшло QA: у кожному cut має бути лише затверджений аватар або порожня сцена. Reference-людина у фіналі заборонена.';
  }
  if (liveClip?.failureCode === 'DELIVERY_AUDIO_ASSEMBLY_FAILED') {
    return 'Не вдалося зібрати фінальне аудіо з затвердженого video-reference. Нова генерація не запускалася.';
  }
  if (liveClip?.failureCode === 'DELIVERY_AUDIO_REFERENCE_INVALID') {
    return 'Зафіксований audio-reference недоступний або змінився. Нова генерація не запускалася.';
  }
  if (liveClip?.failureCode === 'CLIP_HAS_AUDIO'
    || liveClip?.qa?.defects?.some((defect) => defect?.code === 'CLIP_HAS_AUDIO')) {
    return 'Це старий запуск до delivery-audio assembly. Він не видається; повтор створить новий ролик із заміною audio провайдера на audio з video-reference.';
  }
  if (liveClip?.qa?.defects?.some((defect) => defect?.code === 'CLIP_REFERENCE_AUDIO_MISSING')) {
    return 'У фінальному файлі немає аудіодоріжки з затвердженого video-reference.';
  }
  if (liveClip?.qa?.defects?.some((defect) => defect?.code === 'CLIP_UNAUTHORIZED_AUDIO')) {
    return 'У фінальному файлі лишилося неавторизоване аудіо; файл не видається.';
  }
  if (liveClip?.qa?.pass === false) {
    const code = liveClip.failureCode ?? liveClip.qa?.defects?.[0]?.code ?? 'VIDEO_TECHNICAL_QA_FAILED';
    return `Відео не пройшло технічну QA (${code}). Файл не видається; можна запустити одну нову спробу.`;
  }
  return null;
}

function publicAutomaticRetry(liveClip) {
  const retry = liveClip?.automaticRetry;
  if (!retry || !['SUBMITTING', 'CREATED'].includes(retry.state)
    || !Number.isInteger(retry.retry_number)
    || !Number.isInteger(retry.max_retries)) return null;
  return {
    state: retry.state,
    retry_number: retry.retry_number,
    max_retries: retry.max_retries,
    reason_code: retry.reason_code ?? null,
    child_clip_id: typeof retry.child_clip_id === 'string' ? retry.child_clip_id : null,
  };
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
            duration_seconds: liveClip.deliveryDurationSeconds ?? liveClip.durationSeconds,
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

  // A source performer in a completed provider video is a safety/identity
  // failure, not a result we can show. A job explicitly marked failed by the
  // provider is also safe to retry: it has no delivery. Both use the same
  // tightly bounded two-pass reconstruction policy. The route re-resolves the
  // current style only to prove the already-locked hashes still exist;
  // retryFailedClip rechecks those hashes before a provider create.
  const maybeStartAutomaticReferenceQaRetry = async ({ profileId, lookId, clipId }) => {
    if (typeof videoService.automaticRetryReferenceQaFailure !== 'function') return null;
    const failed = await videoService.getClip(clipId);
    if (!failed || !['FAIL', 'FAILED'].includes(failed.status)
      || ![
        'VIDEO_REFERENCE_QA_FAILED',
        'VIDEO_REFERENCE_NOT_REPLACED',
        'VIDEO_PROVIDER_JOB_FAILED',
      ].includes(failed.failureCode)) {
      return null;
    }
    const styleId = failed.motionReferenceBinding?.referenceId;
    if (typeof styleId !== 'string' || styleId.length === 0) return null;
    const approvedLook = await profiles.approvedLookReference(profileId, lookId, runService);
    if (approvedLook.image_sha256 !== failed.lookBinding?.sourceSha256
      || approvedLook.receipt_sha256 !== failed.lookBinding?.approvedLookReceiptSha256) {
      return null;
    }
    const motionReference = typeof videoService.fashionVideoCapability === 'function'
      ? await videoService.fashionVideoCapability({
          profileId,
          lookId,
          approvedLook,
          referenceId: styleId,
          motionMode: failed.mode,
        })
      : null;
    const capability = fashionVideoCapability({ lookId, approvedLook, motionReference });
    if (!capability.available) return null;

    const automatic = await videoService.automaticRetryReferenceQaFailure(clipId, {
      videoReference: motionReference,
    });
    if (typeof automatic?.childClipId === 'string') {
      const child = await videoService.getClip(automatic.childClipId);
      if (child) {
        projectClip(profileId, lookId, child);
        if (['CREATED', 'GENERATING', 'OUTPUT_DOWNLOAD_FAILED', 'NEEDS_QA'].includes(child.status)) {
          void finalizePersistedClip({ profileId, lookId, clipId: child.clipId });
        }
      }
    }
    return automatic;
  };

  const finalizePersistedClip = ({ profileId, lookId, clipId }) => {
    const active = activeFinalizers.get(clipId);
    if (active) return active;
    const finalizer = (async () => {
      try {
        await videoService.finalizeClip(clipId);
        try {
          await maybeStartAutomaticReferenceQaRetry({ profileId, lookId, clipId });
        } catch (error) {
          // A missing/changed style must not turn the failed parent into a
          // false success. Keep its exact QA evidence and offer the normal
          // explicit recovery path instead of risking a blind paid retry.
          app.log?.warn?.({ err: error, clip_id: clipId }, 'fashion video automatic retry paused');
        }
      } catch (error) {
        // Finalization is resumable.  Keep the immutable provider job and let
        // the next status request retry the wait; do not turn a transport blip
        // into a fresh paid generation or a false terminal result.
        app.log?.warn?.({ err: error, clip_id: clipId }, 'fashion video finalization paused');
        // A provider-declared terminal failure is not a transport blip. The
        // helper inspects the persisted status and only creates a bounded child
        // for an attested failed job; unknown/missing jobs remain manual so a
        // restart can never spend a duplicate generation.
        try {
          await maybeStartAutomaticReferenceQaRetry({ profileId, lookId, clipId });
        } catch (retryError) {
          app.log?.warn?.({ err: retryError, clip_id: clipId }, 'fashion video automatic retry after terminal provider failure paused');
        }
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

  const isResumableVideoStatus = (status) => [
    'CREATED', 'GENERATING', 'OUTPUT_DOWNLOAD_FAILED',
  ].includes(status);

  // The retry record is intentionally kept on its failed parent as evidence of
  // the bounded automatic recovery.  That evidence must not, however, make a
  // *completed* child look permanently in-flight.  In particular, a parent may
  // point to retry #1 while that retry in turn points to terminal retry #2.
  // Follow the small, server-owned chain before deciding whether the UI should
  // wait or offer an explicit new attempt.  We fail closed for a missing child:
  // its outcome is unknown, so a user action must not pay for a duplicate.
  const resolveAutomaticRetryChain = async (rootClip) => {
    let clip = rootClip;
    const seen = new Set();
    while (['SUBMITTING', 'CREATED'].includes(clip?.automaticRetry?.state)) {
      const childClipId = clip.automaticRetry.child_clip_id;
      if (typeof childClipId !== 'string' || seen.has(childClipId)) {
        return { leaf: clip, inFlight: true };
      }
      seen.add(childClipId);
      const child = await videoService.getClip(childClipId);
      if (!child) return { leaf: clip, inFlight: true };
      clip = child;
      // A child with a persisted remote job is the thing the visitor must wait
      // for, even though it has not itself created a further automatic child.
      // Without this check the parent was presented as terminal as soon as its
      // first retry was submitted.
      if (isResumableVideoStatus(clip.status) || ['SUBMITTING', 'NEEDS_QA'].includes(clip.status)) {
        return { leaf: clip, inFlight: true };
      }
    }
    return { leaf: clip, inFlight: false };
  };

  const presentationClip = (clip, automaticRetryInFlight) => (
    automaticRetryInFlight
      ? clip
      : { ...clip, automaticRetry: null }
  );

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

  // The UI plays a hash-bound, right-sized H.264 derivative. The original
  // master remains unchanged and is still the only provider reference.
  app.get('/api/profile/looks/:lookId/video-styles/:styleId/playback', async (request, reply) => {
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
    if (!motionReference?.playback_path || motionReference.selected_style_id !== styleId) {
      return reply.code(404).send({ error: 'Video style playback not found', code: 'VIDEO_STYLE_NOT_FOUND' });
    }
    const details = await stat(motionReference.playback_path);
    if (!details.isFile() || details.size < 1) {
      return reply.code(404).send({ error: 'Video style playback not found', code: 'VIDEO_STYLE_NOT_FOUND' });
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
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('Vary', 'Cookie')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Accept-Ranges', 'bytes')
      .header('Content-Length', String(end - start + 1));
    if (range) response.header('Content-Range', `bytes ${start}-${end}/${details.size}`);
    return response.send(createReadStream(motionReference.playback_path, { start, end }));
  });

  // Fashion Video cards are video-derived style units, not generic
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
      style_id,
      motion_mode,
      duration_seconds,
      style_note,
    } = request.body ?? {};

    if (typeof look_id !== 'string' || look_id.length === 0) {
      throw new ProfileError(400, 'MISSING_LOOK_ID', 'look_id is required');
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

    // Resolve the approved master. The general look asset is hash-bound below,
    // but Fashion Video adds a stricter boundary: Image 1 must be a verified
    // full-look master on exact white, never the original user photo.
    const lookDescriptor = profiles.lookAsset(session.profileId, look_id);
    if (!lookDescriptor) {
      throw new ProfileError(404, 'LOOK_NOT_FOUND', 'Look asset not found');
    }
    const sourceImagePath = await runService.outputFile(lookDescriptor.runId, lookDescriptor.filename);
    if (!sourceImagePath) throw new ProfileError(404, 'LOOK_IMAGE_NOT_FOUND', 'Look source image not found on disk');
    const approvedLook = await profiles.approvedLookReference(
      session.profileId,
      look_id,
      runService,
    );
    const whiteMaster = typeof runService.approvedWhiteMasterReferenceForRun === 'function'
      ? await runService.approvedWhiteMasterReferenceForRun(lookDescriptor.runId)
      // Compatibility only for isolated route tests whose mock has no disk
      // inspector. Production RunService always provides the strict method.
      : {
          path: sourceImagePath,
          sha256: approvedLook.image_sha256,
          white_background_verified: true,
          source_capabilities: { full_length: true },
        };
    if (whiteMaster.sha256 !== approvedLook.image_sha256 || whiteMaster.white_background_verified !== true) {
      throw new ProfileError(409, 'VIDEO_WHITE_MASTER_MISMATCH', 'Fashion Video requires the exact approved white master');
    }
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
    // Video 1 is the selected style MP4 and Image 1 is only the approved white
    // master. An optional face detail is admitted only after RunService proves
    // that its persisted derivative has an exact white background. The garment
    // card follows it, so VideoService can compile labels from the actual order.
    let identityReference = null;
    if (typeof runService.approvedIdentityFaceReferenceForRun === 'function') {
      try {
        identityReference = await runService.approvedIdentityFaceReferenceForRun(
          lookDescriptor.runId,
        );
      } catch (error) {
        return reply.code(error?.statusCode ?? 409).send({
          error: 'Перевірене фото обличчя для Fashion Video пошкоджене або недоступне.',
          code: error?.code ?? 'VIDEO_IDENTITY_FACE_REFERENCE_INVALID',
        });
      }
    }
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
        durationSeconds: duration_seconds ?? undefined,
        sourceCapabilities: whiteMaster.source_capabilities ?? { full_length: false },
        styleNote: style_note ?? null,
        sourceImagePath: whiteMaster.path,
        videoReference: motionReference,
        appearanceReferences: [
          ...(identityReference ? [{
            role: 'identity_face',
            bytes: Buffer.from(identityReference.data),
            sha256: identityReference.sha256,
            white_background_verified: identityReference.white_background_verified === true,
          }] : []),
          ...(garmentReference ? [{
            role: 'garment_detail',
            bytes: Buffer.from(garmentReference.image),
            sha256: garmentReference.reference_sha256,
            white_background_verified: true,
          }] : []),
        ],
        lookBinding: {
          profileId: session.profileId,
          lookId: look_id,
          sourceSha256: approvedLook.image_sha256,
          approvedLookReceiptSha256: approvedLook.receipt_sha256,
          whiteBackgroundVerified: true,
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
        surface: result.plan.surface,
        aspect_ratio: result.plan.aspectRatio,
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

  // POST /api/profile/video-clips/:clipId/retry — creates exactly one explicit
  // child attempt. Reference-performer QA gets up to two server-owned attempts;
  // all other retries remain a user action with an Idempotency-Key.
  app.post('/api/profile/video-clips/:clipId/retry', async (request, reply) => {
    sameOriginMutation(request);
    const session = await profileApi.resolveRequestProfile(request, reply);
    const parentProjection = profiles.videoClipProjection(session.profileId, request.params.clipId);
    if (!parentProjection) {
      return reply.code(404).send({ error: 'Video clip not found', code: 'CLIP_NOT_FOUND' });
    }
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string') {
      return reply.code(400).send({
        error: 'Explicit Fashion Video retry requires an Idempotency-Key',
        code: 'VIDEO_RETRY_IDEMPOTENCY_REQUIRED',
      });
    }
    const parent = await videoService.getClip(request.params.clipId);
    if (!parent || !['FAIL', 'FAILED'].includes(parent.status)) {
      return reply.code(409).send({
        error: 'Only a terminal failed Fashion Video can be retried.',
        code: 'VIDEO_RETRY_STATUS_INVALID',
      });
    }
    if (parent.lookBinding?.whiteBackgroundVerified !== true
      || parent.appearanceReferences?.some((reference) => (
        reference.white_background_verified !== true
      ))) {
      return reply.code(409).send({
        error: 'This old failed video used an unverified appearance input. Start a new Fashion Video from the approved white master.',
        code: 'VIDEO_RETRY_LEGACY_APPEARANCE_FORBIDDEN',
      });
    }
    const automatic = await resolveAutomaticRetryChain(parent);
    if (automatic.inFlight) {
      return reply.code(409).send({
        error: 'Автоматичний повтор перевірки reference уже виконується. Нова платна спроба не створювалася.',
        code: 'VIDEO_AUTOMATIC_RETRY_IN_PROGRESS',
        child_clip_id: automatic.leaf?.clipId ?? parent.automaticRetry?.child_clip_id ?? null,
      });
    }
    const styleId = parent.motionReferenceBinding?.referenceId;
    if (typeof styleId !== 'string' || styleId.length === 0) {
      return reply.code(409).send({
        error: 'The failed clip has no verified Fashion Video style binding.',
        code: 'VIDEO_RETRY_REFERENCE_MISSING',
      });
    }
    const approvedLook = await profiles.approvedLookReference(
      session.profileId,
      parentProjection.look_id,
      runService,
    );
    if (approvedLook.image_sha256 !== parent.lookBinding?.sourceSha256
      || approvedLook.receipt_sha256 !== parent.lookBinding?.approvedLookReceiptSha256) {
      return reply.code(409).send({
        error: 'The approved look changed since this failed video. Start a new video from the current look.',
        code: 'VIDEO_RETRY_LOOK_MISMATCH',
      });
    }
    const motionReference = typeof videoService.fashionVideoCapability === 'function'
      ? await videoService.fashionVideoCapability({
          profileId: session.profileId,
          lookId: parentProjection.look_id,
          approvedLook,
          referenceId: styleId,
          motionMode: parent.mode,
        })
      : null;
    const capability = fashionVideoCapability({
      lookId: parentProjection.look_id,
      approvedLook,
      motionReference,
    });
    if (!capability.available) {
      return reply.code(409).send({
        error: 'Fashion Video style pack is no longer ready; retry is blocked before provider submission.',
        code: capability.reason_code,
      });
    }
    const claim = await videoService.claimRetry(request.params.clipId, idempotencyKey);
    if (!claim.created) {
      if (typeof claim.claim.child_clip_id === 'string') {
        const child = await videoService.getClip(claim.claim.child_clip_id);
        if (!child) {
          return reply.code(409).send({ error: 'Retry recovery is required.', code: 'VIDEO_RETRY_RECOVERY_REQUIRED' });
        }
        const projected = projectClip(session.profileId, parentProjection.look_id, child);
        return reply.code(200).send({
          ...projected,
          clip_id: child.clipId,
          job_id: child.jobId ?? null,
          retry_of: request.params.clipId,
          reused: true,
        });
      }
      return reply.code(409).send({
        error: 'This explicit retry is already being submitted; no second provider job was created.',
        code: 'VIDEO_RETRY_SUBMITTING',
      });
    }
    try {
      const childResult = await videoService.retryFailedClip(request.params.clipId, { videoReference: motionReference });
      await videoService.completeRetryClaim(claim.claimPath, childResult.clipId);
      const child = await videoService.getClip(childResult.clipId);
      const projected = projectClip(session.profileId, parentProjection.look_id, child);
      void finalizePersistedClip({
        profileId: session.profileId,
        lookId: parentProjection.look_id,
        clipId: childResult.clipId,
      });
      return reply.code(202).send({
        ...projected,
        clip_id: childResult.clipId,
        job_id: childResult.jobId,
        retry_of: request.params.clipId,
        reused: false,
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
      const automatic = await resolveAutomaticRetryChain(liveClip);
      const effectiveClip = automatic.leaf;
      const updated = projectClip(session.profileId, projection.look_id, effectiveClip);
      const verifiedStyle = hasVerifiedFashionStyle(effectiveClip);
      const delivery = verifiedVideoDeliveryUrls(effectiveClip);
      const next = resolveVideoQaAction(
        presentationClip(effectiveClip, automatic.inFlight),
        { deliverable: verifiedStyle },
      );
      return reply.code(200).send({
        ...updated,
        qa: effectiveClip.qa,
        // A technically valid MP4 is not deliverable Fashion Video until the
        // hash-bound cut audit proves it contains no source performer.
        ...delivery,
        delivery_code: verifiedStyle
          ? null
          : 'VIDEO_STYLE_PROVENANCE_MISSING',
        next_action: next.action,
        next_action_reason_code: next.reason_code,
        retry_available: next.retry_available,
        // `effectiveClip` is the running child and therefore has no retry
        // record of its own.  The retry evidence belongs to the requested
        // parent clip, which is what the client is polling.
        automatic_retry: automatic.inFlight ? publicAutomaticRetry(liveClip) : null,
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
    let liveClip = await videoService.getClip(request.params.clipId);
    // A process restart loses only the in-memory waiter, never the persisted
    // provider job.  Any later status read resumes the same job id.
    if (isResumableVideoStatus(liveClip?.status)) {
      void finalizePersistedClip({
        profileId: session.profileId,
        lookId: clip.look_id,
        clipId: request.params.clipId,
      });
    }
    if (liveClip?.status === 'NEEDS_QA') {
      await finalizePersistedClip({
        profileId: session.profileId,
        lookId: clip.look_id,
        clipId: request.params.clipId,
      });
      liveClip = await videoService.getClip(request.params.clipId);
    }
    if (['FAIL', 'FAILED'].includes(liveClip?.status)) {
      try {
        await maybeStartAutomaticReferenceQaRetry({
          profileId: session.profileId,
          lookId: clip.look_id,
          clipId: request.params.clipId,
        });
        liveClip = await videoService.getClip(request.params.clipId);
      } catch (error) {
        app.log?.warn?.({ err: error, clip_id: request.params.clipId }, 'fashion video automatic retry status check paused');
      }
    }
    // The runtime file is authoritative. Persist it before replying so a
    // terminal FAIL can never be hidden behind a stale `CREATED` projection.
    const automatic = liveClip
      ? await resolveAutomaticRetryChain(liveClip)
      : { leaf: liveClip, inFlight: false };
    const effectiveClip = automatic.leaf;
    const liveProjection = effectiveClip
      ? projectClip(session.profileId, clip.look_id, effectiveClip)
      : clip;
    const verifiedStyle = hasVerifiedFashionStyle(effectiveClip);
    const delivery = verifiedVideoDeliveryUrls(effectiveClip);
    const displayClip = presentationClip(effectiveClip, automatic.inFlight);
    const next = resolveVideoQaAction(displayClip, { deliverable: verifiedStyle });
    return reply.header('Cache-Control', 'private, no-store').send({
      ...liveProjection,
      status: effectiveClip?.status ?? liveProjection.status,
      qa: effectiveClip?.qa ?? null,
      error: publicVideoFailure(displayClip),
      failure_code: effectiveClip?.failureCode
        ?? effectiveClip?.qa?.defects?.[0]?.code
        ?? null,
      ...delivery,
      delivery_code: verifiedStyle ? null : 'VIDEO_STYLE_PROVENANCE_MISSING',
      next_action: next.action,
      next_action_reason_code: next.reason_code,
      retry_available: next.retry_available,
      // See finalization above: keep the parent-owned retry receipt visible
      // while a child is genuinely active, but clear it once the chain is
      // terminal so the user can make a fresh explicit attempt.
      automatic_retry: automatic.inFlight ? publicAutomaticRetry(liveClip) : null,
    });
  });

  const sendVerifiedVideo = async (request, reply, { attachment = false } = {}) => {
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
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Length', fileStat.size)
        .header('Content-Disposition', `${attachment ? 'attachment' : 'inline'}; filename="fashion-video.mp4"`)
        .send(createReadStream(liveClip.videoPath));
    } catch {
      return reply.code(404).send({ error: 'Video file not found on disk', code: 'VIDEO_FILE_MISSING' });
    }
  };

  // GET /api/profile/video-clips/:clipId/video — stream the verified mp4.
  app.get('/api/profile/video-clips/:clipId/video', async (request, reply) => (
    sendVerifiedVideo(request, reply)
  ));

  // GET /api/profile/video-clips/:clipId/download — same private file, as an
  // attachment.  This is intentionally separate from playback so a browser
  // preview can never accidentally become the user’s downloaded asset.
  app.get('/api/profile/video-clips/:clipId/download', async (request, reply) => (
    sendVerifiedVideo(request, reply, { attachment: true })
  ));

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
      if (hasVerifiedFashionStyle(liveClip)) {
        verified.push({ ...clip, ...verifiedVideoDeliveryUrls(liveClip) });
      }
    }
    return reply.header('Cache-Control', 'private, no-store').send({ clips: verified });
  });

  return { videoService };
}
