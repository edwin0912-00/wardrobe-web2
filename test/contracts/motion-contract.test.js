import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MODEL_LIMITS,
  ROUTE_BY_SCENE_KIND,
  assertMotionJob,
  motionJobDefects,
  receiptDefects,
  routeForSceneKind,
} from '../../src/web/motion-contract.js';

const HASH = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function reference(role, overrides = {}) {
  return {
    role,
    kind: role === 'environment_motion' ? 'video' : 'image',
    sha256: HASH,
    background_free: role !== 'environment_motion',
    ...(role === 'environment_motion' ? { excludes_foreign_footwear: true, seconds: 5 } : {}),
    ...overrides,
  };
}

function job(overrides = {}) {
  return {
    schema_version: '1.0.0',
    job_id: 'motion-0001-test',
    created_at: '2026-07-28T12:00:00.000Z',
    source: {
      look_id: 'look-abcdef12',
      look_image_sha256: HASH,
      scene_kind: 'art_fashion_shoot',
      style_unit_id: 'shoot.zayn_institutional',
    },
    delivery: { aspect_ratio: '9:16', duration_seconds: 15, resolution: '1080p' },
    route: { model_slug: 'bytedance-seedance-pro-2.0', transport: 'mcp', camera_motion: null },
    references: [
      reference('identity'),
      reference('face'),
      reference('footwear_detail'),
      reference('environment_motion'),
    ],
    audio: { source: 'muxed_in_post', track_sha256: OTHER, description: null },
    ...overrides,
  };
}

const codes = (value) => motionJobDefects(value).map((defect) => defect.code);

test('a complete art-fashion job is deliverable', () => {
  assert.deepEqual(codes(job()), []);
  assert.equal(assertMotionJob(job()).job_id, 'motion-0001-test');
});

test('the route is decided by scene kind and cannot be overridden by the caller', () => {
  assert.equal(routeForSceneKind('standard_background'), 'gemini-omni-preview');
  assert.equal(routeForSceneKind('art_fashion_shoot'), 'bytedance-seedance-pro-2.0');
  assert.throws(() => routeForSceneKind('whatever'), /Unknown scene kind/);

  const crossed = job({ source: { ...job().source, scene_kind: 'standard_background', style_unit_id: null } });
  assert.ok(codes(crossed).includes('ROUTE_DOES_NOT_MATCH_SCENE_KIND'));
});

test('each model is held to its own measured ceilings', () => {
  // Omni stops at ten seconds and 720p; asking it for the Seedance envelope is a defect,
  // not something to discover after paying for the generation.
  const omni = job({
    source: { ...job().source, scene_kind: 'standard_background', style_unit_id: null },
    route: { model_slug: 'gemini-omni-preview', transport: 'mcp', camera_motion: null },
  });
  const tooLong = codes({ ...omni, delivery: { ...omni.delivery, duration_seconds: 15, resolution: '1080p' } });
  assert.ok(tooLong.includes('DURATION_ABOVE_MODEL_CEILING'));
  assert.ok(tooLong.includes('RESOLUTION_UNSUPPORTED_BY_MODEL'));

  assert.equal(MODEL_LIMITS['gemini-omni-preview'].maxVideoReferenceSeconds, 3);
  const longReference = codes({
    ...omni,
    delivery: { ...omni.delivery, duration_seconds: 10, resolution: '720p' },
    references: [reference('identity'), reference('footwear_detail'), reference('environment_motion', { seconds: 6 })],
  });
  assert.ok(longReference.includes('VIDEO_REFERENCE_ABOVE_MODEL_CEILING'));
});

test('a shot list is held to the call shape each model requires', () => {
  const shots = [
    { index: 1, seconds: 8, prompt: 'full length at the gate, walking in' },
    { index: 2, seconds: 7, prompt: 'close on the hem as she turns away' },
  ];

  // Seedance takes a shot list — but only alongside a whole-clip prompt. Without one
  // its API refuses the call with `Undefined array key "prompt"`, which names nothing,
  // so the contract names it here instead.
  const bare = job({ route: { ...job().route, shot_list: shots } });
  assert.ok(codes(bare).includes('SHOT_LIST_WITHOUT_WHOLE_CLIP_PROMPT'));

  const paired = job({
    route: { ...job().route, shot_list: shots, prompt: 'one continuous evening crossing of the courtyard' },
  });
  assert.deepEqual(codes(paired), []);

  // The shots must account for the delivery they claim to fill.
  const short = job({ route: { ...paired.route, shot_list: [shots[0]] } });
  assert.ok(codes(short).includes('SHOT_LIST_DOES_NOT_SUM_TO_DURATION'));

  // Omni needs no whole-clip prompt alongside its list. The reference clip is trimmed
  // to three seconds because that is Omni's own ceiling; the default five-second clip
  // is a Seedance figure and the contract caught it.
  const omni = job({
    source: { ...job().source, scene_kind: 'standard_background', style_unit_id: null },
    delivery: { aspect_ratio: '9:16', duration_seconds: 10, resolution: '720p' },
    route: {
      model_slug: 'gemini-omni-preview', transport: 'mcp', camera_motion: null,
      shot_list: [
        { index: 1, seconds: 4, prompt: 'she steps into the frame from the left' },
        { index: 2, seconds: 6, prompt: 'slow push in to a half-length hold' },
      ],
    },
    references: [reference('identity'), reference('footwear_detail'), reference('environment_motion', { seconds: 3 })],
  });
  assert.deepEqual(codes(omni), []);

  // Seven shots is above every ceiling. The schema holds the global maximum of six;
  // the per-model maxShots in MODEL_LIMITS backs any future model with a lower one.
  const seven = Array.from({ length: 7 }, (_, i) => ({ index: i + 1, seconds: 2, prompt: 'a two second beat held here' }));
  assert.ok(codes(job({ route: { ...paired.route, shot_list: seven } })).includes('SCHEMA_INVALID'));
});

test('a person reference that carries its own background is refused', () => {
  const leaky = job({
    references: [
      reference('identity', { background_free: false }),
      reference('footwear_detail'),
      reference('environment_motion'),
    ],
  });
  assert.ok(codes(leaky).includes('PERSON_REFERENCE_CARRIES_BACKGROUND'));
});

test('a reference clip that still contains its own footwear close-ups is refused', () => {
  const uncut = job({
    references: [
      reference('identity'),
      reference('footwear_detail'),
      reference('environment_motion', { excludes_foreign_footwear: false }),
    ],
  });
  assert.ok(codes(uncut).includes('REFERENCE_CLIP_KEEPS_FOREIGN_FOOTWEAR'));
});

test('identity and footwear detail are both mandatory in the pack', () => {
  const noFootwear = job({ references: [reference('identity'), reference('environment_motion')] });
  assert.ok(codes(noFootwear).includes('FOOTWEAR_DETAIL_REFERENCE_MISSING'));

  const noIdentity = job({ references: [reference('footwear_detail'), reference('environment_motion')] });
  assert.ok(codes(noIdentity).includes('IDENTITY_REFERENCE_MISSING'));
});

test('an art fashion job must name the shoot whose world it lives in', () => {
  assert.ok(codes(job({ source: { ...job().source, style_unit_id: null } })).includes('STYLE_UNIT_REQUIRED'));
});

test('the schema refuses anything but vertical delivery and mcp transport', () => {
  assert.ok(codes(job({ delivery: { ...job().delivery, aspect_ratio: '4:5' } })).includes('SCHEMA_INVALID'));
  assert.ok(codes(job({ route: { ...job().route, transport: 'http' } })).includes('SCHEMA_INVALID'));
  // `character` is deliberately not a role: a real face in that slot is refused by
  // provider moderation every time, while the same face as a plain image passes.
  assert.ok(codes(job({ references: [reference('character'), reference('footwear_detail')] })).includes('SCHEMA_INVALID'));
});

test('a muxed track is required when the job says the audio is replaced in post', () => {
  const noTrack = job({ audio: { source: 'muxed_in_post', track_sha256: null, description: null } });
  assert.ok(codes(noTrack).includes('SCHEMA_INVALID'));
  const described = job({ audio: { source: 'described_in_prompt', track_sha256: null, description: 'trippy downtempo, tape saturation' } });
  assert.deepEqual(codes(described), []);
});

test('a receipt is measured against what the job asked for', () => {
  const current = job();
  assert.deepEqual(receiptDefects(current, null).map((d) => d.code), ['RECEIPT_MISSING']);

  const good = {
    output_sha256: OTHER,
    width: 1080,
    height: 1920,
    duration_seconds: 15.07,
    fulfilled_at: '2026-07-28T12:05:00.000Z',
    provider: 'magnific-mcp',
    cut_count: 19,
    audio_replaced: true,
  };
  assert.deepEqual(receiptDefects(current, good), []);

  assert.ok(receiptDefects(current, { ...good, width: 1248, height: 1664 })
    .map((d) => d.code).includes('DELIVERED_GEOMETRY_NOT_VERTICAL'));
  assert.ok(receiptDefects(current, { ...good, duration_seconds: 6 })
    .map((d) => d.code).includes('DELIVERED_DURATION_OFF_TARGET'));
  // The model invents an audio track even when none was asked for, so a job that
  // declares a muxed track has not been fulfilled until that track is gone.
  assert.ok(receiptDefects(current, { ...good, audio_replaced: false })
    .map((d) => d.code).includes('MODEL_AUDIO_WOULD_SHIP'));
});

test('every scene kind has exactly one route and no route is orphaned', () => {
  const slugs = new Set(Object.values(ROUTE_BY_SCENE_KIND));
  assert.equal(slugs.size, Object.keys(ROUTE_BY_SCENE_KIND).length);
  for (const slug of slugs) assert.ok(MODEL_LIMITS[slug], `${slug} has no measured limits`);
});
