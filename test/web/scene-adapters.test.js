import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  HiggsfieldCliProvider,
  orderedReferenceDescriptors,
} from '../../src/providers/higgsfield-cli-provider.js';
import {
  CONTACT_SHADOW_CROP_WAIVER_REFUSED,
  CONTACT_SHADOW_WAIVER_REFUSED,
  CONTACT_SHADOW_WAIVERS,
  EVALUATOR_FRAMING_DEFECTS,
  FRAMING_ANATOMY_DEFECTS,
  FRAMING_DEFECT_OUTSIDE_VOCABULARY,
  FRAMING_VISIBILITY_DEFECTS,
  SceneEvaluationInfrastructureError,
  SceneEvaluatorAdapter,
  SceneGeneratorAdapter,
  assertFramingDefectVocabulary,
  evaluatorPrompt,
  reconcileContactShadowWaiver,
  validateEvaluatorPayload,
} from '../../src/web/scene-adapters.js';
import {
  DEFAULT_SCENE_MODEL_ROUTE,
  SCENE_EVALUATOR_GATES,
  SCENE_REFERENCE_ROLES,
  assessFramingEvidence,
  normalizeEvaluatorResult,
  sha256,
  validateFramingEvidence,
} from '../../src/web/scene-contract.js';

async function imageFile(root, name, { width = 320, height = 400, color = '#806050' } = {}) {
  const filename = path.join(root, name);
  const bytes = await sharp({
    create: { width, height, channels: 3, background: color },
  }).png().toBuffer();
  await writeFile(filename, bytes);
  return { path: filename, sha256: sha256(bytes), media_type: 'image/png' };
}

async function structuredReferenceFile(root, name, document) {
  const filename = path.join(root, name);
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
  await writeFile(filename, bytes);
  return { path: filename, sha256: sha256(bytes), media_type: 'application/json' };
}

async function contextFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scene-adapter-'));
  const approved = await imageFile(root, 'approved-look.png', { color: '#ddd3c8' });
  const references = [];
  for (const [index, role] of SCENE_REFERENCE_ROLES.entries()) {
    references.push({
      ...(await imageFile(root, `${role}.png`, { color: `#${String(22 + index * 17).repeat(3)}` })),
      role,
      reference_id: `ref-${index + 1}`,
    });
  }
  const prompt = 'Create one original production fashion scene. ATTACHMENT_1 is the approved look.';
  return {
    root,
    approved,
    references,
    prompt,
    base: {
      scene_id: 'scene_adapter_test',
      cycle: 1,
      route_hash: 'a'.repeat(64),
      idempotency_key: 'b'.repeat(64),
      aspect_ratio: '4:5',
      width: 1024,
      height: 1280,
      prompt,
      prompt_sha256: sha256(Buffer.from(prompt)),
      approved_look: { ...approved, role: 'look_master' },
      references,
      work_directory: root,
    },
  };
}

async function approvedItemEvidenceFixture(root) {
  const definitions = [
    {
      item_id: 'set-0',
      role: 'ITEM_TOP',
      category: 'top',
      color: '#264f3a',
      observed: {
        garment_type: 'hooded sweatshirt',
        colors: ['dark green', 'white', 'red', 'navy'],
        material: ['fleece knit'],
        pattern: ['braided red and navy stripe'],
        logo_text: ['GUCCI', 'FIRENZE', '1921', 'interlocking GG'],
        construction: ['hood', 'drawcords', 'rib cuffs'],
      },
    },
    {
      item_id: 'set-2',
      role: 'ITEM_BAG',
      category: 'bag',
      color: '#dddde2',
      observed: {
        garment_type: 'structured top-handle flap handbag',
        colors: ['light grey', 'silver'],
        material: ['leather', 'metal hardware'],
        pattern: ['repeating M-in-octagon monogram'],
        logo_text: ['M', 'MKM'],
        construction: ['rounded handle', 'front flap', 'oval clasp', 'gusseted sides'],
      },
    },
  ];
  return Promise.all(definitions.map(async (item, index) => ({
    ...item,
    order: index + 1,
    reference_set_id: item.item_id,
    ...(await imageFile(root, `approved-${item.item_id}.png`, { color: item.color })),
  })));
}

test('SceneGeneratorAdapter maps the exact three-model route and sends approved look plus five roles in strict order', async () => {
  const fixture = await contextFixture();
  for (const route of DEFAULT_SCENE_MODEL_ROUTE) {
    const calls = [];
    const providerOutput = await sharp({
      create: {
        width: route.job_set_type === 'gpt_image_2' ? 900 : 800,
        height: route.job_set_type === 'gpt_image_2' ? 1200 : 1000,
        channels: 3,
        background: '#b98f72',
      },
    }).png().toBuffer();
    const provider = {
      aspectRatio: route.job_set_type === 'gpt_image_2' ? '3:4' : '4:5',
      async generate(context) {
        calls.push(context);
        return {
          image: providerOutput,
          mediaType: 'image/png',
          metadata: { provider: 'higgsfield', job_id: `provider-job-${route.order}` },
        };
      },
    };
    const adapter = new SceneGeneratorAdapter({ provider });
    const result = await adapter.generateScene({
      ...fixture.base,
      attempt: route.order,
      model: route.model,
      model_version: route.model_version,
      job_set_type: route.job_set_type,
      quality: route.quality,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].job_set_type, route.job_set_type);
    assert.equal(calls[0].model_name, route.model);
    assert.deepEqual(
      calls[0].references.ordered.map((item) => item.role),
      ['APPROVED_LOOK_MASTER', ...SCENE_REFERENCE_ROLES.map((role) => `SCENE_${role.toUpperCase()}`)],
    );
    assert.equal(calls[0].references.ordered.length, 6);
    assert.equal(calls[0].references.ordered[0].sha256, fixture.approved.sha256);
    assert.doesNotMatch(calls[0].prompt, /\/Users\/|\/tmp\/|scene-adapter-/);
    const metadata = await sharp(result.image).metadata();
    assert.equal(metadata.width * 5, metadata.height * 4);
    if (route.job_set_type === 'gpt_image_2') {
      assert.deepEqual([metadata.width, metadata.height], [1024, 1280]);
    }
    assert.equal(result.metadata.provider_request_id, `provider-job-${route.order}`);
    assert.equal(result.metadata.model_version, route.model_version);
    assert.equal(result.metadata.job_set_type, route.job_set_type);
    assert.equal(result.metadata.source_width, route.job_set_type === 'gpt_image_2' ? 900 : 800);
    assert.equal(result.metadata.source_height, route.job_set_type === 'gpt_image_2' ? 1200 : 1000);
    assert.equal(result.metadata.source_aspect_ratio, route.job_set_type === 'gpt_image_2' ? '3:4' : '4:5');
    assert.equal(
      result.metadata.transport_aspect_ratio,
      route.job_set_type === 'gpt_image_2' ? '3:4' : '4:5',
    );
    assert.equal(result.metadata.raw_output_sha256, sha256(providerOutput));
    assert.equal(result.metadata.geometry_output_sha256, sha256(result.image));
    // 900×1200 is 3:4, six percent taller than the 4:5 delivery: a centre crop
    // of 75 pixels of height, which states what it cost. 800×1000 is already
    // 4:5 and only needs the canonical canvas, so nothing is discarded there.
    assert.equal(
      result.metadata.geometry_strategy,
      route.job_set_type === 'gpt_image_2'
        ? 'centre_crop_to_exact_4_5'
        : 'provider_exact_4_5_rescaled',
    );
    if (route.job_set_type === 'gpt_image_2') {
      assert.equal(result.metadata.geometry_crop_fraction, 0.0625);
    } else {
      assert.equal(result.metadata.geometry_crop_fraction, undefined);
    }
  }
});

test('SceneGeneratorAdapter attaches hash-bound item cutouts before optional scene images and compiles exact facts', async () => {
  const fixture = await contextFixture();
  const itemEvidence = await approvedItemEvidenceFixture(fixture.root);
  const calls = [];
  const providerOutput = await sharp({
    create: {
      width: 900,
      height: 1200,
      channels: 3,
      background: '#b98f72',
    },
  }).png().toBuffer();
  const adapter = new SceneGeneratorAdapter({
    provider: {
      aspectRatio: '3:4',
      async generate(context) {
        calls.push(context);
        return {
          image: providerOutput,
          metadata: { provider: 'fixture', job_id: 'item-evidence-generation' },
        };
      },
    },
  });
  await adapter.generateScene({
    ...fixture.base,
    attempt: 1,
    ...DEFAULT_SCENE_MODEL_ROUTE[0],
    item_evidence: itemEvidence,
  });
  assert.deepEqual(
    calls[0].references.ordered.map((item) => item.role),
    [
      'APPROVED_LOOK_MASTER',
      'ITEM_TOP',
      'ITEM_BAG',
      ...SCENE_REFERENCE_ROLES.map((role) => `SCENE_${role.toUpperCase()}`),
    ],
  );
  assert.equal(calls[0].references.ordered.length, 8);
  assert.match(calls[0].prompt, /APPROVED ITEM EVIDENCE — EXACT PRODUCT AUTHORITY/);
  assert.match(calls[0].prompt, /repeating M-in-octagon monogram/);
  assert.doesNotMatch(calls[0].prompt, /approved-set-2\.png|\/tmp\//);
});

test('SceneGeneratorAdapter requires GPT 3:4 transport and native 4:5 for both Nano routes', async () => {
  const fixture = await contextFixture();
  const adapter = new SceneGeneratorAdapter({
    provider: { aspectRatio: '4:5', generate: async () => { throw new Error('must not run'); } },
  });
  await assert.rejects(() => adapter.generateScene({
    ...fixture.base,
    attempt: 1,
    ...DEFAULT_SCENE_MODEL_ROUTE[0],
  }), /configured with aspectRatio: 3:4/);
});

test('SceneGeneratorAdapter restarts the fixed route from GPT on a new cycle while preserving the global attempt number', async () => {
  const fixture = await contextFixture();
  const repair = {
    ...(await imageFile(fixture.root, 'cycle-one-best-candidate.png', {
      width: 1024,
      height: 1280,
    })),
    role: 'failed_candidate',
    attempt: 1,
  };
  const calls = [];
  const providerOutput = await sharp({
    create: { width: 900, height: 1200, channels: 3, background: '#a87d65' },
  }).png().toBuffer();
  const prompt = `${fixture.prompt}
ATTACHMENT_2 is the hash-bound failed scene candidate.`;
  const adapter = new SceneGeneratorAdapter({
    provider: {
      aspectRatio: '3:4',
      async generate(context) {
        calls.push(context);
        return {
          image: providerOutput,
          metadata: { provider: 'higgsfield', job_id: 'cycle-two-gpt-job' },
        };
      },
    },
  });
  const generated = await adapter.generateScene({
    ...fixture.base,
    prompt,
    prompt_sha256: sha256(Buffer.from(prompt)),
    repair_candidate: repair,
    attempt: 4,
    cycle_attempt: 1,
    ...DEFAULT_SCENE_MODEL_ROUTE[0],
  });
  assert.equal(calls[0].attempt, 4);
  assert.equal(calls[0].cycle_attempt, 1);
  assert.deepEqual(
    calls[0].references.ordered.slice(0, 2).map((item) => item.role),
    ['APPROVED_LOOK_MASTER', 'FAILED_SCENE_CANDIDATE'],
  );
  assert.equal(generated.metadata.repair_from_attempt, 1);
});

test('SceneGeneratorAdapter drives the Higgsfield CLI harness with GPT 3:4 and six ordered hash-bound images', async () => {
  const fixture = await contextFixture();
  const providerOutput = await sharp({
    create: { width: 900, height: 1200, channels: 3, background: '#9f765f' },
  }).png().toBuffer();
  const calls = [];
  const provider = new HiggsfieldCliProvider({
    generationMode: 'oneshot',
    aspectRatio: '3:4',
    async commandRunner(binary, args, options) {
      calls.push({ kind: 'command', binary, args, options });
      return {
        stdout: JSON.stringify({
          id: 'scene-provider-job-1',
          status: 'completed',
          display_name: 'GPT Image 2',
          job_set_type: 'gpt_image_2',
          result_url: 'https://assets.cloudfront.net/scene.png?temporary=secret',
          params: {
            aspect_ratio: '3:4',
            resolution: '2k',
            quality: 'high',
            model: 'provider-internal',
          },
        }),
        stderr: '',
        exitCode: 0,
      };
    },
    async fetchImpl(url, options) {
      calls.push({ kind: 'fetch', url: String(url), options });
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            if (name.toLowerCase() === 'content-type') return 'image/png';
            if (name.toLowerCase() === 'content-length') return String(providerOutput.length);
            return null;
          },
        },
        async arrayBuffer() {
          return providerOutput.buffer.slice(
            providerOutput.byteOffset,
            providerOutput.byteOffset + providerOutput.byteLength,
          );
        },
      };
    },
  });
  const adapter = new SceneGeneratorAdapter({ provider });
  const result = await adapter.generateScene({
    ...fixture.base,
    attempt: 2,
    cycle_attempt: 2,
    ...DEFAULT_SCENE_MODEL_ROUTE[1],
  });

  const command = calls.find((call) => call.kind === 'command');
  assert.equal(command.binary, 'higgsfield');
  assert.equal(command.args[command.args.indexOf('--aspect_ratio') + 1], '3:4');
  assert.equal(command.args[command.args.indexOf('--prompt') + 1], fixture.prompt);
  assert.deepEqual(
    command.args.flatMap((item, index) => item === '--image' ? [command.args[index + 1]] : []),
    [fixture.approved.path, ...SCENE_REFERENCE_ROLES.map(
      (role) => fixture.references.find((item) => item.role === role).path,
    )],
  );
  assert.doesNotMatch(command.args[command.args.indexOf('--prompt') + 1], /\/Users\/|\/tmp\//);
  assert.equal(result.metadata.provider_request_id, 'scene-provider-job-1');
  assert.equal(result.metadata.geometry_strategy, 'centre_crop_to_exact_4_5');
  assert.equal(result.metadata.geometry_crop_fraction, 0.0625);
  assert.deepEqual(
    [await sharp(result.image).metadata().then((metadata) => metadata.width),
      await sharp(result.image).metadata().then((metadata) => metadata.height)],
    [1024, 1280],
  );
});

test('an exact-ratio frame at the provider bucket size is rescaled without discarding a pixel', async () => {
  const fixture = await contextFixture();
  // 896×1120 is what gpt-image actually returns for a 4:5 request. Right shape,
  // wrong size — so it rescales and nothing is cropped or invented.
  const providerOutput = await sharp({
    create: { width: 896, height: 1120, channels: 3, background: '#8f7360' },
  }).png().toBuffer();
  const adapter = new SceneGeneratorAdapter({
    provider: {
      async generate() {
        return {
          image: providerOutput,
          mediaType: 'image/png',
          metadata: { provider: 'openrouter', job_id: 'bucket-job-1' },
        };
      },
    },
  });
  const result = await adapter.generateScene({
    ...fixture.base,
    attempt: 2,
    cycle_attempt: 2,
    ...DEFAULT_SCENE_MODEL_ROUTE[1],
    quality: 'high',
  });
  assert.equal(result.metadata.geometry_strategy, 'provider_exact_4_5_rescaled');
  assert.equal(result.metadata.geometry_crop_fraction, undefined);
  const delivered = await sharp(result.image).metadata();
  assert.deepEqual([delivered.width, delivered.height], [1024, 1280]);
});

test('a provider-native 4:5 bucket with sub-one-percent rounding is rescaled without crop', async () => {
  const fixture = await contextFixture();
  const providerOutput = await sharp({
    create: { width: 1856, height: 2304, channels: 3, background: '#8f7360' },
  }).png().toBuffer();
  const adapter = new SceneGeneratorAdapter({
    provider: {
      aspectRatio: '4:5',
      async generate() {
        return { image: providerOutput, mediaType: 'image/png', metadata: { provider: 'higgsfield', job_id: 'rounded-45-job' } };
      },
    },
  });
  const result = await adapter.generateScene({
    ...fixture.base,
    attempt: 2,
    cycle_attempt: 2,
    ...DEFAULT_SCENE_MODEL_ROUTE[1],
  });
  assert.equal(result.metadata.transport_aspect_ratio, '4:5');
  assert.equal(result.metadata.geometry_strategy, 'provider_native_4_5_tolerance_rescaled');
  assert.equal(result.metadata.geometry_crop_fraction, undefined);
  assert.ok(result.metadata.aspect_error_fraction < 0.01);
});

test('a rounded GPT 3:4 response is centre-cropped once into the fixed 4:5 delivery', async () => {
  const fixture = await contextFixture();
  // GPT Image 2 returned 1744×2336 in the real smoke. This is a 3:4 bucket
  // rounded by 0.46%, not a malformed landscape frame. Keep only the central
  // 4:5 region and record the crop; never pad, stretch, or hide the transport.
  const providerOutput = await sharp({
    create: { width: 1744, height: 2336, channels: 3, background: '#8f7360' },
  }).png().toBuffer();
  const adapter = new SceneGeneratorAdapter({
    provider: {
      aspectRatio: '3:4',
      async generate() {
        return { image: providerOutput, mediaType: 'image/png', metadata: { provider: 'openrouter', job_id: 'rounded-34-job' } };
      },
    },
  });
  const result = await adapter.generateScene({
    ...fixture.base,
    attempt: 1,
    cycle_attempt: 1,
    ...DEFAULT_SCENE_MODEL_ROUTE[0],
  });
  assert.equal(result.metadata.transport_aspect_ratio, '3:4');
  assert.equal(result.metadata.geometry_strategy, 'centre_crop_to_exact_4_5');
  assert.ok(result.metadata.geometry_crop_fraction > 0);
  assert.ok(result.metadata.transport_aspect_error_fraction < 0.01);
  const delivered = await sharp(result.image).metadata();
  assert.deepEqual([delivered.width, delivered.height], [1024, 1280]);
});

test('a landscape provider frame fails the attempt instead of faking the delivery size', async () => {
  const fixture = await contextFixture();
  // 1200×900 needs 40% of its width removed to reach 4:5. The old code padded
  // this onto a blurred stretch of itself and shipped it as a valid 1024×1280
  // frame. Nothing downstream could see that a fifth of the delivery was filler,
  // so it now fails where the route can retry.
  const providerOutput = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: '#8f7360' },
  }).png().toBuffer();
  const adapter = new SceneGeneratorAdapter({
    provider: {
      async generate() {
        return {
          image: providerOutput,
          mediaType: 'image/png',
          metadata: { provider: 'openrouter', job_id: 'landscape-job-1' },
        };
      },
    },
  });
  await assert.rejects(
    adapter.generateScene({
      ...fixture.base,
      attempt: 2,
      cycle_attempt: 2,
      ...DEFAULT_SCENE_MODEL_ROUTE[1],
      quality: 'high',
    }),
    /1200×900, outside the native 4:5 tolerance; cropping is forbidden/,
  );
});

test('mixed image and strict JSON roles compile bounded private-safe facts without attaching JSON', async () => {
  const fixture = await contextFixture();
  const palette = {
    schema_version: '1.0.0',
    role: 'palette_anchor',
    facts: {
      colors: ['warm ivory', '#9f765f'],
      contrast: 'medium',
      materials: ['brushed metal'],
      notes: ['Use /Users/private/palette.json for the Zeely secret=top-secret-value'],
    },
  };
  const negative = {
    schema_version: '1.0.0',
    role: 'negative_reference',
    facts: {
      avoid: ['neon cyan', 'copy https://private.example.test/look', 'token=ghp_abcdefghijklmnop'],
      notes: [],
    },
  };
  const mixedReferences = await Promise.all(fixture.references.map(async (reference) => {
    if (reference.role === 'palette_anchor') {
      return {
        ...(await structuredReferenceFile(fixture.root, 'palette.json', palette)),
        role: reference.role,
        reference_id: reference.reference_id,
      };
    }
    if (reference.role === 'negative_reference') {
      return {
        ...(await structuredReferenceFile(fixture.root, 'negative.json', negative)),
        role: reference.role,
        reference_id: reference.reference_id,
      };
    }
    return reference;
  }));
  const providerCalls = [];
  const providerOutput = await sharp({
    create: { width: 900, height: 1200, channels: 3, background: '#9f765f' },
  }).png().toBuffer();
  const generator = new SceneGeneratorAdapter({
    provider: {
      aspectRatio: '3:4',
      async generate(context) {
        providerCalls.push(context);
        return {
          image: providerOutput,
          metadata: { provider: 'higgsfield', job_id: 'mixed-json-job' },
        };
      },
    },
  });
  const generated = await generator.generateScene({
    ...fixture.base,
    references: mixedReferences,
    attempt: 1,
    ...DEFAULT_SCENE_MODEL_ROUTE[0],
  });
  assert.equal(providerCalls[0].references.ordered.length, 4);
  assert.deepEqual(
    providerCalls[0].references.ordered.map((item) => item.role),
    [
      'APPROVED_LOOK_MASTER',
      'SCENE_ENVIRONMENT_ANCHOR',
      'SCENE_LIGHTING_ANCHOR',
      'SCENE_COMPOSITION_ANCHOR',
    ],
  );
  assert.match(providerCalls[0].prompt, /STRICT STRUCTURED SCENE FACTS/);
  assert.match(providerCalls[0].prompt, /SCENE_PALETTE_ANCHOR/);
  assert.match(providerCalls[0].prompt, /SCENE_NEGATIVE_REFERENCE/);
  assert.doesNotMatch(
    providerCalls[0].prompt,
    /\/Users\/|private\.example|top-secret-value|ghp_|palette\.json|\bzeely\b/i,
  );
  assert.equal(generated.metadata.structured_reference_count, 2);
  assert.equal(generated.metadata.attached_reference_count, 4);
  assert.deepEqual(
    generated.metadata.reference_evidence.map((item) => item.role),
    SCENE_REFERENCE_ROLES,
  );
  assert.deepEqual(
    generated.metadata.reference_evidence.map((item) => item.transport),
    ['image', 'image', 'image', 'structured_json', 'structured_json'],
  );
  assert.equal(generated.metadata.reference_role_order, SCENE_REFERENCE_ROLES.join(':'));
  assert.match(generated.metadata.reference_evidence_sha256, /^[a-f0-9]{64}$/);

  const candidate = await imageFile(fixture.root, 'mixed-candidate.png', {
    width: 1024,
    height: 1280,
  });
  const evaluatorCalls = [];
  const evaluator = new SceneEvaluatorAdapter({
    commandRunner: evaluatorRunner(evaluatorPayload(), evaluatorCalls),
  });
  const evaluated = await evaluator.evaluateScene({
    scene_id: 'mixed_json_scene',
    attempt: 1,
    candidate,
    approved_look: fixture.approved,
    references: mixedReferences,
    required_gates: SCENE_EVALUATOR_GATES,
    delivery: { width: 1024, height: 1280 },
  });
  assert.equal(evaluatorCalls[0].args.filter((item) => item === '--image').length, 9);
  assert.match(evaluatorCalls[0].args[1], /STRICT STRUCTURED SCENE FACTS/);
  assert.doesNotMatch(
    evaluatorCalls[0].args[1],
    /\/Users\/|private\.example|top-secret-value|ghp_|palette\.json|\bzeely\b/i,
  );
  assert.deepEqual(evaluated.reference_evidence.map((item) => item.role), SCENE_REFERENCE_ROLES);
});

test('repair generation attaches the approved look then the hash-bound failed candidate while all five scene roles remain strict facts', async () => {
  const fixture = await contextFixture();
  const documents = {
    environment_anchor: {
      schema_version: '1.0.0',
      role: 'environment_anchor',
      facts: {
        description: 'An original pale-stone pedestrian lane with restrained facades.',
        spatial_cues: ['One calm vanishing point', 'Clean negative space around the subject'],
        materials: ['pale limestone', 'matte stone paving'],
        originality_rules: ['Invent new geometry', 'No landmark, signage or copied source layout'],
      },
    },
    lighting_anchor: {
      schema_version: '1.0.0',
      role: 'lighting_anchor',
      facts: {
        time_or_setup: 'golden hour',
        key: 'low warm side and back light from camera-left',
        fill: 'cool open-sky fill',
        finish: 'restrained polished editorial gloss',
        protected_regions: ['eyes', 'face identity', 'item logos', 'item text'],
      },
    },
    composition_anchor: {
      schema_version: '1.0.0',
      role: 'composition_anchor',
      facts: {
        aspect_ratio: '4:5',
        lens_mm: 50,
        camera_height: 'eye_level',
        subject_height_percent: [74, 78],
        minimum_clear_space_percent: { above_hair: 8, below_footwear: 2 },
        max_vertical_error_deg: 1.5,
        notes: ['Complete headwear and both shoes', 'No wide-angle distortion'],
      },
    },
    palette_anchor: {
      schema_version: '1.0.0',
      role: 'palette_anchor',
      facts: {
        colors: ['honey', 'cream stone', 'olive shadow'],
        contrast: 'medium',
        materials: ['matte stone'],
        notes: ['Preserve natural skin and exact item colors'],
      },
    },
    negative_reference: {
      schema_version: '1.0.0',
      role: 'negative_reference',
      facts: {
        avoid: ['recognizable landmark', 'readable environment text', 'copied source geometry'],
        notes: ['No unauthorized person, wardrobe or prop'],
      },
    },
  };
  const references = await Promise.all(fixture.references.map(async (reference) => ({
    ...(await structuredReferenceFile(
      fixture.root,
      `${reference.role}.json`,
      documents[reference.role],
    )),
    role: reference.role,
    reference_id: reference.reference_id,
  })));
  const repairCandidate = {
    ...(await imageFile(fixture.root, 'failed-scene-candidate.png', {
      width: 1024,
      height: 1280,
      color: '#caa68f',
    })),
    role: 'failed_candidate',
    attempt: 1,
  };
  const repairPrompt = `${fixture.prompt}
ATTACHMENT_2 is the hash-bound failed scene candidate. Edit it without redesigning passed content.`;

  const providerCalls = [];
  const providerOutput = await sharp({
    create: { width: 800, height: 1000, channels: 3, background: '#9f765f' },
  }).png().toBuffer();
  const generator = new SceneGeneratorAdapter({
    provider: {
      aspectRatio: '4:5',
      async generate(context) {
        providerCalls.push(context);
        return {
          image: providerOutput,
          metadata: { provider: 'higgsfield', job_id: 'all-structured-job' },
        };
      },
    },
  });
  const generated = await generator.generateScene({
    ...fixture.base,
    references,
    repair_candidate: repairCandidate,
    prompt: repairPrompt,
    prompt_sha256: sha256(Buffer.from(repairPrompt)),
    attempt: 2,
    cycle_attempt: 2,
    ...DEFAULT_SCENE_MODEL_ROUTE[1],
  });
  assert.deepEqual(
    providerCalls[0].references.ordered.map((item) => item.role),
    ['APPROVED_LOOK_MASTER', 'FAILED_SCENE_CANDIDATE'],
  );
  assert.deepEqual(
    providerCalls[0].references.ordered.map((item) => item.sha256),
    [fixture.approved.sha256, repairCandidate.sha256],
  );
  for (const role of SCENE_REFERENCE_ROLES) {
    assert.match(providerCalls[0].prompt, new RegExp(`SCENE_${role.toUpperCase()}`));
  }
  assert.equal(generated.metadata.structured_reference_count, 5);
  assert.equal(generated.metadata.attached_reference_count, 2);
  assert.equal(generated.metadata.repair_candidate_sha256, repairCandidate.sha256);
  assert.equal(generated.metadata.repair_from_attempt, 1);
  assert.deepEqual(
    generated.metadata.reference_evidence.map((item) => item.transport),
    Array(5).fill('structured_json'),
  );
  await writeFile(repairCandidate.path, Buffer.from('tampered repair candidate'));
  await assert.rejects(
    () => generator.generateScene({
      ...fixture.base,
      references,
      repair_candidate: repairCandidate,
      prompt: repairPrompt,
      prompt_sha256: sha256(Buffer.from(repairPrompt)),
      attempt: 2,
      cycle_attempt: 2,
      ...DEFAULT_SCENE_MODEL_ROUTE[1],
    }),
    /repair_candidate bytes do not match the bound SHA-256/,
  );
  assert.equal(providerCalls.length, 1, 'tampered repair bytes must fail before provider work');

  const candidate = await imageFile(fixture.root, 'all-structured-candidate.png', {
    width: 1024,
    height: 1280,
  });
  const evaluatorCalls = [];
  const evaluator = new SceneEvaluatorAdapter({
    commandRunner: evaluatorRunner(evaluatorPayload(), evaluatorCalls),
  });
  const evaluated = await evaluator.evaluateScene({
    scene_id: 'all_structured_scene',
    attempt: 1,
    candidate,
    approved_look: fixture.approved,
    references,
    required_gates: SCENE_EVALUATOR_GATES,
    delivery: { width: 1024, height: 1280 },
  });
  assert.equal(evaluatorCalls[0].args.filter((item) => item === '--image').length, 6);
  assert.match(evaluatorCalls[0].args[1], /SCENE_ENVIRONMENT_ANCHOR/);
  assert.match(evaluatorCalls[0].args[1], /Invent new geometry/);
  assert.deepEqual(
    evaluated.reference_evidence.map((item) => item.transport),
    Array(5).fill('structured_json'),
  );
});

test('structured scene references fail closed on hash or schema mismatch', async () => {
  const fixture = await contextFixture();
  const invalid = {
    ...(await structuredReferenceFile(fixture.root, 'invalid-palette.json', {
      schema_version: '1.0.0',
      role: 'palette_anchor',
      facts: {
        colors: ['ivory'],
        contrast: 'medium',
        materials: [],
        notes: [],
        unexpected: true,
      },
    })),
    role: 'palette_anchor',
    reference_id: 'ref-4',
  };
  const references = fixture.references.map((item) => item.role === 'palette_anchor' ? invalid : item);
  const adapter = new SceneGeneratorAdapter({
    provider: { aspectRatio: '3:4', generate: async () => { throw new Error('must not run'); } },
  });
  await assert.rejects(
    () => adapter.generateScene({
      ...fixture.base,
      references,
      attempt: 1,
      ...DEFAULT_SCENE_MODEL_ROUTE[0],
    }),
    /strict structured-reference schema/,
  );
  references[3] = { ...references[3], sha256: '0'.repeat(64) };
  await assert.rejects(
    () => adapter.generateScene({
      ...fixture.base,
      references,
      attempt: 1,
      ...DEFAULT_SCENE_MODEL_ROUTE[0],
    }),
    /bytes do not match the bound SHA-256/,
  );
});

function evaluatorPayload() {
  return {
    gates: SCENE_EVALUATOR_GATES.map((id) => ({
      id,
      decision: 'PASS',
      evidence: `${id} visibly verified`,
      defects: [],
    })),
    score: 96,
    summary: 'All six visual gates pass',
    framing_evidence: {
      subject_bbox_xywh_px: [162, 128, 700, 960],
      full_head_visible: true,
      full_footwear_visible: true,
    },
  };
}

function evaluatorRunner(payload, calls) {
  return async (binary, args, options) => {
    calls.push({ binary, args, options });
    const outputIndex = args.indexOf('--output-last-message');
    await writeFile(args[outputIndex + 1], JSON.stringify(payload));
    return { stdout: '', stderr: '', exitCode: 0 };
  };
}

function itemEvaluatorRunner(calls) {
  return async (binary, args, options) => {
    calls.push({ binary, args, options });
    const itemId = /ITEM_ID: ([A-Za-z0-9._-]+)/.exec(args[1])?.[1];
    const revise = itemId === 'set-2';
    const payload = {
      item_id: itemId,
      verdict: revise ? 'REVISE' : 'PASS',
      evidence: revise
        ? 'The generated bag is only category-similar to the approved product.'
        : 'Exact visible product details match the approved reference.',
      matching_features: revise ? ['light grey top-handle silhouette'] : ['all visible locked details'],
      defects: revise
        ? [
          'generic diamond pattern replaced the repeating M-in-octagon monogram',
          'central M/MKM emblem changed',
        ]
        : [],
      confidence: 0.98,
    };
    const outputIndex = args.indexOf('--output-last-message');
    await writeFile(args[outputIndex + 1], JSON.stringify(payload));
    return { stdout: '', stderr: '', exitCode: 0 };
  };
}

test('SceneEvaluatorAdapter attaches candidate, look and all five roles and returns the exact six-gate service contract', async () => {
  const fixture = await contextFixture();
  const candidate = await imageFile(fixture.root, 'candidate.png', {
    width: 1024,
    height: 1280,
    color: '#b98f72',
  });
  const calls = [];
  const adapter = new SceneEvaluatorAdapter({
    commandRunner: evaluatorRunner(evaluatorPayload(), calls),
    evaluatorVersion: 'scene-evaluator-v1.2.3',
  });
  const result = await adapter.evaluateScene({
    scene_id: 'scene_adapter_test',
    attempt: 1,
    candidate,
    approved_look: fixture.approved,
    references: fixture.references,
    required_gates: SCENE_EVALUATOR_GATES,
    delivery: {
      aspect_ratio: '4:5',
      width: 1024,
      height: 1280,
      media_type: 'image/png',
      extension: '.png',
      color_space: 'srgb',
    },
  });
  assert.deepEqual(result.gates.map((gate) => gate.id), SCENE_EVALUATOR_GATES);
  assert.equal(calls[0].args.filter((item) => item === '--image').length, 11);
  assert.ok(calls[0].args.includes('--ephemeral'));
  assert.ok(calls[0].args.includes('read-only'));
  assert.match(calls[0].args[1], /ATTACHMENT_1 \[GENERATED_SCENE_CANDIDATE\]/);
  assert.match(calls[0].args[1], /ATTACHMENT_7 \[SCENE_NEGATIVE_REFERENCE\]/);
  assert.match(calls[0].args[1], /ATTACHMENT_8 \[CANDIDATE_UPPER_ITEM_DETAIL\]/);
  assert.match(calls[0].args[1], /ATTACHMENT_11 \[APPROVED_LOOK_LOWER_ITEM_DETAIL\]/);
  assert.match(calls[0].args[1], /Any substituted emblem, missing monogram, rewritten letter or number/);
  assert.match(calls[0].args[1], /ITEM_DETAIL_NOT_VERIFIABLE/);
  assert.ok(calls[0].args.includes('model_reasoning_effort="high"'));
  assert.doesNotMatch(calls[0].args[1], /candidate\.png|approved-look\.png|\/Users\/|\/tmp\//);
  assert.equal(result.reviewer.type, 'MODEL');
  assert.match(result.reviewer.version, /scene-evaluator-v1\.2\.3/);
  assert.equal(result.reviewer.request_id.length, 64);

  const normalized = normalizeEvaluatorResult(result);
  const framing = validateFramingEvidence(normalized.framing_evidence, {
    width: 1024,
    height: 1280,
    expectedSubjectHeightPercent: [74, 78],
  });
  assert.equal(framing.subject_height_percent, 75);
  assert.equal(framing.clear_space_above_hair_percent, 10);
});

test('SceneEvaluatorAdapter runs independent per-item forensic checks and blocks a category-similar product', async () => {
  const fixture = await contextFixture();
  const itemEvidence = await approvedItemEvidenceFixture(fixture.root);
  const candidate = await imageFile(fixture.root, 'candidate-item-qa.png', {
    width: 1024,
    height: 1280,
    color: '#b98f72',
  });
  const mainCalls = [];
  const itemCalls = [];
  const adapter = new SceneEvaluatorAdapter({
    commandRunner: evaluatorRunner(evaluatorPayload(), mainCalls),
    itemCommandRunner: itemEvaluatorRunner(itemCalls),
  });
  const result = await adapter.evaluateScene({
    scene_id: 'scene_item_fidelity_test',
    attempt: 1,
    candidate,
    approved_look: fixture.approved,
    references: fixture.references,
    item_evidence: itemEvidence,
    required_gates: SCENE_EVALUATOR_GATES,
    delivery: { width: 1024, height: 1280 },
  });
  assert.equal(mainCalls.length, 1);
  assert.equal(itemCalls.length, 2);
  assert.ok(itemCalls.every((call) => call.args.filter((item) => item === '--image').length === 3));
  assert.ok(itemCalls.every((call) => call.args.includes('model_reasoning_effort="high"')));
  const itemGate = result.gates.find((gate) => gate.id === 'ITEM_FIDELITY');
  assert.equal(itemGate.decision, 'FAIL');
  assert.match(itemGate.evidence, /set-2/);
  assert.deepEqual(itemGate.defects, [
    'set-2: generic diamond pattern replaced the repeating M-in-octagon monogram',
    'set-2: central M/MKM emblem changed',
  ]);
  assert.equal(result.item_fidelity_evidence[0].verdict, 'PASS');
  assert.equal(result.item_fidelity_evidence[1].verdict, 'REVISE');
  assert.equal(result.reviewer.request_id.length, 64);
  const normalized = normalizeEvaluatorResult(result);
  assert.equal(normalized.item_fidelity_evidence.length, 2);
  assert.equal(normalized.item_fidelity_evidence[1].item_id, 'set-2');
  assert.equal(normalized.item_fidelity_evidence[1].item_sha256, itemEvidence[1].sha256);
  assert.equal(normalized.item_fidelity_evidence[1].item_category, 'bag');
  assert.match(normalized.item_fidelity_evidence[1].item_facts_sha256, /^[a-f0-9]{64}$/);
  assert.match(normalized.item_fidelity_evidence[1].request_id, /^[a-f0-9]{64}$/);
});

test('SceneEvaluatorAdapter applies shot-scoped editorial item QA while retaining all generation authority', async () => {
  const fixture = await contextFixture();
  const baseItems = await approvedItemEvidenceFixture(fixture.root);
  const footwear = {
    item_id: 'set-3',
    role: 'ITEM_FOOTWEAR',
    category: 'footwear',
    order: 3,
    reference_set_id: 'set-3',
    observed: {
      garment_type: 'ankle boots',
      colors: ['black'],
      material: ['leather'],
      pattern: [],
      logo_text: [],
      construction: ['ankle shaft', 'stacked heel', 'pointed toe'],
    },
    ...(await imageFile(fixture.root, 'approved-set-3.png', { color: '#171717' })),
  };
  const itemEvidence = [...baseItems, footwear];
  const candidate = await imageFile(fixture.root, 'candidate-editorial-item-scope.png', {
    width: 1024,
    height: 1280,
    color: '#b98f72',
  });

  for (const expectation of [
    {
      slot: 'sculptural_three_quarter',
      itemScope: 'EXCLUDE_FOOTWEAR',
      expectedItemIds: ['set-0', 'set-2'],
    },
    {
      slot: 'material_or_accessory_detail',
      itemScope: 'FIRST_ORDERED_ITEM',
      expectedItemIds: ['set-0'],
    },
  ]) {
    const presetPath = path.join(fixture.root, `${expectation.slot}.json`);
    await writeFile(presetPath, JSON.stringify({
      editorial: {
        shot_slot: expectation.slot,
        item_scope: expectation.itemScope,
      },
    }));
    const itemCalls = [];
    const adapter = new SceneEvaluatorAdapter({
      commandRunner: evaluatorRunner(evaluatorPayload(), []),
      itemCommandRunner: itemEvaluatorRunner(itemCalls),
    });
    const result = await adapter.evaluateScene({
      scene_id: `scene_${expectation.slot}`,
      attempt: 1,
      candidate,
      approved_look: fixture.approved,
      references: fixture.references,
      item_evidence: itemEvidence,
      preset: { path: presetPath },
      required_gates: SCENE_EVALUATOR_GATES,
      delivery: { width: 1024, height: 1280 },
    });
    assert.deepEqual(
      result.item_fidelity_evidence.map((item) => item.item_id),
      expectation.expectedItemIds,
    );
    assert.equal(itemCalls.length, expectation.expectedItemIds.length);
  }
});

test('forensic item aggregation stays inside the downstream gate receipt bounds', async () => {
  const fixture = await contextFixture();
  const itemEvidence = await approvedItemEvidenceFixture(fixture.root);
  const candidate = await imageFile(fixture.root, 'candidate-bounded-item-qa.png', {
    width: 1024,
    height: 1280,
    color: '#b98f72',
  });
  const adapter = new SceneEvaluatorAdapter({
    commandRunner: evaluatorRunner(evaluatorPayload(), []),
    itemCommandRunner: async (binary, args) => {
      const itemId = /ITEM_ID: ([A-Za-z0-9._-]+)/.exec(args[1])?.[1];
      const outputIndex = args.indexOf('--output-last-message');
      await writeFile(args[outputIndex + 1], JSON.stringify({
        item_id: itemId,
        verdict: 'REVISE',
        evidence: 'The exact approved product does not match.',
        matching_features: [],
        defects: Array.from(
          { length: 20 },
          (_, index) => `visible mismatch ${index + 1}: ${'x'.repeat(180)}`,
        ),
        confidence: 0.99,
      }));
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  });
  const result = await adapter.evaluateScene({
    scene_id: 'scene_bounded_item_fidelity_test',
    attempt: 1,
    candidate,
    approved_look: fixture.approved,
    references: fixture.references,
    item_evidence: itemEvidence,
    required_gates: SCENE_EVALUATOR_GATES,
    delivery: { width: 1024, height: 1280 },
  });
  const itemGate = result.gates.find((gate) => gate.id === 'ITEM_FIDELITY');
  assert.equal(itemGate.decision, 'FAIL');
  assert.equal(itemGate.defects.length, 20);
  assert.ok(itemGate.defects.every((defect) => defect.length <= 200));
  assert.ok(itemGate.evidence.length <= 1_000);
  assert.ok(result.summary.length <= 1_000);
  assert.doesNotThrow(() => normalizeEvaluatorResult(result));
});

test('a rejected item carries its own forensic reason into the one sentence the gate shows', async () => {
  const fixture = await contextFixture();
  const itemEvidence = await approvedItemEvidenceFixture(fixture.root);
  const candidate = await imageFile(fixture.root, 'candidate-item-reason.png', {
    width: 1024,
    height: 1280,
    color: '#b98f72',
  });
  const adapter = new SceneEvaluatorAdapter({
    commandRunner: evaluatorRunner(evaluatorPayload(), []),
    itemCommandRunner: async (binary, args) => {
      const itemId = /ITEM_ID: ([A-Za-z0-9._-]+)/.exec(args[1])?.[1];
      const outputIndex = args.indexOf('--output-last-message');
      // The recorded hood-lining refusal, verbatim in shape: prose, one defect and a
      // confidence, all of which already persisted while the gate said nothing.
      await writeFile(args[outputIndex + 1], JSON.stringify(itemId === 'set-0'
        ? {
          item_id: itemId,
          verdict: 'REVISE',
          evidence: 'The hood lining is rendered with a printed pattern where the approved item has a plain dark-green interior.',
          matching_features: ['braided red and navy drawcord', 'GUCCI FIRENZE 1921 chest text'],
          defects: ['patterned hood lining replaced the plain dark-green interior'],
          confidence: 0.88,
        }
        : {
          item_id: itemId,
          verdict: 'PASS',
          evidence: 'Exact visible product details match the approved reference.',
          matching_features: ['all visible locked details'],
          defects: [],
          confidence: 0.97,
        }));
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  });
  const result = await adapter.evaluateScene({
    scene_id: 'scene_item_reason_test',
    attempt: 1,
    candidate,
    approved_look: fixture.approved,
    references: fixture.references,
    item_evidence: itemEvidence,
    required_gates: SCENE_EVALUATOR_GATES,
    delivery: { width: 1024, height: 1280 },
  });
  const itemGate = result.gates.find((gate) => gate.id === 'ITEM_FIDELITY');
  assert.equal(itemGate.decision, 'FAIL');
  assert.match(itemGate.evidence, /set-0 \(confidence 0\.88\)/);
  assert.match(itemGate.evidence, /plain dark-green interior/);
  // The passing item is not implicated by a gate that only one sub-check refused.
  assert.doesNotMatch(itemGate.evidence, /set-2/);
  // Nothing the outbound sanitiser exists to strip rides along in the prose.
  assert.doesNotMatch(itemGate.evidence, new RegExp(itemEvidence[0].sha256));
  assert.doesNotMatch(itemGate.evidence, /approved-set-0\.png|\/Users\/|\/tmp\//);
  assert.ok(itemGate.evidence.length <= 1_000);
  assert.doesNotThrow(() => normalizeEvaluatorResult(result));
});

// The evaluator behaviour the incident produced: it demands a subject-to-ground
// contact shadow unless the prompt states that the crop excludes the contact point.
function contactShadowRunner(calls) {
  return async (binary, args, options) => {
    calls.push({ binary, args, options });
    const payload = evaluatorPayload();
    if (!/do not report CONTACT_SHADOW_NOT_VISIBLE/.test(args[1])) {
      const light = payload.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
      light.decision = 'FAIL';
      light.evidence = 'The frame cuts off the subject before the feet/contact points, so a subject-to-ground contact shadow cannot be visibly verified.';
      light.defects = ['CONTACT_SHADOW_NOT_VERIFIABLE'];
      payload.score = 58;
    }
    const outputIndex = args.indexOf('--output-last-message');
    await writeFile(args[outputIndex + 1], JSON.stringify(payload));
    return { stdout: '', stderr: '', exitCode: 0 };
  };
}

test('an editorial crop above the feet owes no contact shadow, and every frame standing on the ground still does', async () => {
  const fixture = await contextFixture();
  const candidate = await imageFile(fixture.root, 'candidate-contact-shadow.png', {
    width: 1024,
    height: 1280,
    color: '#b98f72',
  });

  for (const expectation of [
    {
      label: 'editorial-three-quarter',
      preset: {
        camera: {
          framing: 'three_quarter',
          required_visibility: { full_head: true, full_footwear: false },
        },
        editorial: {
          shot_slot: 'sculptural_three_quarter',
          identity_visibility: 'full_face',
          item_scope: 'EXCLUDE_FOOTWEAR',
        },
      },
      decision: 'PASS',
    },
    // Scoping is on the declared crop, not on the word "editorial": an editorial slot
    // that keeps the feet keeps the demand with them.
    {
      label: 'editorial-with-feet-in-crop',
      preset: {
        camera: {
          framing: 'full_body',
          required_visibility: { full_head: true, full_footwear: true },
        },
        editorial: {
          shot_slot: 'wide_campaign_coda',
          identity_visibility: 'full_face',
          item_scope: 'ALL',
        },
      },
      decision: 'FAIL',
    },
    { label: 'standard', preset: null, decision: 'FAIL' },
  ]) {
    let preset = null;
    if (expectation.preset) {
      const presetPath = path.join(fixture.root, `${expectation.label}.json`);
      await writeFile(presetPath, JSON.stringify(expectation.preset));
      preset = { path: presetPath };
    }
    const calls = [];
    const adapter = new SceneEvaluatorAdapter({
      commandRunner: contactShadowRunner(calls),
    });
    const result = await adapter.evaluateScene({
      scene_id: `scene_contact_shadow_${expectation.label.replaceAll('-', '_')}`,
      attempt: 1,
      candidate,
      approved_look: fixture.approved,
      references: fixture.references,
      ...(preset ? { preset } : {}),
      required_gates: SCENE_EVALUATOR_GATES,
      delivery: { width: 1024, height: 1280 },
    });
    const light = result.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
    assert.equal(light.decision, expectation.decision, expectation.label);
    assert.match(calls[0].args[1], /LIGHT_AND_CONTACT_SHADOW judges|LIGHT_AND_CONTACT_SHADOW requires/);
    if (expectation.decision === 'PASS') {
      assert.deepEqual(light.defects, [], expectation.label);
      assert.match(calls[0].args[1], /not required to reach the subject-to-ground contact points/);
      // The gate keeps every judgment the crop can actually support.
      assert.match(calls[0].args[1], /still requires its own contact shadow/);
    } else {
      assert.deepEqual(light.defects, ['CONTACT_SHADOW_NOT_VERIFIABLE'], expectation.label);
      assert.match(calls[0].args[1], /requires a visible subject-to-ground contact shadow/);
      assert.doesNotMatch(calls[0].args[1], /do not report CONTACT_SHADOW_NOT_VISIBLE/);
    }
  }
});

test('framing assessment records visual lock defects without misclassifying valid measurements as evaluator failure', () => {
  const assessment = assessFramingEvidence({
    subject_bbox_xywh_px: [100, 64, 824, 1088],
    full_head_visible: true,
    full_footwear_visible: true,
  }, {
    width: 1024,
    height: 1280,
    expectedSubjectHeightPercent: [74, 78],
  });

  assert.equal(assessment.evidence.subject_height_percent, 85);
  assert.equal(assessment.evidence.clear_space_above_hair_percent, 5);
  assert.equal(assessment.evidence.clear_space_below_footwear_percent, 10);
  assert.deepEqual(assessment.defects, [
    'SUBJECT_HEIGHT_OUTSIDE_PRESET_RANGE',
    'INSUFFICIENT_CLEAR_SPACE_ABOVE_HAIR',
  ]);
  assert.throws(() => validateFramingEvidence({
    subject_bbox_xywh_px: [100, 64, 824, 1088],
    full_head_visible: true,
    full_footwear_visible: true,
  }, {
    width: 1024,
    height: 1280,
    expectedSubjectHeightPercent: [74, 78],
  }), /outside the preset framing range/);
});

test('editorial headroom is advisory once the head is observed whole, and stays blocking for standard scenes', () => {
  // The real frame this came from: an editorial identity hero measured 5% of
  // headroom against a 6% minimum, thirteen pixels of a 1280-tall canvas, while
  // its own gate text read "Full head is visible and the figure is anatomically
  // coherent" and the other eight gates passed. Headroom only ever stood in for
  // "the head is not cropped", and full_head_visible answers that directly.
  const measured = {
    subject_bbox_xywh_px: [100, 64, 824, 1104],
    full_head_visible: true,
    full_footwear_visible: true,
  };
  const editorial = {
    width: 1024,
    height: 1280,
    expectedSubjectHeightPercent: [50, 94],
    minimumAboveHairPercent: 6,
    requireFullFootwear: false,
    aboveIsAdvisoryWhenHeadVisible: true,
  };

  const waived = assessFramingEvidence(measured, editorial);
  assert.equal(waived.evidence.clear_space_above_hair_percent, 5);
  assert.equal(waived.evidence.minimum_clear_space_above_hair_percent, 6);
  assert.deepEqual(waived.defects, []);

  // A cropped head is still a defect: the waiver rests on the observation, so it
  // disappears the moment the observation does.
  const cropped = assessFramingEvidence(
    { ...measured, full_head_visible: false },
    editorial,
  );
  assert.deepEqual(cropped.defects, [
    'INSUFFICIENT_CLEAR_SPACE_ABOVE_HAIR',
    'FULL_HEAD_NOT_VISIBLE',
  ]);

  // Standard scenes promise the same avatar composed the same way in every
  // environment, so there headroom is the product and keeps failing.
  const standard = assessFramingEvidence(measured, {
    width: 1024,
    height: 1280,
    expectedSubjectHeightPercent: [74, 78],
    minimumAboveHairPercent: 6,
  });
  assert.ok(standard.defects.includes('INSUFFICIENT_CLEAR_SPACE_ABOVE_HAIR'));
});

test('SceneEvaluatorAdapter marks CLI and malformed-output failures as QA infrastructure failures', async () => {
  const fixture = await contextFixture();
  const candidate = await imageFile(fixture.root, 'candidate-infra.png', { width: 1024, height: 1280 });
  const context = {
    scene_id: 'scene_adapter_infra',
    attempt: 1,
    candidate,
    approved_look: fixture.approved,
    references: fixture.references,
    required_gates: SCENE_EVALUATOR_GATES,
    delivery: { width: 1024, height: 1280 },
  };
  const executionFailure = new SceneEvaluatorAdapter({
    commandRunner: async () => { throw new Error('evaluator unavailable'); },
  });
  await assert.rejects(
    () => executionFailure.evaluateScene(context),
    (error) => error instanceof SceneEvaluationInfrastructureError
      && error.infrastructure === true
      && error.code === 'SCENE_EVALUATOR_EXECUTION_FAILED',
  );

  const malformed = evaluatorPayload();
  malformed.gates = malformed.gates.slice(0, 5);
  const contractFailure = new SceneEvaluatorAdapter({
    commandRunner: evaluatorRunner(malformed, []),
  });
  await assert.rejects(
    () => contractFailure.evaluateScene(context),
    (error) => error instanceof SceneEvaluationInfrastructureError
      && error.code === 'SCENE_EVALUATOR_CONTRACT_FAILED',
  );
});

async function editorialContextFixture() {
  const fixture = await contextFixture();
  // Every editorial role travels as structured JSON, so the whole attachment budget
  // beyond the contractual evidence belongs to the anchors. This is the production
  // shape, not a convenience.
  const references = await Promise.all(fixture.references.map(async (reference) => ({
    ...(await structuredReferenceFile(fixture.root, `${reference.role}.json`, {
      schema_version: '1.0.0',
      role: reference.role,
      facts: STRUCTURED_FACTS[reference.role],
    })),
    role: reference.role,
    reference_id: reference.reference_id,
  })));
  const blocking = {
    ...(await imageFile(fixture.root, 'blocking.png', { color: '#c9c4ba' })),
    order: 1,
    role: 'blocking_topdown',
    reference_id: 'blocking.v1.clean_identity_hero',
  };
  const heroContinuity = {
    ...(await imageFile(fixture.root, 'hero-frame.png', { width: 1024, height: 1280, color: '#6d5a4b' })),
    order: 2,
    role: 'hero_continuity_anchor',
    reference_id: 'hero.scene_fixture',
  };
  return {
    ...fixture,
    blocking,
    heroContinuity,
    base: { ...fixture.base, references },
  };
}

const STRUCTURED_FACTS = Object.freeze({
  environment_anchor: {
    description: 'An invented interior of pale plaster planes.',
    spatial_cues: ['Compose an original three quarter fashion frame.'],
    materials: ['plaster'],
    originality_rules: ['Invent new geometry; do not reconstruct a preview.'],
  },
  lighting_anchor: {
    time_or_setup: 'late morning',
    key: 'one broad window left of camera',
    fill: 'bounced from the opposite wall',
    finish: 'polished_editorial_gloss_without_skin_smoothing_or_hdr',
    protected_regions: ['face'],
  },
  composition_anchor: {
    aspect_ratio: '4:5',
    lens_mm: 50,
    camera_height: 'eye_level',
    subject_height_percent: [50, 94],
    minimum_clear_space_percent: { above_hair: 6, below_footwear: 0 },
    max_vertical_error_deg: 1.5,
    notes: ['Eye level with disciplined verticals.'],
  },
  palette_anchor: {
    colors: ['warm ivory', 'graphite'],
    contrast: 'medium',
    materials: ['plaster'],
    notes: ['Apply this palette only to environment, light and grade.'],
  },
  negative_reference: {
    avoid: ['neon cyan'],
    notes: ['Scene inputs never have authority for identity, body, hair or outfit.'],
  },
});

function recordingProvider(providerOutput, calls, extra = {}) {
  return {
    aspectRatio: '3:4',
    async generate(context) {
      calls.push(context);
      return {
        image: providerOutput,
        metadata: { provider: 'openrouter', job_id: 'shot-anchor-job' },
      };
    },
    ...extra,
  };
}

async function providerFrame() {
  return sharp({
    create: { width: 900, height: 1200, channels: 3, background: '#a48a74' },
  }).png().toBuffer();
}

test('SceneGeneratorAdapter attaches both shot anchors after the contractual evidence and scopes their authority', async () => {
  const fixture = await editorialContextFixture();
  const items = await approvedItemEvidenceFixture(fixture.root);
  const calls = [];
  const adapter = new SceneGeneratorAdapter({
    provider: recordingProvider(await providerFrame(), calls, { maxOrderedReferences: 10 }),
  });
  const generated = await adapter.generateScene({
    ...fixture.base,
    attempt: 1,
    ...DEFAULT_SCENE_MODEL_ROUTE[0],
    item_evidence: items,
    shot_anchors: [fixture.blocking, fixture.heroContinuity],
  });
  assert.deepEqual(
    calls[0].references.ordered.map((item) => item.role),
    [
      'APPROVED_LOOK_MASTER',
      'ITEM_TOP',
      'ITEM_BAG',
      'SHOT_BLOCKING_TOPDOWN',
      'SHOT_HERO_CONTINUITY_ANCHOR',
    ],
  );
  assert.deepEqual(
    calls[0].references.ordered.map((item) => item.order),
    [1, 2, 3, 4, 5],
  );
  assert.equal(calls[0].references.ordered[3].sha256, fixture.blocking.sha256);
  assert.equal(calls[0].references.ordered[4].sha256, fixture.heroContinuity.sha256);
  // The transport, not this adapter, is the gatekeeper for scope and source, and it
  // reserves the 'scene' scope for the repair candidate alone. Validating the real
  // bindings here is what catches an anchor the provider would refuse outright.
  assert.equal(
    orderedReferenceDescriptors('scene', calls[0].references, { maxOrdered: 10 }).length,
    5,
  );
  assert.equal(generated.metadata.shot_anchor_role_order, 'blocking_topdown:hero_continuity_anchor');
  assert.equal(generated.metadata.attached_reference_count, 5);
  assert.equal(generated.metadata.dropped_attachment_roles, undefined);
  assert.equal(generated.metadata.dropped_attachment_count, undefined);
  // The prompt must number the anchors exactly as the transport ordered them, or the
  // model is told to read authority off an attachment that holds something else.
  assert.match(calls[0].prompt, /ATTACHMENT_4 \[BLOCKING_TOPDOWN\]/);
  assert.match(calls[0].prompt, /ATTACHMENT_5 \[HERO_CONTINUITY_ANCHOR\]/);
  assert.match(calls[0].prompt, /authority only for place, environment geometry, light direction and quality, and colour grade/);
  assert.match(calls[0].prompt, /Do not reproduce it/);
  assert.match(
    calls[0].prompt,
    /The approved look master alone controls identity, body, hair, outfit, product details, logos and garment text\. No anchor above has any authority over them\./,
  );
  assert.match(calls[0].prompt, /Reproduce the geometry it specifies and none of its appearance/);
});

test('SceneGeneratorAdapter drops the hero anchor before the blocking diagram and records the loss', async () => {
  const fixture = await editorialContextFixture();
  const items = await Promise.all([
    ...(await approvedItemEvidenceFixture(fixture.root)),
    ...['shoes', 'headwear', 'outerwear'].map(async (category, index) => ({
      order: index + 3,
      role: `ITEM_${category.toUpperCase()}`,
      category,
      item_id: `set-${category}`,
      reference_set_id: `set-${category}`,
      observed: { garment_type: category, colors: ['black'] },
      ...(await imageFile(fixture.root, `approved-${category}.png`, { color: '#1d1d1f' })),
    })),
  ]);
  const repair = {
    ...(await imageFile(fixture.root, 'failed-candidate.png', { width: 1024, height: 1280 })),
    role: 'failed_candidate',
    attempt: 1,
  };
  const calls = [];
  // The default eight: one look master, one failed candidate and five cutouts are all
  // contractual, so exactly one discretionary slot is left for two anchors.
  const adapter = new SceneGeneratorAdapter({ provider: recordingProvider(await providerFrame(), calls) });
  const generated = await adapter.generateScene({
    ...fixture.base,
    attempt: 2,
    cycle_attempt: 1,
    ...DEFAULT_SCENE_MODEL_ROUTE[0],
    item_evidence: items,
    repair_candidate: repair,
    shot_anchors: [fixture.blocking, fixture.heroContinuity],
  });
  assert.deepEqual(
    calls[0].references.ordered.map((item) => item.role),
    [
      'APPROVED_LOOK_MASTER',
      'FAILED_SCENE_CANDIDATE',
      'ITEM_TOP',
      'ITEM_BAG',
      'ITEM_SHOES',
      'ITEM_HEADWEAR',
      'ITEM_OUTERWEAR',
      'SHOT_BLOCKING_TOPDOWN',
    ],
  );
  assert.equal(generated.metadata.shot_anchor_role_order, 'blocking_topdown');
  assert.equal(generated.metadata.dropped_attachment_roles, 'SHOT_HERO_CONTINUITY_ANCHOR');
  assert.equal(generated.metadata.dropped_attachment_count, 1);
  // A dropped attachment must lose its prompt line too: an instruction that points at
  // ATTACHMENT_9 of an eight-attachment request is worse than saying nothing.
  assert.doesNotMatch(calls[0].prompt, /HERO_CONTINUITY_ANCHOR/);
  assert.match(calls[0].prompt, /ATTACHMENT_8 \[BLOCKING_TOPDOWN\]/);
});

test('SceneGeneratorAdapter reserves a distinct attachment number for a mechanical framing guide', async () => {
  const fixture = await contextFixture();
  const items = await approvedItemEvidenceFixture(fixture.root);
  const repair = {
    ...(await imageFile(fixture.root, 'failed-candidate-with-guide.png', { width: 1024, height: 1280 })),
    role: 'failed_candidate',
    attempt: 1,
  };
  const guide = {
    ...(await imageFile(fixture.root, 'mechanical-framing-guide.png', { width: 1024, height: 1280 })),
    role: 'mechanical_framing_guide',
    source_attempt: 1,
    target_subject_height_percent: 76,
    target_clear_space_above_hair_percent: 9,
  };
  const calls = [];
  const adapter = new SceneGeneratorAdapter({ provider: recordingProvider(await providerFrame(), calls, { aspectRatio: '4:5' }) });
  await adapter.generateScene({
    ...fixture.base,
    attempt: 2,
    cycle_attempt: 2,
    ...DEFAULT_SCENE_MODEL_ROUTE[1],
    item_evidence: items,
    repair_candidate: repair,
    composition_guide: guide,
  });
  assert.deepEqual(
    calls[0].references.ordered.slice(0, 5).map((item) => item.role),
    ['APPROVED_LOOK_MASTER', 'FAILED_SCENE_CANDIDATE', 'MECHANICAL_FRAMING_GUIDE', 'ITEM_TOP', 'ITEM_BAG'],
  );
  assert.match(calls[0].prompt, /ATTACHMENT_3 is an opaque neutral mechanical layout derivative/);
  assert.match(calls[0].prompt, /ATTACHMENT_4 \[APPROVED_ITEM_SET-0\]/);
  assert.match(calls[0].prompt, /ATTACHMENT_5 \[APPROVED_ITEM_SET-2\]/);
});

test('SceneGeneratorAdapter spends the budget on anchors before image scene roles', async () => {
  const fixture = await contextFixture();
  const items = await approvedItemEvidenceFixture(fixture.root);
  const blocking = {
    ...(await imageFile(fixture.root, 'blocking-mixed.png', { color: '#cfcac0' })),
    order: 1,
    role: 'blocking_topdown',
    reference_id: 'blocking.v1.wide_campaign_coda',
  };
  const heroContinuity = {
    ...(await imageFile(fixture.root, 'hero-mixed.png', { width: 1024, height: 1280 })),
    order: 2,
    role: 'hero_continuity_anchor',
    reference_id: 'hero.scene_mixed',
  };
  const calls = [];
  const adapter = new SceneGeneratorAdapter({ provider: recordingProvider(await providerFrame(), calls) });
  const generated = await adapter.generateScene({
    ...fixture.base,
    attempt: 1,
    ...DEFAULT_SCENE_MODEL_ROUTE[0],
    item_evidence: items,
    shot_anchors: [blocking, heroContinuity],
  });
  assert.deepEqual(
    calls[0].references.ordered.map((item) => item.role),
    [
      'APPROVED_LOOK_MASTER',
      'ITEM_TOP',
      'ITEM_BAG',
      'SHOT_BLOCKING_TOPDOWN',
      'SHOT_HERO_CONTINUITY_ANCHOR',
      'SCENE_ENVIRONMENT_ANCHOR',
      'SCENE_LIGHTING_ANCHOR',
      'SCENE_COMPOSITION_ANCHOR',
    ],
  );
  assert.equal(
    generated.metadata.dropped_attachment_roles,
    'SCENE_PALETTE_ANCHOR:SCENE_NEGATIVE_REFERENCE',
  );
  assert.equal(generated.metadata.dropped_attachment_count, 2);
});

test('SceneGeneratorAdapter refuses to trade contractual item evidence for the attachment budget', async () => {
  const fixture = await editorialContextFixture();
  const items = await Promise.all(
    ['top', 'bag', 'shoes', 'headwear', 'outerwear', 'jewelry', 'dress'].map(async (category, index) => ({
      order: index + 1,
      role: `ITEM_${category.toUpperCase()}`,
      category,
      item_id: `set-${category}`,
      reference_set_id: `set-${category}`,
      observed: { garment_type: category, colors: ['black'] },
      ...(await imageFile(fixture.root, `full-${category}.png`, { color: '#2b2b2e' })),
    })),
  );
  const repair = {
    ...(await imageFile(fixture.root, 'full-failed.png', { width: 1024, height: 1280 })),
    role: 'failed_candidate',
    attempt: 1,
  };
  const adapter = new SceneGeneratorAdapter({
    provider: { aspectRatio: '3:4', generate: async () => { throw new Error('must not run'); } },
  });
  await assert.rejects(() => adapter.generateScene({
    ...fixture.base,
    attempt: 2,
    cycle_attempt: 1,
    ...DEFAULT_SCENE_MODEL_ROUTE[0],
    item_evidence: items,
    repair_candidate: repair,
    shot_anchors: [fixture.blocking],
  }), /Approved item evidence exceeds the provider attachment limit/);
});

test('SceneGeneratorAdapter refuses shot anchors that are out of canonical order or not PNG', async () => {
  const fixture = await editorialContextFixture();
  const adapter = new SceneGeneratorAdapter({
    provider: { aspectRatio: '3:4', generate: async () => { throw new Error('must not run'); } },
  });
  await assert.rejects(() => adapter.generateScene({
    ...fixture.base,
    attempt: 1,
    ...DEFAULT_SCENE_MODEL_ROUTE[0],
    shot_anchors: [{ ...fixture.heroContinuity, order: 1 }, { ...fixture.blocking, order: 2 }],
  }), /Scene shot anchor 1 is not in canonical anchor order/);
  const jpegAnchor = path.join(fixture.root, 'blocking.jpg');
  const jpegBytes = await sharp({
    create: { width: 320, height: 400, channels: 3, background: '#c9c4ba' },
  }).jpeg().toBuffer();
  await writeFile(jpegAnchor, jpegBytes);
  await assert.rejects(() => adapter.generateScene({
    ...fixture.base,
    attempt: 1,
    ...DEFAULT_SCENE_MODEL_ROUTE[0],
    shot_anchors: [{
      ...fixture.blocking,
      path: jpegAnchor,
      sha256: sha256(jpegBytes),
      media_type: 'image/jpeg',
    }],
  }), /Scene shot anchor blocking_topdown must be one PNG/);
});

// The six editorial slots all declare full footwear=false, so anything keyed on that
// declaration reaches all six. These are the three shapes the prompt has to hold apart.
const EDITORIAL_FOOTWEAR_OPTIONAL_PRESET = Object.freeze({
  camera: {
    framing: 'three_quarter',
    required_visibility: { full_head: true, full_footwear: false },
  },
  editorial: {
    shot_slot: 'sculptural_three_quarter',
    identity_visibility: 'full_face',
    item_scope: 'EXCLUDE_FOOTWEAR',
  },
});

test('an editorial crop is told the contact-shadow rule as a condition, not handed the relief', () => {
  const editorial = evaluatorPrompt(
    { width: 1024, height: 1280 },
    [],
    EDITORIAL_FOOTWEAR_OPTIONAL_PRESET,
    [],
  );

  // The requirement itself has to survive into the editorial prompt. Before this, the
  // editorial branch carried only the excuse, so every editorial frame read the gate as
  // optional whatever it could see.
  assert.match(editorial, /a visible contact shadow consistent with the key light is required/);
  assert.match(editorial, /a missing, floating or wrongly directed one is FAIL/);
  // Which case the frame is in is the frame's answer, and the model's own reported
  // boolean is what commits it to one.
  assert.match(editorial, /Reporting full_footwear_visible true is that observation/);
  assert.match(editorial, /takes full_footwear_visible false plus one of these two exact phrases/);
  assert.match(editorial, /Unstated, ground contact is required/);
  // Two named reasons, so "the crop ends above the feet" cannot absorb an interference
  // frame's foreground layer or anything else that hides a contact point.
  assert.ok(editorial.includes(CONTACT_SHADOW_WAIVERS.crop));
  assert.ok(editorial.includes(CONTACT_SHADOW_WAIVERS.occlusion));
  // The crop claim is audited against the model's own subject box, so the prompt says so
  // rather than inviting a claim the payload refutes on arrival.
  assert.match(editorial, /The crop phrase is checked against the subject box you report/);
  assert.match(editorial, /was not cut off by it/);
  // The occlusion claim is not measurable that way and must not be described as if it is.
  assert.doesNotMatch(editorial, /occluded[^.]*checked against the subject box/i);

  const standard = evaluatorPrompt({ width: 1024, height: 1280 }, [], null, []);
  assert.match(standard, /requires a visible subject-to-ground contact shadow/);
  // No waiver exists on the standard path, so its vocabulary is not offered there.
  assert.ok(!standard.includes(CONTACT_SHADOW_WAIVERS.crop));
  assert.ok(!standard.includes(CONTACT_SHADOW_WAIVERS.occlusion));
  assert.doesNotMatch(standard, /do not report CONTACT_SHADOW_NOT_VISIBLE/);
});

const WAIVER_CANVAS = Object.freeze({ width: 1024, height: 1280 });
const WAIVER_SUBJECT_TOP = 128;
// A subject box running into the bottom edge. The frame did cut the subject off, so a
// GROUND CONTACT OUTSIDE CROP claim is one its own geometry supports.
const SUBJECT_CUT_BY_BOTTOM_EDGE = 1280;
// A subject standing whole inside the canvas with 192px of frame beneath it. No edge
// removed anything, whatever the payload reports about the footwear.
const SUBJECT_ABOVE_BOTTOM_EDGE = 1088;

function waivedPayload({ phrase, footwearVisible, bboxBottom, decision = 'PASS' }) {
  // Stated, never defaulted: the subject box decides the crop half of the audit now, so a
  // fixture that let it fall back would be choosing the outcome by accident.
  if (!Number.isInteger(bboxBottom)) {
    throw new Error('a contact-shadow waiver fixture must state its own subject box');
  }
  const payload = evaluatorPayload();
  const light = payload.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
  light.decision = decision;
  const reason = phrase === CONTACT_SHADOW_WAIVERS.occlusion
    ? 'a foreground glass pane stands between the camera and the feet'
    : 'the subject is cut at the lower frame edge';
  light.evidence = phrase === null
    ? 'Key light is hard and high-left; the cast shadow under both shoes matches its direction.'
    : `Key light is hard and high-left. ${phrase}: ${reason}.`;
  if (decision === 'FAIL') light.defects = ['LIGHT_DIRECTION_MISMATCH'];
  payload.framing_evidence = {
    subject_bbox_xywh_px: [162, WAIVER_SUBJECT_TOP, 700, bboxBottom - WAIVER_SUBJECT_TOP],
    full_head_visible: true,
    full_footwear_visible: footwearVisible,
  };
  return payload;
}

// Each refusal has to be legible in the gate a reader is shown, and has to be the one that
// applies: a frame told its footwear contradicted the waiver when really the frame geometry
// did is a receipt that sends a retry after the wrong thing.
const REFUSAL_TEXT = Object.freeze({
  [CONTACT_SHADOW_WAIVER_REFUSED]: {
    evidence: /reporting full footwear visible/,
    summary: /cannot be waived on a frame that observed its own contact point/,
  },
  [CONTACT_SHADOW_CROP_WAIVER_REFUSED]: {
    evidence: /subject box ends above the bottom edge/,
    summary: /a crop that ends below its subject cannot have cropped away the contact point/,
  },
});

test('the contact-shadow waiver vocabulary is a fixed wire contract', () => {
  // The phrases are what the model is asked to type and the defects are what receipts
  // carry. Renaming either in one place only would disarm the audit while every
  // behavioural test below still passed, so the literals are pinned here once.
  assert.deepEqual({ ...CONTACT_SHADOW_WAIVERS }, {
    crop: 'GROUND CONTACT OUTSIDE CROP',
    occlusion: 'GROUND CONTACT OCCLUDED BY FOREGROUND',
  });
  assert.equal(CONTACT_SHADOW_WAIVER_REFUSED, 'CONTACT_SHADOW_WAIVED_WITH_FOOTWEAR_IN_FRAME');
  assert.equal(
    CONTACT_SHADOW_CROP_WAIVER_REFUSED,
    'CONTACT_SHADOW_CROP_WAIVED_ON_UNCROPPED_SUBJECT',
  );
});

test('the contact-shadow waiver is refused by the frame that contradicts it', async () => {
  const fixture = await contextFixture();
  const candidate = await imageFile(fixture.root, 'candidate-waiver-audit.png', {
    width: 1024,
    height: 1280,
    color: '#b98f72',
  });
  const presetPath = path.join(fixture.root, 'editorial-footwear-optional.json');
  await writeFile(presetPath, JSON.stringify(EDITORIAL_FOOTWEAR_OPTIONAL_PRESET));

  for (const expectation of [
    // The crop genuinely ends above the feet: the relief this whole branch exists for. It
    // has to state a cut subject to get it, which is the point.
    {
      label: 'editorial-crop-waiver-no-footwear-cut-subject',
      editorial: true,
      phrase: CONTACT_SHADOW_WAIVERS.crop,
      footwearVisible: false,
      bboxBottom: SUBJECT_CUT_BY_BOTTOM_EDGE,
      decision: 'PASS',
    },
    // The hole the reported-boolean check left open: same claim, same reported footwear,
    // and a subject standing whole inside the canvas. Nothing cropped the contact point.
    {
      label: 'editorial-crop-waiver-no-footwear-uncut-subject',
      editorial: true,
      phrase: CONTACT_SHADOW_WAIVERS.crop,
      footwearVisible: false,
      bboxBottom: SUBJECT_ABOVE_BOTTOM_EDGE,
      decision: 'FAIL',
      defect: CONTACT_SHADOW_CROP_WAIVER_REFUSED,
    },
    // The delivered frames. Same slot, same declaration, opposite observation.
    {
      label: 'editorial-crop-waiver-with-footwear',
      editorial: true,
      phrase: CONTACT_SHADOW_WAIVERS.crop,
      footwearVisible: true,
      bboxBottom: SUBJECT_ABOVE_BOTTOM_EDGE,
      decision: 'FAIL',
      defect: CONTACT_SHADOW_WAIVER_REFUSED,
    },
    // The second waiver is not a way around the first one being audited.
    {
      label: 'editorial-occlusion-waiver-with-footwear',
      editorial: true,
      phrase: CONTACT_SHADOW_WAIVERS.occlusion,
      footwearVisible: true,
      bboxBottom: SUBJECT_ABOVE_BOTTOM_EDGE,
      decision: 'FAIL',
      defect: CONTACT_SHADOW_WAIVER_REFUSED,
    },
    // interference_frame, working as designed: a foreground layer hides the feet while the
    // subject sits well inside the canvas. Geometry cannot see the pane, so it must not be
    // allowed to call this claim false — the crop rule stops at the crop claim.
    {
      label: 'editorial-occlusion-waiver-no-footwear-uncut-subject',
      editorial: true,
      phrase: CONTACT_SHADOW_WAIVERS.occlusion,
      footwearVisible: false,
      bboxBottom: SUBJECT_ABOVE_BOTTOM_EDGE,
      decision: 'PASS',
    },
    {
      label: 'editorial-occlusion-waiver-no-footwear-cut-subject',
      editorial: true,
      phrase: CONTACT_SHADOW_WAIVERS.occlusion,
      footwearVisible: false,
      bboxBottom: SUBJECT_CUT_BY_BOTTOM_EDGE,
      decision: 'PASS',
    },
    // A frame that shows its footwear and judged the shadow is exactly what the gate
    // wants. Claiming nothing costs it nothing.
    {
      label: 'editorial-no-waiver-with-footwear',
      editorial: true,
      phrase: null,
      footwearVisible: true,
      bboxBottom: SUBJECT_ABOVE_BOTTOM_EDGE,
      decision: 'PASS',
    },
    // Nor does a frame that reports nothing about a waiver it never claimed, whatever its
    // geometry: the audit only ever answers a claim.
    {
      label: 'editorial-no-waiver-no-footwear-cut-subject',
      editorial: true,
      phrase: null,
      footwearVisible: false,
      bboxBottom: SUBJECT_CUT_BY_BOTTOM_EDGE,
      decision: 'PASS',
    },
    // The standard path is never offered the waiver, so a payload carrying one there is
    // unsupported for the same reasons and by the same rules — both of them.
    {
      label: 'standard-crop-waiver-with-footwear',
      editorial: false,
      phrase: CONTACT_SHADOW_WAIVERS.crop,
      footwearVisible: true,
      bboxBottom: SUBJECT_ABOVE_BOTTOM_EDGE,
      decision: 'FAIL',
      defect: CONTACT_SHADOW_WAIVER_REFUSED,
    },
    {
      label: 'standard-crop-waiver-no-footwear-uncut-subject',
      editorial: false,
      phrase: CONTACT_SHADOW_WAIVERS.crop,
      footwearVisible: false,
      bboxBottom: SUBJECT_ABOVE_BOTTOM_EDGE,
      decision: 'FAIL',
      defect: CONTACT_SHADOW_CROP_WAIVER_REFUSED,
    },
    {
      label: 'standard-no-waiver-with-footwear',
      editorial: false,
      phrase: null,
      footwearVisible: true,
      bboxBottom: SUBJECT_ABOVE_BOTTOM_EDGE,
      decision: 'PASS',
    },
  ]) {
    // The evaluator always hands back a PASS here: an unsupported PASS is the whole
    // thing being audited, and expectation.decision is what must come out the far side.
    const adapter = new SceneEvaluatorAdapter({
      commandRunner: evaluatorRunner(waivedPayload({
        phrase: expectation.phrase,
        footwearVisible: expectation.footwearVisible,
        bboxBottom: expectation.bboxBottom,
      }), []),
    });
    const result = await adapter.evaluateScene({
      scene_id: `scene_waiver_${expectation.label.replaceAll('-', '_')}`,
      attempt: 1,
      candidate,
      approved_look: fixture.approved,
      references: fixture.references,
      ...(expectation.editorial ? { preset: { path: presetPath } } : {}),
      required_gates: SCENE_EVALUATOR_GATES,
      delivery: { ...WAIVER_CANVAS },
    });
    const light = result.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
    assert.equal(light.decision, expectation.decision, expectation.label);
    if (expectation.decision === 'FAIL') {
      assert.deepEqual(light.defects, [expectation.defect], expectation.label);
      // The reason is recoverable from the gate a reader is shown, not only from the code,
      // and it is the reason that actually applied.
      const applied = REFUSAL_TEXT[expectation.defect];
      assert.match(light.evidence, applied.evidence, expectation.label);
      assert.match(result.summary, applied.summary, expectation.label);
      for (const [defect, text] of Object.entries(REFUSAL_TEXT)) {
        if (defect === expectation.defect) continue;
        assert.doesNotMatch(light.evidence, text.evidence, expectation.label);
        assert.doesNotMatch(result.summary, text.summary, expectation.label);
      }
      assert.equal(result.score, 60, expectation.label);
    } else {
      assert.deepEqual(light.defects, [], expectation.label);
      assert.equal(result.score, 96, expectation.label);
      assert.doesNotMatch(light.evidence, /owes its shadow/, expectation.label);
      for (const text of Object.values(REFUSAL_TEXT)) {
        assert.doesNotMatch(result.summary, text.summary, expectation.label);
      }
    }
    // One gate is reconciled; the other five carry whatever the evaluator said.
    for (const gate of result.gates.filter((item) => item.id !== 'LIGHT_AND_CONTACT_SHADOW')) {
      assert.equal(gate.decision, 'PASS', `${expectation.label}: ${gate.id}`);
      assert.deepEqual(gate.defects, [], `${expectation.label}: ${gate.id}`);
    }
    assert.doesNotThrow(() => normalizeEvaluatorResult(result), expectation.label);
  }
});

test('a frame naming a foreground element keeps its waiver even beside a crop claim', () => {
  // Both phrases at once. The occlusion claim is not refutable from geometry, so the
  // waiver survives on it — the crop rule polices the crop claim, not the gate. What it
  // does not survive is the payload reporting the footwear in shot, which answers both.
  const both = `${CONTACT_SHADOW_WAIVERS.crop} and also ${CONTACT_SHADOW_WAIVERS.occlusion}`;
  const kept = reconcileContactShadowWaiver(waivedPayload({
    phrase: both,
    footwearVisible: false,
    bboxBottom: SUBJECT_ABOVE_BOTTOM_EDGE,
  }), WAIVER_CANVAS);
  const keptLight = kept.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
  assert.equal(keptLight.decision, 'PASS');
  assert.deepEqual(keptLight.defects, []);
  assert.equal(kept.score, 96);

  const refused = reconcileContactShadowWaiver(waivedPayload({
    phrase: both,
    footwearVisible: true,
    bboxBottom: SUBJECT_ABOVE_BOTTOM_EDGE,
  }), WAIVER_CANVAS);
  const refusedLight = refused.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
  assert.equal(refusedLight.decision, 'FAIL');
  assert.deepEqual(refusedLight.defects, [CONTACT_SHADOW_WAIVER_REFUSED]);
});

test('the bottom edge itself is the boundary the crop claim is measured against', () => {
  // One pixel decides it, so both sides of the boundary are pinned. A box ending at the
  // last row of the canvas was cut; one ending a pixel short of it was not.
  for (const [bboxBottom, decision] of [[1280, 'PASS'], [1279, 'FAIL']]) {
    const payload = reconcileContactShadowWaiver(waivedPayload({
      phrase: CONTACT_SHADOW_WAIVERS.crop,
      footwearVisible: false,
      bboxBottom,
    }), WAIVER_CANVAS);
    const light = payload.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
    assert.equal(light.decision, decision, `bbox bottom ${bboxBottom}`);
  }
});

test('a gate already failing for its own reason is not overwritten by the waiver audit', () => {
  for (const bboxBottom of [SUBJECT_ABOVE_BOTTOM_EDGE, SUBJECT_CUT_BY_BOTTOM_EDGE]) {
    for (const footwearVisible of [true, false]) {
      const payload = reconcileContactShadowWaiver(waivedPayload({
        phrase: CONTACT_SHADOW_WAIVERS.crop,
        footwearVisible,
        bboxBottom,
        decision: 'FAIL',
      }), WAIVER_CANVAS);
      const light = payload.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
      assert.equal(light.decision, 'FAIL');
      assert.deepEqual(light.defects, ['LIGHT_DIRECTION_MISMATCH']);
      assert.equal(payload.score, 96);
    }
  }
});

test('an evaluator payload cannot be validated without the canvas its waiver audit measures', () => {
  // A crop waiver on an uncut subject: refused with the canvas, and the point is that
  // there is no way to reach this function without one and quietly get the PASS instead.
  const claim = () => waivedPayload({
    phrase: CONTACT_SHADOW_WAIVERS.crop,
    footwearVisible: false,
    bboxBottom: SUBJECT_ABOVE_BOTTOM_EDGE,
  });
  for (const delivery of [undefined, null, {}, { width: 1024 }, { width: 1024, height: 0 }, { width: 1024, height: 1280.5 }]) {
    assert.throws(
      () => validateEvaluatorPayload(claim(), delivery),
      /requires the delivery canvas height/,
      JSON.stringify(delivery ?? null),
    );
  }
  const audited = validateEvaluatorPayload(claim(), WAIVER_CANVAS);
  const light = audited.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
  assert.equal(light.decision, 'FAIL');
  assert.deepEqual(light.defects, [CONTACT_SHADOW_CROP_WAIVER_REFUSED]);
});

// Splits the top-level arguments of every call to a named function in a source file, so
// the assertion below is about the calls themselves rather than about two paths someone
// remembered to update.
function callArguments(source, callee) {
  const calls = [];
  for (let index = source.indexOf(`${callee}(`); index !== -1; index = source.indexOf(`${callee}(`, index + 1)) {
    // The declaration is not a call site.
    if (/function\s+$/.test(source.slice(0, index))) continue;
    const start = index + callee.length + 1;
    const args = [];
    let depth = 0;
    let scan = start;
    let argumentStart = start;
    for (; scan < source.length; scan += 1) {
      const character = source[scan];
      if ('([{'.includes(character)) depth += 1;
      else if (')]}'.includes(character)) {
        if (depth === 0) break;
        depth -= 1;
      } else if (character === ',' && depth === 0) {
        args.push(source.slice(argumentStart, scan).trim());
        argumentStart = scan + 1;
      }
    }
    assert.notEqual(scan, source.length, `unterminated ${callee} call`);
    args.push(source.slice(argumentStart, scan).trim());
    calls.push(args);
  }
  return calls;
}

test('every evaluator parse point in src/web hands the waiver audit its own canvas', async () => {
  // The audit is only as wide as its call sites. The codex adapter and OpenRouter are the
  // two today; a third that parsed a payload without a canvas would throw at runtime, and
  // this is what says so before it ships rather than on the first live scene.
  //
  // The argument has to be the delivery the caller was handed, not a canvas it wrote out.
  // A literal 1024x1280 satisfies every other test in this file — it is the only delivery
  // that exists today — while quietly measuring the next one against a stale frame, which
  // is the same shape of silence as the waiver this audit was written to catch.
  const webRoot = path.resolve(import.meta.dirname, '..', '..', 'src', 'web');
  const callers = [];
  for (const name of (await readdir(webRoot)).filter((file) => file.endsWith('.js'))) {
    const source = await readFile(path.join(webRoot, name), 'utf8');
    const calls = callArguments(source, 'validateEvaluatorPayload');
    if (calls.length === 0) continue;
    callers.push(name);
    for (const args of calls) {
      assert.equal(args.length, 2, `${name} must pass the delivery canvas to validateEvaluatorPayload`);
      assert.match(
        args[1],
        /(^|\.)delivery$/,
        `${name} must pass the delivery it was given, not a canvas of its own`,
      );
    }
  }
  assert.deepEqual(callers.sort(), ['openrouter-scene-evaluator.js', 'scene-adapters.js']);
});

test('the waiver audit measures against the canvas it is handed, not the canonical one', () => {
  // One payload, one claim, two canvases. The subject box ends at 1088: on a 1280-tall
  // delivery the frame carries on below it and GROUND CONTACT OUTSIDE CROP is false, while
  // on an 1088-tall one the box runs into the bottom edge and the claim holds. Nothing
  // downstream may answer this from a remembered canvas.
  const claim = () => waivedPayload({
    phrase: CONTACT_SHADOW_WAIVERS.crop,
    footwearVisible: false,
    bboxBottom: SUBJECT_ABOVE_BOTTOM_EDGE,
  });
  for (const [height, decision] of [[1280, 'FAIL'], [SUBJECT_ABOVE_BOTTOM_EDGE, 'PASS']]) {
    const audited = validateEvaluatorPayload(claim(), { width: 1024, height });
    const light = audited.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
    assert.equal(light.decision, decision, `canvas height ${height}`);
  }
});

// Every editorial asset result the beta runtime holds, with the framing evidence it
// actually recorded. All nine passed LIGHT_AND_CONTACT_SHADOW under the declaration-keyed
// relaxation; five of them observed their own footwear while doing it. The bbox bottoms are
// no longer corroboration carried alongside — they are read, and they are what makes the
// misreport replay below possible: every frame reporting footwear visible ends its subject
// above the 1280px canvas edge, and every frame reporting it hidden runs into that edge.
const DELIVERED_EDITORIAL_FRAMES = Object.freeze([
  { slot: 'organic_contrast.clean_identity_hero', bboxBottom: 1242, footwearVisible: true },
  { slot: 'organic_contrast.interference_frame', bboxBottom: 1280, footwearVisible: false },
  { slot: 'organic_contrast.interference_frame.2', bboxBottom: 1280, footwearVisible: false },
  { slot: 'urban_monochrome.clean_identity_hero', bboxBottom: 1280, footwearVisible: false },
  { slot: 'organic_contrast.sculptural_three_quarter', bboxBottom: 1248, footwearVisible: true },
  { slot: 'organic_contrast.material_or_accessory_detail', bboxBottom: 1280, footwearVisible: false },
  { slot: 'organic_contrast.wide_campaign_coda', bboxBottom: 1040, footwearVisible: true },
  { slot: 'urban_monochrome.clean_identity_hero.2', bboxBottom: 1208, footwearVisible: true },
  { slot: 'organic_contrast.environmental_hero', bboxBottom: 1160, footwearVisible: true },
]);

test('replaying the delivered editorial frames judges the five that saw their contact point', () => {
  const judged = [];
  for (const frame of DELIVERED_EDITORIAL_FRAMES) {
    const payload = reconcileContactShadowWaiver(waivedPayload({
      phrase: CONTACT_SHADOW_WAIVERS.crop,
      footwearVisible: frame.footwearVisible,
      bboxBottom: frame.bboxBottom,
    }), WAIVER_CANVAS);
    const light = payload.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
    assert.equal(
      light.decision,
      frame.footwearVisible ? 'FAIL' : 'PASS',
      frame.slot,
    );
    // As delivered the two signals agree, so the payload's own report is what refuses it.
    assert.equal(frame.bboxBottom < WAIVER_CANVAS.height, frame.footwearVisible, frame.slot);
    if (light.decision === 'FAIL') {
      assert.deepEqual(light.defects, [CONTACT_SHADOW_WAIVER_REFUSED], frame.slot);
      judged.push(frame.slot);
    }
  }
  assert.equal(judged.length, 5);
  assert.ok(judged.includes('organic_contrast.wide_campaign_coda'));
  assert.ok(judged.includes('organic_contrast.environmental_hero'));
});

test('the delivered frames are judged on their geometry when the footwear boolean is wrong', () => {
  // The gap 1e67027 left behind: the audit keyed on a boolean the waiver's beneficiary
  // writes, so every frame above escapes it by reporting false. The geometry does not move
  // when the report does, and the five full-length figures are still full-length figures.
  const judged = [];
  for (const frame of DELIVERED_EDITORIAL_FRAMES) {
    const payload = reconcileContactShadowWaiver(waivedPayload({
      phrase: CONTACT_SHADOW_WAIVERS.crop,
      footwearVisible: false,
      bboxBottom: frame.bboxBottom,
    }), WAIVER_CANVAS);
    const light = payload.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
    const cut = frame.bboxBottom >= WAIVER_CANVAS.height;
    assert.equal(light.decision, cut ? 'PASS' : 'FAIL', frame.slot);
    if (light.decision === 'FAIL') {
      assert.deepEqual(light.defects, [CONTACT_SHADOW_CROP_WAIVER_REFUSED], frame.slot);
      judged.push(frame.slot);
    }
  }
  assert.deepEqual(judged.sort(), [
    'organic_contrast.clean_identity_hero',
    'organic_contrast.environmental_hero',
    'organic_contrast.sculptural_three_quarter',
    'organic_contrast.wide_campaign_coda',
    'urban_monochrome.clean_identity_hero.2',
  ]);
  // And the four that genuinely ran into the bottom edge keep the relief, both
  // interference_frame results among them.
  assert.equal(DELIVERED_EDITORIAL_FRAMES.length - judged.length, 4);
});

test('the same misreport under a foreground claim keeps every delivered frame waived', () => {
  // The occlusion claim is what interference_frame legitimately makes, and geometry has no
  // standing over it. If this test ever fails, the crop rule has leaked onto the other
  // waiver and the slot is being failed for its own design.
  for (const frame of DELIVERED_EDITORIAL_FRAMES) {
    const payload = reconcileContactShadowWaiver(waivedPayload({
      phrase: CONTACT_SHADOW_WAIVERS.occlusion,
      footwearVisible: false,
      bboxBottom: frame.bboxBottom,
    }), WAIVER_CANVAS);
    const light = payload.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
    assert.equal(light.decision, 'PASS', frame.slot);
    assert.deepEqual(light.defects, [], frame.slot);
    assert.equal(payload.score, 96, frame.slot);
  }
});

// The defect string scene_e92594aa was failed on, twice, and its evidence verbatim. Neither
// the name nor the rule behind it exists anywhere in this repository: full footwear=false
// means footwear is not required, and has never meant it is forbidden.
const INVENTED_FRAMING_DEFECT = 'FULL_FOOTWEAR_VISIBLE_WHEN_REQUIRED_FALSE';
const INVENTED_FRAMING_EVIDENCE = 'Both ballet flats are completely visible even though this shot requires full_footwear_visible=false.';

// The three names assessFramingEvidence authors from the numeric lock. The evaluator is told
// they are not its to enforce, so they are not in the vocabulary it may send.
const MEASURED_LOCK_DEFECTS = Object.freeze([
  'SUBJECT_HEIGHT_OUTSIDE_PRESET_RANGE',
  'INSUFFICIENT_CLEAR_SPACE_ABOVE_HAIR',
  'INSUFFICIENT_CLEAR_SPACE_BELOW_FOOTWEAR',
]);

function framingFailurePayload(defects, evidence = INVENTED_FRAMING_EVIDENCE) {
  const payload = evaluatorPayload();
  const framing = payload.gates.find((gate) => gate.id === 'FRAMING_AND_ANATOMY');
  framing.decision = 'FAIL';
  framing.defects = defects;
  framing.evidence = evidence;
  payload.score = 55;
  payload.summary = 'The frame is a full-body composition rather than the required three-quarter crop';
  return payload;
}

async function framingVocabularyFixture(name) {
  const fixture = await contextFixture();
  const candidate = await imageFile(fixture.root, `${name}.png`, {
    width: 1024,
    height: 1280,
    color: '#b98f72',
  });
  const presetPath = path.join(fixture.root, `${name}-preset.json`);
  await writeFile(presetPath, JSON.stringify(EDITORIAL_FOOTWEAR_OPTIONAL_PRESET));
  return {
    scene(payload) {
      return new SceneEvaluatorAdapter({ commandRunner: evaluatorRunner(payload, []) })
        .evaluateScene({
          scene_id: `scene_${name.replaceAll('-', '_')}`,
          attempt: 1,
          candidate,
          approved_look: fixture.approved,
          references: fixture.references,
          preset: { path: presetPath },
          required_gates: SCENE_EVALUATOR_GATES,
          delivery: { ...WAIVER_CANVAS },
        });
    },
  };
}

test('a framing defect the contract does not define fails the evaluation, not the frame', async () => {
  const fixture = await framingVocabularyFixture('candidate-invented-framing-defect');

  await assert.rejects(
    () => fixture.scene(framingFailurePayload([INVENTED_FRAMING_DEFECT])),
    (error) => {
      assert.ok(error instanceof SceneEvaluationInfrastructureError);
      // The candidate survives an infrastructure result and is re-asked; a FRAMING_AND_ANATOMY
      // FAIL spends a generation. That difference is the whole point, so it is asserted rather
      // than left to the error class's reputation.
      assert.equal(error.code, 'SCENE_EVALUATOR_CONTRACT_FAILED');
      assert.equal(error.infrastructure, true);
      assert.equal(error.retryable, true);
      // Named, so the reason is greppable and countable rather than one more contract failure.
      assert.ok(error.message.includes(FRAMING_DEFECT_OUTSIDE_VOCABULARY), error.message);
      // And carrying the claim: an invented name is not a reason to lose what was said under
      // it. This message is what scene-service checkpoints as the attempt's error.
      assert.ok(error.message.includes(INVENTED_FRAMING_DEFECT), error.message);
      assert.match(error.message, /both ballet flats are completely visible/i);
      assert.match(error.message, /FRAMING_AND_ANATOMY FAIL/);
      return true;
    },
  );

  // The same payload, one word different: an anatomy fault the code has a name for still
  // fails the frame. Refusing the vocabulary is not refusing the gate.
  const judged = await fixture.scene(framingFailurePayload(['MALFORMED_HAND_OR_FINGERS']));
  const framing = judged.gates.find((gate) => gate.id === 'FRAMING_AND_ANATOMY');
  assert.equal(framing.decision, 'FAIL');
  assert.deepEqual(framing.defects, ['MALFORMED_HAND_OR_FINGERS']);
  assert.equal(judged.score, 55);
});

test('every framing name the evaluator may send is refused or accepted by the same closed list', async () => {
  const fixture = await framingVocabularyFixture('candidate-framing-vocabulary');

  // Each listed name survives on its own, so the list is the contract and not a subset of it
  // that happens to be exercised.
  for (const defect of EVALUATOR_FRAMING_DEFECTS) {
    const judged = await fixture.scene(framingFailurePayload([defect]));
    const framing = judged.gates.find((gate) => gate.id === 'FRAMING_AND_ANATOMY');
    assert.deepEqual(framing.defects, [defect], defect);
  }

  // A numeric-lock verdict is refused for the same reason an invented name is: the evaluator
  // cannot measure it, so a payload carrying one is a lock enforced by eye. These arrive
  // wearing names the code does recognise, which is exactly why the list is what is checked
  // rather than whether the string looks familiar.
  for (const measured of MEASURED_LOCK_DEFECTS) {
    await assert.rejects(
      () => fixture.scene(framingFailurePayload([measured])),
      (error) => {
        assert.equal(error.code, 'SCENE_EVALUATOR_CONTRACT_FAILED');
        assert.ok(error.message.includes(measured), error.message);
        return true;
      },
      measured,
    );
  }

  // Mixed: one listed name does not launder the invented one beside it.
  await assert.rejects(
    () => fixture.scene(framingFailurePayload(['MALFORMED_HAND_OR_FINGERS', INVENTED_FRAMING_DEFECT])),
    (error) => {
      assert.ok(error.message.includes(INVENTED_FRAMING_DEFECT), error.message);
      assert.ok(!error.message.includes('MALFORMED_HAND_OR_FINGERS'), error.message);
      return true;
    },
  );
});

test('the framing vocabulary is enumerated in the instruction, on both paths', () => {
  const editorial = evaluatorPrompt(
    { width: 1024, height: 1280 },
    [],
    EDITORIAL_FOOTWEAR_OPTIONAL_PRESET,
    [],
  );
  const standard = evaluatorPrompt({ width: 1024, height: 1280 }, [], null, []);

  for (const [label, prompt] of [['editorial', editorial], ['standard', standard]]) {
    // Being told what not to say is what the prompt already did before the third invented
    // name arrived. Being told what the words are is the new part.
    assert.match(prompt, /Name FRAMING_AND_ANATOMY defects only from this closed list/, label);
    for (const defect of EVALUATOR_FRAMING_DEFECTS) {
      assert.ok(prompt.includes(defect), `${label}: ${defect}`);
    }
    // The consequence, because a list with no stated cost reads as a preference.
    assert.match(prompt, /A name outside the list is a contract violation/, label);
    // A real fault with no exact entry has somewhere to go, so the list is not a reason to
    // stay silent about one.
    assert.match(prompt, /use the closest listed name and describe exactly what is wrong/, label);
    // The three claims that were actually invented, each said to have no name.
    assert.match(prompt, /no name in it for showing more of the body than the nominal crop/, label);
    assert.match(prompt, /footwear being visible while full footwear=false/, label);
    assert.match(prompt, /the subject-height and clear-space numbers/, label);
    // And the locks are not offered as words it may use.
    for (const measured of MEASURED_LOCK_DEFECTS) {
      assert.ok(!prompt.includes(measured), `${label}: ${measured}`);
    }
  }
});

test('the framing vocabulary is split on what the lock owner actually authors', () => {
  // One evidence that violates every lock at once, so what follows is the set the lock owner
  // emits rather than the set someone remembered it emitting.
  const { defects } = assessFramingEvidence({
    subject_bbox_xywh_px: [100, 0, 700, 1280],
    full_head_visible: false,
    full_footwear_visible: false,
  }, { width: 1024, height: 1280, expectedSubjectHeightPercent: [74, 78] });
  assert.deepEqual(
    [...defects].sort(),
    [...MEASURED_LOCK_DEFECTS, ...FRAMING_VISIBILITY_DEFECTS].sort(),
  );

  // Both halves of the split are asserted against that set, so neither list can drift alone:
  // the evaluator may send the two booleans it observes and none of the three it would have
  // to measure.
  assert.deepEqual(
    defects.filter((defect) => EVALUATOR_FRAMING_DEFECTS.includes(defect)).sort(),
    [...FRAMING_VISIBILITY_DEFECTS].sort(),
  );
  assert.deepEqual(
    defects.filter((defect) => !EVALUATOR_FRAMING_DEFECTS.includes(defect)).sort(),
    [...MEASURED_LOCK_DEFECTS].sort(),
  );
  // And no anatomy name belongs to the lock owner: that half of the gate is the model's.
  for (const anatomy of FRAMING_ANATOMY_DEFECTS) {
    assert.ok(!defects.includes(anatomy), anatomy);
  }
});

test('a listed name arrives spelled the one way the receipts spell it', () => {
  // A verdict a reader cannot grep for is the same defeat as the invented name was.
  const payload = assertFramingDefectVocabulary(
    framingFailurePayload([' malformed_hand_or_fingers ', 'Full_Footwear_Not_Visible']),
  );
  const framing = payload.gates.find((gate) => gate.id === 'FRAMING_AND_ANATOMY');
  assert.deepEqual(framing.defects, ['MALFORMED_HAND_OR_FINGERS', 'FULL_FOOTWEAR_NOT_VISIBLE']);
});

// Every one of these declines to judge ground contact without typing either agreed phrase,
// which is all the phrase-keyed audit ever looked for. The first is the wording measured by
// the reviewer: full_footwear_visible true, LIGHT_AND_CONTACT_SHADOW PASS, and a clean pass
// out the far side.
const PARAPHRASED_DECLINES = Object.freeze([
  'the crop ends above the feet so ground contact is not observable',
  'The frame stops at mid-calf, so the subject-to-ground contact cannot be verified in this crop.',
  'Ground contact falls outside the frame and was therefore not assessed.',
  'No contact shadow is discernible because the feet sit beyond the bottom of the shot.',
  'Key light is hard and high-left. The contact points are not in shot, so no ground shadow was judged.',
]);

// A verdict, in the ordinary words one comes in. These have to keep passing, or the audit has
// stopped being an audit and started being a tax on every editorial frame.
const DELIVERED_VERDICTS = Object.freeze([
  'Key light is hard and high-left; the cast shadow under both shoes matches its direction.',
  'The contact shadow beneath the soles falls back and right, consistent with the key, and shows no floating gap.',
  'LIGHT_AND_CONTACT_SHADOW visibly verified: a soft contact shadow sits under each foot.',
]);

function contactShadowPayload({ evidence, footwearVisible, bboxBottom }) {
  const payload = evaluatorPayload();
  const light = payload.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
  light.evidence = evidence;
  payload.framing_evidence = {
    subject_bbox_xywh_px: [162, WAIVER_SUBJECT_TOP, 700, bboxBottom - WAIVER_SUBJECT_TOP],
    full_head_visible: true,
    full_footwear_visible: footwearVisible,
  };
  return payload;
}

test('a waiver in the model\'s own words is refused, because the observation is what opens the question', () => {
  // The measured escape: the reconciliation was reached only through one of two literals, so
  // a frame that phrased the same excuse itself never reached it at all.
  for (const evidence of PARAPHRASED_DECLINES) {
    assert.ok(
      !evidence.includes(CONTACT_SHADOW_WAIVERS.crop)
      && !evidence.includes(CONTACT_SHADOW_WAIVERS.occlusion),
      evidence,
    );
    const payload = reconcileContactShadowWaiver(contactShadowPayload({
      evidence,
      footwearVisible: true,
      bboxBottom: SUBJECT_ABOVE_BOTTOM_EDGE,
    }), WAIVER_CANVAS);
    const light = payload.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
    assert.equal(light.decision, 'FAIL', evidence);
    assert.deepEqual(light.defects, [CONTACT_SHADOW_WAIVER_REFUSED], evidence);
    assert.match(light.evidence, /reporting full footwear visible/, evidence);
    assert.equal(payload.score, 60, evidence);

    // Same words, and this time only the geometry says the contact point is in frame. The
    // report the waiver's beneficiary writes is not what carries either refusal.
    const measured = reconcileContactShadowWaiver(contactShadowPayload({
      evidence,
      footwearVisible: false,
      bboxBottom: SUBJECT_ABOVE_BOTTOM_EDGE,
    }), WAIVER_CANVAS);
    const measuredLight = measured.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
    assert.equal(measuredLight.decision, 'FAIL', evidence);
    assert.deepEqual(measuredLight.defects, [CONTACT_SHADOW_CROP_WAIVER_REFUSED], evidence);
    assert.match(measuredLight.evidence, /subject box ends above the bottom edge/, evidence);
  }
});

test('a frame the crop genuinely ended above keeps its relief, in whatever words', () => {
  // The relief this branch exists for, and the case that must not be broken by widening the
  // refusal: the subject box runs into the bottom edge, so no verdict is owed and the wording
  // of the excuse is beside the point.
  for (const evidence of PARAPHRASED_DECLINES) {
    const payload = reconcileContactShadowWaiver(contactShadowPayload({
      evidence,
      footwearVisible: false,
      bboxBottom: SUBJECT_CUT_BY_BOTTOM_EDGE,
    }), WAIVER_CANVAS);
    const light = payload.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
    assert.equal(light.decision, 'PASS', evidence);
    assert.deepEqual(light.defects, [], evidence);
    assert.equal(payload.score, 96, evidence);
  }

  // And interference_frame, whose contact point is hidden by a foreground layer with the
  // subject sitting well inside the canvas. Geometry cannot see the pane, so the named claim
  // is what keeps it — a paraphrase of that one is refused instead, which is the safe
  // direction for a claim nothing in the payload can check.
  const occluded = reconcileContactShadowWaiver(contactShadowPayload({
    evidence: `Key light is soft from behind. ${CONTACT_SHADOW_WAIVERS.occlusion}: a foreground glass pane stands in front of the feet.`,
    footwearVisible: false,
    bboxBottom: SUBJECT_ABOVE_BOTTOM_EDGE,
  }), WAIVER_CANVAS);
  const occludedLight = occluded.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
  assert.equal(occludedLight.decision, 'PASS');
  assert.deepEqual(occludedLight.defects, []);
});

test('a gate that did judge the ground contact is left alone, on either observation', () => {
  for (const evidence of DELIVERED_VERDICTS) {
    for (const [footwearVisible, bboxBottom] of [
      [true, SUBJECT_ABOVE_BOTTOM_EDGE],
      [false, SUBJECT_ABOVE_BOTTOM_EDGE],
      [true, SUBJECT_CUT_BY_BOTTOM_EDGE],
    ]) {
      const payload = reconcileContactShadowWaiver(contactShadowPayload({
        evidence,
        footwearVisible,
        bboxBottom,
      }), WAIVER_CANVAS);
      const light = payload.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW');
      const label = `${footwearVisible}/${bboxBottom}: ${evidence}`;
      assert.equal(light.decision, 'PASS', label);
      assert.deepEqual(light.defects, [], label);
      assert.equal(light.evidence, evidence, label);
      assert.equal(payload.score, 96, label);
    }
  }
});

test('a standard scene that judged its contact shadow completes untouched through the adapter', async () => {
  // The regression that would hurt most: the audit runs on every path, so a plain full-body
  // scene with an ordinary contact-shadow verdict has to come out the way it went in.
  const fixture = await contextFixture();
  const candidate = await imageFile(fixture.root, 'candidate-standard-contact-verdict.png', {
    width: 1024,
    height: 1280,
    color: '#b98f72',
  });
  const adapter = new SceneEvaluatorAdapter({
    commandRunner: evaluatorRunner(contactShadowPayload({
      evidence: DELIVERED_VERDICTS[0],
      footwearVisible: true,
      bboxBottom: SUBJECT_ABOVE_BOTTOM_EDGE,
    }), []),
  });
  const result = await adapter.evaluateScene({
    scene_id: 'scene_standard_contact_verdict',
    attempt: 1,
    candidate,
    approved_look: fixture.approved,
    references: fixture.references,
    required_gates: SCENE_EVALUATOR_GATES,
    delivery: { ...WAIVER_CANVAS },
  });
  for (const gate of result.gates) {
    assert.equal(gate.decision, 'PASS', gate.id);
    assert.deepEqual(gate.defects, [], gate.id);
  }
  assert.equal(result.gates.find((gate) => gate.id === 'LIGHT_AND_CONTACT_SHADOW').evidence, DELIVERED_VERDICTS[0]);
  assert.equal(result.score, 96);
  assert.equal(result.summary, 'All six visual gates pass');
  assert.doesNotThrow(() => normalizeEvaluatorResult(result));
});
