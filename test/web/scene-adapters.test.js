import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { HiggsfieldCliProvider } from '../../src/providers/higgsfield-cli-provider.js';
import {
  SceneEvaluationInfrastructureError,
  SceneEvaluatorAdapter,
  SceneGeneratorAdapter,
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
    assert.equal(
      result.metadata.geometry_strategy,
      route.job_set_type === 'gpt_image_2'
        ? 'blurred_canvas_contain_no_subject_crop'
        : 'provider_exact_4_5',
    );
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
    attempt: 1,
    ...DEFAULT_SCENE_MODEL_ROUTE[0],
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
  assert.equal(result.metadata.geometry_strategy, 'blurred_canvas_contain_no_subject_crop');
  assert.deepEqual(
    [await sharp(result.image).metadata().then((metadata) => metadata.width),
      await sharp(result.image).metadata().then((metadata) => metadata.height)],
    [1024, 1280],
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
