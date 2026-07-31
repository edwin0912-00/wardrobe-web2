#!/usr/bin/env node
import path from 'node:path';
import { MonitorEventStore } from '../monitor/event-store.js';
import { createWebApp } from './app.js';
import { DraftService } from './draft-service.js';
import { adoptLegacyEditorialShootRoot } from './editorial-shoot-service.js';
import { createGenerationRuntime } from './generation-provider.js';
import { ProfileService } from './profile-service.js';
import { RunService } from './run-service.js';
import { runLocalPreflight } from './preflight.js';
import { createSceneRuntimeDependencies } from './scene-runtime.js';
import { createVlmEvaluator } from './vlm-provider.js';
import { createFalRealtimeTokenIssuer } from './fal-realtime-token.js';
import { createVideoRuntime } from './video-runtime.js';
import { createFashionVideoReferenceResolver } from './video-reference-registry.js';
import { createVideoAssetUrlResolver } from './video-source-bridge.js';
import { loadReleaseIdentity } from './release-identity.js';
import { GodViewAuth, OpenTesterGodViewAuth } from './god-view-auth.js';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const releaseIdentity = await loadReleaseIdentity(projectRoot);
const generationMode = process.env.ZEELY_GENERATION_PROVIDER ?? 'higgsfield';
const runtimeRoot = process.env.ZEELY_RUNTIME_ROOT
  ? path.resolve(process.env.ZEELY_RUNTIME_ROOT)
  : path.join(projectRoot, 'runtime');
const monitor = new MonitorEventStore({ filename: path.join(runtimeRoot, 'monitor', 'events.jsonl') });
await monitor.initialize();
const drafts = new DraftService({ rootDirectory: path.join(runtimeRoot, 'drafts') });
await drafts.initialize();
await drafts.cleanupExpired();
const profiles = new ProfileService({ databasePath: path.join(runtimeRoot, 'profiles.sqlite') });
const vlm = createVlmEvaluator();
const generation = await createGenerationRuntime({
  mode: generationMode,
  vlm,
  projectRoot,
  onFatal(error) {
    void monitor.append({
      source: 'server',
      type: 'service.codex_worker_fatal',
      severity: 'error',
      data: { code: error?.code ?? 'CODEX_WORKER_ERROR', message: error?.message ?? 'Codex worker stopped' },
    }).catch(() => {});
  },
});
const service = new RunService({
  rootDirectory: path.join(runtimeRoot, 'runs'),
  provider: generation.provider,
  vlm,
  assetGenerator: generation.assetGenerator,
  generationRoute: generation.generationRoute,
  projectRoot,
  observer: async (run) => monitor.append({
    source: 'runner', type: 'run.phase',
    severity: ['FAILED', 'NEEDS_INPUT'].includes(run.status) ? 'error' : 'info',
    run_id: run.run_id,
    data: { status: run.status, stage: run.inner_state ?? run.phase, message: run.message },
  }),
});
await service.initialize();
const health = await runLocalPreflight({ generationMode, codexStatus: generation.status });
health.fashion_shoot_qa_mode = process.env.ZEELY_FASHION_SHOOT_QA_MODE ?? 'review';
const auth = process.env.ZEELY_DEMO_PIN ? {
  pin: process.env.ZEELY_DEMO_PIN,
  secret: process.env.ZEELY_SESSION_SECRET,
  secure: process.env.ZEELY_COOKIE_SECURE !== 'false',
} : null;
const godViewAuth = process.env.ZEELY_GOD_VIEW_OPEN_TESTERS === 'true'
  ? new OpenTesterGodViewAuth()
  : process.env.ZEELY_GOD_VIEW_KEY
    ? new GodViewAuth({
      key: process.env.ZEELY_GOD_VIEW_KEY,
      sessionSecret: process.env.ZEELY_GOD_VIEW_SESSION_SECRET
        ?? process.env.ZEELY_SESSION_SECRET
        ?? process.env.ZEELY_GOD_VIEW_KEY,
      secure: process.env.ZEELY_COOKIE_SECURE !== 'false',
    })
    : null;
const sceneDependencies = createSceneRuntimeDependencies({
  projectRoot,
  qaEvaluator: vlm.evaluateQa.bind(vlm),
  generationProvider: generation.provider,
  monitor,
});
// A shoot's state and a shoot's scene assets are one shoot, so they take one root.
// Only this file knows runtimeRoot, and it used to override the scene root alone, which
// left the editorial root pinned to the project tree and split every shoot in half —
// see adoptLegacyEditorialShootRoot for what that cost. Both keys now come from the same
// root, and anything still under the old one is moved before the service reads either.
sceneDependencies.rootDirectory = path.join(runtimeRoot, 'scenes');
sceneDependencies.editorialRootDirectory = path.join(runtimeRoot, 'editorial-shoots');
const adoptedShootIds = await adoptLegacyEditorialShootRoot({
  from: path.join(projectRoot, 'runtime', 'editorial-shoots'),
  to: sceneDependencies.editorialRootDirectory,
});
if (adoptedShootIds.length > 0) {
  await monitor.append({
    source: 'server',
    type: 'service.editorial_shoots_adopted',
    data: { count: adoptedShootIds.length, shoot_ids: adoptedShootIds },
  });
}
const videoSourceBridge = createVideoAssetUrlResolver({
  clipStoreRoot: path.join(runtimeRoot, 'video-clips'),
  httpsOrigin: process.env.ZEELY_PUBLIC_HTTPS_ORIGIN,
});
const fashionVideoReferenceResolver = createFashionVideoReferenceResolver({
  rootDirectory: process.env.ZEELY_VIDEO_REFERENCE_ROOT,
  manifestPath: path.join(
    projectRoot,
    'config',
    'video-reference-packs',
    'fashion-cool-style-v1.json',
  ),
});
const videoService = createVideoRuntime({
  runtimeRoot,
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  assetUrlResolver: videoSourceBridge.videoAssetUrlResolver,
  fashionVideoReferenceResolver,
});
// A video create receipt is durable before the provider wait starts.  Recover
// only those exact recorded jobs after a daemon restart; this does not call
// createJob and therefore cannot duplicate a paid video.  The route layer also
// resumes on a later status request, covering a provider wait interrupted by a
// further restart.
for (const clipId of await videoService.resumableClipIds()) {
  void videoService.finalizeClip(clipId)
    .then(() => monitor.append({ source: 'server', type: 'video.resume_completed', data: { clip_id: clipId } }))
    .catch((error) => monitor.append({
      source: 'server',
      type: 'video.resume_paused',
      severity: 'warn',
      data: { clip_id: clipId, code: error?.code ?? 'VIDEO_FINALIZE_ERROR' },
    }).catch(() => {}));
}
const app = await createWebApp({
  service,
  health,
  healthProvider: generation.healthStatus,
  logger: true,
  auth,
  monitor,
  drafts,
  profiles,
  sceneDependencies,
  lucyTokenIssuer: createFalRealtimeTokenIssuer(),
  videoService,
  videoSourceBridge,
  releaseIdentity,
  godViewAuth,
});
const draftCleanupTimer = setInterval(() => drafts.cleanupExpired().catch(() => {}), 60_000);
const profileCleanup = async () => {
  profiles.cleanupExpired();
  await profiles.flushDeletionQueue({
    runService: service,
    sceneService: app.sceneService,
    editorialShootService: app.editorialShootService,
  });
};
await profileCleanup();
const profileCleanupTimer = setInterval(() => profileCleanup().catch(() => {}), 60_000);
app.addHook('onClose', async () => {
  clearInterval(draftCleanupTimer);
  clearInterval(profileCleanupTimer);
  profiles.close();
  await generation.close();
});
const port = Number.parseInt(process.env.PORT ?? '4173', 10);
await app.listen({ host: '127.0.0.1', port });
await monitor.append({ source: 'server', type: 'service.web_started', data: { port, pid: process.pid } });
