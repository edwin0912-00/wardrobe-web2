import { createReadStream } from 'node:fs';
import { sendPresentationImage } from './presentation-preview.js';

function noStore(reply) {
  return reply.header('Cache-Control', 'private, no-store').header('Vary', 'Cookie');
}

function imageReply(request, reply, filename) {
  if (!filename) return reply.code(404).send({ error: 'God View asset not found' });
  return sendPresentationImage(request, reply, {
    filename,
    cacheControl: 'private, max-age=900',
  });
}

function runSummary(run, runId) {
  if (!run) return {
    run_id: runId,
    status: 'MISSING',
    phase: null,
    message: 'Run metadata is no longer available',
    garments: [],
  };
  return {
    run_id: run.run_id,
    status: run.status,
    phase: run.phase,
    inner_state: run.inner_state ?? null,
    terminal_stage: run.terminal_stage ?? null,
    created_at: run.created_at ?? null,
    updated_at: run.updated_at ?? null,
    message: run.message ?? '',
    qa: run.qa ?? {},
    execution_route: run.execution_route ?? {},
    garments: (run.garments ?? []).map((garment) => ({
      source_index: garment.source_index,
      category: garment.category,
      confidence: garment.confidence,
      observed: garment.observed ?? {},
      source_url: `/api/god-view/assets/runs/${encodeURIComponent(runId)}/garments/${garment.source_index}`,
    })),
    avatar_url: `/api/god-view/assets/runs/${encodeURIComponent(runId)}/avatar`,
    look_url: `/api/god-view/assets/runs/${encodeURIComponent(runId)}/look`,
    person_source_url: `/api/god-view/assets/runs/${encodeURIComponent(runId)}/inputs/person`,
    identity_source_url: `/api/god-view/assets/runs/${encodeURIComponent(runId)}/inputs/identity`,
  };
}

function publicShot(shot) {
  return {
    slot: shot.slot,
    status: shot.status,
    retry_count: shot.retry_count ?? 0,
    output_sha256: shot.output?.sha256 ?? null,
  };
}

async function buildOverview({ profiles, runService, sceneService, editorialShootService, videoService }) {
  const snapshot = profiles.godViewSnapshot();
  let avatars = 0;
  let looks = 0;
  let runs = 0;
  let scenes = 0;
  let shoots = 0;
  let videos = 0;
  const viewProfiles = [];

  for (const profile of snapshot.profiles) {
    const runCache = new Map();
    const resolveRun = async (runId) => {
      if (!runCache.has(runId)) runCache.set(runId, runService.getRun(runId));
      return runCache.get(runId);
    };
    const view = {
      profile_id: profile.profile_id,
      created_at: profile.created_at,
      expires_at: profile.expires_at,
      avatars: [],
      runs: [],
    };
    for (const claim of profile.runs) {
      runs += 1;
      view.runs.push({
        ...claim,
        run: runSummary(await resolveRun(claim.run_id), claim.run_id),
      });
    }
    for (const avatar of profile.avatars) {
      avatars += 1;
      const avatarView = {
        ...avatar,
        image_url: `/api/god-view/assets/runs/${encodeURIComponent(avatar.source_run_id)}/avatar`,
        looks: [],
      };
      for (const look of avatar.looks) {
        looks += 1;
        const lookView = {
          ...look,
          image_url: `/api/god-view/assets/runs/${encodeURIComponent(look.source_run_id)}/look`,
          run: runSummary(await resolveRun(look.source_run_id), look.source_run_id),
          scenes: [],
          shoots: [],
          videos: [],
        };
        for (const scene of look.scenes) {
          scenes += 1;
          lookView.scenes.push({
            ...scene,
            image_url: scene.status === 'COMPLETED'
              ? `/api/god-view/assets/scenes/${encodeURIComponent(scene.scene_id)}/image`
              : null,
          });
        }
        for (const shoot of look.shoots) {
          shoots += 1;
          const live = editorialShootService ? await editorialShootService.getShoot(shoot.shoot_id) : null;
          lookView.shoots.push({
            ...shoot,
            shots: (live?.shots ?? []).map((shot) => ({
              ...publicShot(shot),
              image_url: shot.output
                ? `/api/god-view/assets/shoots/${encodeURIComponent(shoot.shoot_id)}/shots/${encodeURIComponent(shot.slot)}`
                : null,
            })),
          });
        }
        for (const clip of look.videos) {
          videos += 1;
          const live = videoService ? await videoService.getClip(clip.clip_id) : null;
          lookView.videos.push({
            ...clip,
            qa: live?.qa ?? null,
            video_url: live?.videoPath
              ? `/api/god-view/assets/videos/${encodeURIComponent(clip.clip_id)}`
              : null,
          });
        }
        avatarView.looks.push(lookView);
      }
      view.avatars.push(avatarView);
    }
    viewProfiles.push(view);
  }
  return {
    generated_at: new Date().toISOString(),
    summary: { profiles: viewProfiles.length, avatars, looks, runs, scenes, shoots, videos },
    profiles: viewProfiles,
  };
}

/**
 * Register a read-only control-room API. It is never registered unless an
 * independent GodViewAuth instance is explicitly provisioned by server env.
 */
export async function registerGodViewRoutes(app, {
  auth,
  profiles,
  runService,
  sceneService = null,
  editorialShootService = null,
  videoService = null,
}) {
  if (!auth || !profiles || !runService) return { enabled: false };
  const authorized = (request, reply) => auth.require(request, reply);

  app.get('/api/god-view/session', async (request, reply) => {
    const session = auth.session(request);
    return noStore(reply).send({ authenticated: Boolean(session), expires_at: session ? new Date(session.expiresAt).toISOString() : null });
  });

  app.post('/api/god-view/session', async (request, reply) => {
    const session = auth.login(request, reply, String(request.body?.key ?? ''));
    if (!session) return reply;
    return noStore(reply).send({ authenticated: true, ...session });
  });

  app.delete('/api/god-view/session', async (_request, reply) => {
    auth.logout(reply);
    return noStore(reply).code(204).send();
  });

  app.get('/api/god-view/overview', async (request, reply) => {
    if (!authorized(request, reply)) return reply;
    return noStore(reply).send(await buildOverview({
      profiles,
      runService,
      sceneService,
      editorialShootService,
      videoService,
    }));
  });

  app.get('/api/god-view/assets/runs/:runId/:asset', async (request, reply) => {
    if (!authorized(request, reply)) return reply;
    if (!profiles.godViewOwns('RUN', request.params.runId)) return reply.code(404).send({ error: 'God View asset not found' });
    const filename = request.params.asset === 'avatar'
      ? await runService.outputFile(request.params.runId, 'avatar.png')
      : request.params.asset === 'look'
      ? await runService.outputFile(request.params.runId, 'avatar_outfit.png')
      : null;
    return imageReply(request, reply, filename);
  });

  app.get('/api/god-view/assets/runs/:runId/garments/:sourceIndex', async (request, reply) => {
    if (!authorized(request, reply)) return reply;
    if (!profiles.godViewOwns('RUN', request.params.runId)) return reply.code(404).send({ error: 'God View asset not found' });
    return imageReply(request, reply, await runService.garmentSourceFile(request.params.runId, request.params.sourceIndex));
  });

  app.get('/api/god-view/assets/runs/:runId/inputs/:kind', async (request, reply) => {
    if (!authorized(request, reply)) return reply;
    if (!profiles.godViewOwns('RUN', request.params.runId)) return reply.code(404).send({ error: 'God View asset not found' });
    const filename = request.params.kind === 'person'
      ? await runService.personSourceFile(request.params.runId)
      : request.params.kind === 'identity'
      ? await runService.identityDetailSourceFile(request.params.runId)
      : null;
    return imageReply(request, reply, filename);
  });

  app.get('/api/god-view/assets/scenes/:sceneId/image', async (request, reply) => {
    if (!authorized(request, reply)) return reply;
    if (!sceneService || !profiles.godViewOwns('SCENE', request.params.sceneId)) return reply.code(404).send({ error: 'God View asset not found' });
    return imageReply(request, reply, await sceneService.outputFile(request.params.sceneId, 'scene.png'));
  });

  app.get('/api/god-view/assets/shoots/:shootId/shots/:slot', async (request, reply) => {
    if (!authorized(request, reply)) return reply;
    if (!editorialShootService || !profiles.godViewOwns('SHOOT', request.params.shootId)) return reply.code(404).send({ error: 'God View asset not found' });
    return imageReply(request, reply, await editorialShootService.outputFile(request.params.shootId, request.params.slot));
  });

  app.get('/api/god-view/assets/videos/:clipId', async (request, reply) => {
    if (!authorized(request, reply)) return reply;
    if (!videoService || !profiles.godViewOwns('VIDEO', request.params.clipId)) return reply.code(404).send({ error: 'God View asset not found' });
    const clip = await videoService.getClip(request.params.clipId);
    if (!clip?.videoPath) return reply.code(404).send({ error: 'God View asset not found' });
    return noStore(reply).type('video/mp4').send(createReadStream(clip.videoPath));
  });

  return { enabled: true };
}
