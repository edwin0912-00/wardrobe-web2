#!/usr/bin/env node
import path from 'node:path';
import { MonitorEventStore } from '../monitor/event-store.js';
import { createWebApp } from './app.js';
import { DraftService } from './draft-service.js';
import { createGenerationRuntime } from './generation-provider.js';
import { ProfileService } from './profile-service.js';
import { RunService } from './run-service.js';
import { runLocalPreflight } from './preflight.js';
import { createSceneRuntimeDependencies } from './scene-runtime.js';
import { createVlmEvaluator } from './vlm-provider.js';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');
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
const auth = process.env.ZEELY_DEMO_PIN ? {
  pin: process.env.ZEELY_DEMO_PIN,
  secret: process.env.ZEELY_SESSION_SECRET,
  secure: process.env.ZEELY_COOKIE_SECURE !== 'false',
} : null;
const sceneDependencies = createSceneRuntimeDependencies({
  projectRoot,
  qaEvaluator: vlm.evaluateQa.bind(vlm),
  generationProvider: generation.provider,
  monitor,
});
sceneDependencies.rootDirectory = path.join(runtimeRoot, 'scenes');
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
