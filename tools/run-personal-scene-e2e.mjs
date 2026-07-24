#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { HiggsfieldCliProvider } from '../src/providers/higgsfield-cli-provider.js';
import { ProfileService } from '../src/web/profile-service.js';
import {
  SceneEvaluatorAdapter,
  SceneGeneratorAdapter,
} from '../src/web/scene-adapters.js';
import {
  createProfileApprovedLookResolver,
  FilesystemScenePresetResolver,
} from '../src/web/scene-resolvers.js';
import { SceneService } from '../src/web/scene-service.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ALLOWED_OUTPUTS = new Set(['avatar_outfit.png', 'run-manifest.json']);

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Arguments must be supplied as --name value pairs');
    }
    values[key.slice(2)] = value;
  }
  for (const required of ['runtime-root']) {
    if (!values[required]) throw new Error(`--${required} is required`);
  }
  const resumingExistingScene = Boolean(values['scene-id']);
  if (!resumingExistingScene) {
    for (const required of ['profile-id', 'look-id', 'preset-id', 'preset-version', 'idempotency-key']) {
      if (!values[required]) throw new Error(`--${required} is required when --scene-id is omitted`);
    }
  }
  for (const id of ['profile-id', 'look-id', 'preset-id', 'preset-version', 'scene-id']) {
    if (values[id] === undefined) continue;
    if (!SAFE_ID.test(values[id])) throw new Error(`--${id} is invalid`);
  }
  if (values['idempotency-key']
    && (values['idempotency-key'].length < 8 || values['idempotency-key'].length > 256)) {
    throw new Error('--idempotency-key must contain 8–256 characters');
  }
  return values;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeRunOutputReader(runtimeRoot) {
  const runRoot = path.join(runtimeRoot, 'runs');
  return {
    async getRun(runId) {
      if (!SAFE_ID.test(runId)) return null;
      return JSON.parse(await readFile(path.join(runRoot, runId, 'run.json'), 'utf8'));
    },
    async outputFile(runId, name) {
      if (!SAFE_ID.test(runId) || !ALLOWED_OUTPUTS.has(name)) return null;
      return path.join(runRoot, runId, 'outputs', name);
    },
  };
}

function providerRoute(outputRoot) {
  const common = {
    resolution: '2k',
    quality: 'high',
  };
  return {
    gpt_image_2: new HiggsfieldCliProvider({
      ...common,
      aspectRatio: '3:4',
      journalDirectory: path.join(outputRoot, 'provider-journals', 'gpt-image-2'),
    }),
    nano_banana_flash: new HiggsfieldCliProvider({
      ...common,
      aspectRatio: '4:5',
      journalDirectory: path.join(outputRoot, 'provider-journals', 'nano-banana-2'),
    }),
    nano_banana_2: new HiggsfieldCliProvider({
      ...common,
      aspectRatio: '4:5',
      journalDirectory: path.join(outputRoot, 'provider-journals', 'nano-banana-pro'),
    }),
  };
}

async function waitForTerminal(service, sceneId) {
  const running = service.running.get(sceneId);
  if (running) await running;
  while (true) {
    const scene = await service.getScene(sceneId);
    if (!scene || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(scene.status)) return scene;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

const args = parseArgs(process.argv.slice(2));
const projectRoot = path.resolve(import.meta.dirname, '..');
const runtimeRoot = path.resolve(args['runtime-root']);
const outputRoot = path.resolve(args['output-root'] ?? path.join(projectRoot, 'runtime', 'personal-scene-e2e'));
const profiles = new ProfileService({
  databasePath: path.join(runtimeRoot, 'profiles.sqlite'),
});

try {
  await profiles.initialize();
  const runService = safeRunOutputReader(runtimeRoot);
  const presetResolver = new FilesystemScenePresetResolver({
    rootDirectory: path.join(projectRoot, 'assets', 'scene-presets'),
    projectRoot,
  });
  await presetResolver.initialize();
  let approvedLookReference;
  let presetReference;
  if (!args['scene-id']) {
    approvedLookReference = await profiles.approvedLookReference(
      args['profile-id'],
      args['look-id'],
      runService,
    );
    presetReference = await presetResolver.presetReference({
      presetId: args['preset-id'],
      presetVersion: args['preset-version'],
    });
  }
  const service = new SceneService({
    rootDirectory: path.join(outputRoot, 'scenes'),
    approvedLookResolver: createProfileApprovedLookResolver({ profiles, runService }),
    presetResolver,
    generator: new SceneGeneratorAdapter({ providers: providerRoute(outputRoot) }),
    evaluator: new SceneEvaluatorAdapter({ timeoutMs: 180_000 }),
    observer: async (scene) => {
      process.stdout.write(`${JSON.stringify({
        type: 'scene_progress',
        scene_id: scene.scene_id,
        status: scene.status,
        phase: scene.phase,
        attempt: scene.execution?.attempt ?? 0,
        updated_at: scene.updated_at,
      })}\n`);
    },
  });
  await service.initialize();
  let created;
  if (args['scene-id']) {
    created = await service.getScene(args['scene-id']);
    if (!created) throw new Error(`Scene ${args['scene-id']} does not exist in the selected output root`);
  } else {
    created = await service.createScene({
      idempotencyKey: args['idempotency-key'],
      approvedLookReference,
      presetReference,
    });
  }
  if (created.status === 'FAILED' && args['retry-key']) {
    created = await service.retryScene(created.scene_id, {
      idempotencyKey: args['retry-key'],
    });
  }
  const final = await waitForTerminal(service, created.scene_id);
  const result = {
    scene_id: final?.scene_id ?? created.scene_id,
    status: final?.status ?? 'MISSING',
    phase: final?.phase ?? 'MISSING',
    preset_id: final?.preset?.preset_id ?? presetReference?.preset_id ?? 'MISSING',
    attempts: final?.execution?.attempt ?? 0,
    qa: final?.qa ?? null,
    error: final?.error ?? null,
  };
  if (final?.status === 'COMPLETED') {
    const filename = await service.outputFile(final.scene_id, 'scene.png');
    const bytes = await readFile(filename);
    const metadata = await sharp(bytes).metadata();
    result.output = {
      sha256: sha256(bytes),
      width: metadata.width,
      height: metadata.height,
      media_type: 'image/png',
    };
  }
  process.stdout.write(`${JSON.stringify({ type: 'scene_result', ...result }, null, 2)}\n`);
  if (final?.status !== 'COMPLETED') process.exitCode = 1;
} finally {
  profiles.close();
}
