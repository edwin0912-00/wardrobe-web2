#!/usr/bin/env node
import path from 'node:path';
import { CodexVlmEvaluator } from '../providers/codex-vlm-evaluator.js';
import { HiggsfieldCliProvider } from '../providers/higgsfield-cli-provider.js';
import { createWebApp } from './app.js';
import { HiggsfieldAssetGenerator } from './higgsfield-asset-generator.js';
import { RunService } from './run-service.js';
import { runLocalPreflight } from './preflight.js';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const vlm = new CodexVlmEvaluator();
const provider = new HiggsfieldCliProvider({ qaEvaluator: vlm.evaluateQa.bind(vlm) });
const assetGenerator = new HiggsfieldAssetGenerator({ provider });
const service = new RunService({ rootDirectory: path.join(projectRoot, 'runtime', 'runs'), provider, vlm, assetGenerator, projectRoot });
await service.initialize();
const health = await runLocalPreflight();
const auth = process.env.ZEELY_DEMO_PIN ? {
  pin: process.env.ZEELY_DEMO_PIN,
  secret: process.env.ZEELY_SESSION_SECRET,
  secure: process.env.ZEELY_COOKIE_SECURE !== 'false',
} : null;
const app = await createWebApp({ service, health, logger: true, auth });
const port = Number.parseInt(process.env.PORT ?? '4173', 10);
await app.listen({ host: '127.0.0.1', port });
