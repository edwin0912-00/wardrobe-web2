#!/usr/bin/env node
import path from 'node:path';
import { CodexVlmEvaluator } from '../providers/codex-vlm-evaluator.js';
import { HiggsfieldCliProvider } from '../providers/higgsfield-cli-provider.js';
import { MonitorEventStore } from '../monitor/event-store.js';
import { createWebApp } from './app.js';
import { DraftService } from './draft-service.js';
import { HiggsfieldAssetGenerator } from './higgsfield-asset-generator.js';
import { ProfileService } from './profile-service.js';
import { RunService } from './run-service.js';
import { runLocalPreflight } from './preflight.js';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const monitor = new MonitorEventStore({ filename: path.join(projectRoot, 'runtime', 'monitor', 'events.jsonl') });
await monitor.initialize();
const drafts = new DraftService({ rootDirectory: path.join(projectRoot, 'runtime', 'drafts') });
await drafts.initialize();
await drafts.cleanupExpired();
const profiles = new ProfileService({ databasePath: path.join(projectRoot, 'runtime', 'profiles.sqlite') });
const vlm = new CodexVlmEvaluator();
const provider = new HiggsfieldCliProvider({ qaEvaluator: vlm.evaluateQa.bind(vlm) });
const assetGenerator = new HiggsfieldAssetGenerator({ provider });
const service = new RunService({
  rootDirectory: path.join(projectRoot, 'runtime', 'runs'), provider, vlm, assetGenerator, projectRoot,
  observer: async (run) => monitor.append({
    source: 'runner', type: 'run.phase',
    severity: ['FAILED', 'NEEDS_INPUT'].includes(run.status) ? 'error' : 'info',
    run_id: run.run_id,
    data: { status: run.status, stage: run.inner_state ?? run.phase, message: run.message },
  }),
});
await service.initialize();
const health = await runLocalPreflight();
const auth = process.env.ZEELY_DEMO_PIN ? {
  pin: process.env.ZEELY_DEMO_PIN,
  secret: process.env.ZEELY_SESSION_SECRET,
  secure: process.env.ZEELY_COOKIE_SECURE !== 'false',
} : null;
const app = await createWebApp({ service, health, logger: true, auth, monitor, drafts, profiles });
const draftCleanupTimer = setInterval(() => drafts.cleanupExpired().catch(() => {}), 60_000);
const profileCleanup = async () => {
  profiles.cleanupExpired();
  await profiles.flushDeletionQueue(service);
};
await profileCleanup();
const profileCleanupTimer = setInterval(() => profileCleanup().catch(() => {}), 60_000);
app.addHook('onClose', async () => {
  clearInterval(draftCleanupTimer);
  clearInterval(profileCleanupTimer);
  profiles.close();
});
const port = Number.parseInt(process.env.PORT ?? '4173', 10);
await app.listen({ host: '127.0.0.1', port });
await monitor.append({ source: 'server', type: 'service.web_started', data: { port, pid: process.pid } });
