#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import sharp from 'sharp';

const projectRoot = path.resolve(import.meta.dirname, '..');
const port = Number.parseInt(process.env.PORT ?? '4187', 10);
const publicRoot = process.env.ZEELY_FIXTURE_PUBLIC_ROOT
  ? path.resolve(process.env.ZEELY_FIXTURE_PUBLIC_ROOT)
  : path.join(projectRoot, 'web', 'public');
const existingAvatarId = '11111111-1111-4111-8111-111111111111';
const existingLookId = '22222222-2222-4222-8222-222222222222';
const legacyAvatarId = '7df0e252-7045-4721-9b95-7bb4935fe79d';
const legacyLookId = '20cf6522-43fd-40ad-a8db-615bcdf80e07';
const completedRunId = 'fixture-completed-run';
const expiresAt = '2026-08-21T12:00:00.000Z';
const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function clone(value) {
  return structuredClone(value);
}

function now() {
  return new Date().toISOString();
}

function uuidFromSeed(seed) {
  const chars = sha256(Buffer.from(seed)).slice(0, 32).split('');
  chars[12] = '4';
  chars[16] = '8';
  const value = chars.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function avatarSvg({ accent = '#dfe4da', outfit = '#f7f6f0' } = {}) {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#e9eadf"/><stop offset="1" stop-color="#c7d1bd"/>
      </linearGradient>
    </defs>
    <rect width="800" height="1000" fill="url(#bg)"/>
    <circle cx="400" cy="238" r="118" fill="#b78266"/>
    <path d="M274 219c8-120 235-141 260 4-69-45-187-44-260-4Z" fill="#1f2420"/>
    <path d="M220 900 266 449c10-95 258-95 268 0l46 451Z" fill="${outfit}"/>
    <path d="M266 520h268v230H266Z" fill="${accent}"/>
    <path d="M273 900 326 725h148l53 175Z" fill="#29312d"/>
  </svg>`;
}

function lookSvg({ top = '#1e3d2c', accent = '#d8e0d4', footwear = '#171d1a' } = {}) {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000">
    <rect width="800" height="1000" fill="#f4f4ef"/>
    <circle cx="400" cy="215" r="105" fill="#b78266"/>
    <path d="M286 196c8-106 208-126 228 3-63-40-164-39-228-3Z" fill="#1f2420"/>
    <path d="M221 894 272 414c12-91 244-91 256 0l51 480Z" fill="${top}"/>
    <path d="M272 515h256v42H272Z" fill="${accent}"/>
    <path d="M266 894 329 710h142l63 184Z" fill="${footwear}"/>
  </svg>`;
}

function itemSvg(index, category) {
  const footwear = category === 'footwear';
  const colors = ['#315543', '#9c4b3f', '#272d48', '#c5a45f', '#603c48'];
  const color = colors[index % colors.length];
  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000">
    <rect width="800" height="1000" fill="#f3f4ef"/>
    ${footwear
      ? `<path d="M122 584c94 5 171-41 239-141l125 50c-19 72 22 115 165 129 49 5 67 44 36 76-31 33-474 39-548-1-36-20-45-70-17-113Z" fill="${color}"/>
         <path d="M143 697h526" stroke="#20251f" stroke-width="22"/>`
      : `<path d="M202 220 316 147h168l114 73-76 149-63-38v487H341V331l-63 38Z" fill="${color}"/>
         <path d="M316 147c18 58 150 58 168 0" fill="none" stroke="#20251f" stroke-width="20"/>`}
    <text x="400" y="900" text-anchor="middle" font-family="Arial,sans-serif" font-size="38" fill="#20251f">FIXTURE ${String(index + 1).padStart(2, '0')}</text>
  </svg>`;
}

function scenePlateSvg({ start, end, sun, geometry }) {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1280">
    <defs>
      <linearGradient id="scene-bg" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/>
      </linearGradient>
      <radialGradient id="sun"><stop stop-color="${sun}" stop-opacity=".95"/><stop offset="1" stop-color="${sun}" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1024" height="1280" fill="url(#scene-bg)"/>
    <circle cx="785" cy="238" r="310" fill="url(#sun)"/>
    ${geometry}
    <path d="M0 1030c240-80 485-74 1024 25v225H0Z" fill="#22251f" opacity=".16"/>
  </svg>`;
}

function sceneResultSvg(plate, accent) {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1280">
    ${plate.replace(/<svg[^>]*>|<\/svg>/g, '')}
    <ellipse cx="512" cy="1104" rx="190" ry="34" fill="#10120f" opacity=".24"/>
    <circle cx="512" cy="310" r="105" fill="#b78266"/>
    <path d="M405 290c10-115 204-133 218 5-58-41-157-42-218-5Z" fill="#1f2420"/>
    <path d="M337 1081 382 521c10-96 250-96 260 0l45 560Z" fill="${accent}"/>
    <path d="M382 625h260v49H382Z" fill="#e5d8bd"/>
    <path d="M368 1082 433 852h158l65 230Z" fill="#1a201d"/>
  </svg>`;
}

const avatarBytes = Buffer.from(avatarSvg());
const legacyLookBytes = Buffer.from(lookSvg());
const generatedLookBytes = Buffer.from(lookSvg({
  top: '#304936',
  accent: '#cbbd9a',
  footwear: '#6a3438',
}));

const sceneSpecs = [
  {
    preset_id: 'std.city.golden_hour_gloss',
    ui_name_uk: 'Міська вулиця · золота година',
    family: 'city',
    camera: { lens_mm: 50, aspect_ratio: '4:5' },
    start: '#c7a77e',
    end: '#5f6c68',
    sun: '#ffe3a1',
    accent: '#314936',
    geometry: '<path d="M70 1060V280h245v780M709 1060V180h245v880" fill="none" stroke="#f0dfc5" stroke-width="105" opacity=".72"/>',
  },
  {
    preset_id: 'std.studio.white_window_honeycomb',
    ui_name_uk: 'Біла студія · віконне соте світло',
    family: 'light_studio',
    camera: { lens_mm: 50, aspect_ratio: '4:5' },
    start: '#fbfaf4',
    end: '#d7d3c8',
    sun: '#fff2b4',
    accent: '#6f5d46',
    geometry: '<g fill="none" stroke="#9c8a67" stroke-width="12" opacity=".28"><path d="m90 340 80-46 80 46v92l-80 46-80-46ZM250 432l80-46 80 46v92l-80 46-80-46ZM90 524l80-46 80 46v92l-80 46-80-46Z"/></g>',
  },
  {
    preset_id: 'std.studio.taupe_rembrandt_gloss',
    ui_name_uk: 'Драматична студія · Rembrandt',
    family: 'dramatic_studio',
    camera: { lens_mm: 85, aspect_ratio: '4:5' },
    start: '#493e39',
    end: '#191d1c',
    sun: '#e2a466',
    accent: '#3c342f',
    geometry: '<path d="M0 0h560L230 1280H0Z" fill="#d4a26c" opacity=".18"/>',
  },
  {
    preset_id: 'std.interior.gallery_morning_gloss',
    ui_name_uk: 'Сучасна галерея · ранкове світло',
    family: 'interior',
    camera: { lens_mm: 50, aspect_ratio: '4:5' },
    start: '#e8e0d2',
    end: '#a99e8d',
    sun: '#fff0c7',
    accent: '#53604a',
    geometry: '<path d="M105 1050V250h280v800M685 1050V120h240v930" fill="none" stroke="#f4ecdf" stroke-width="85" opacity=".7"/>',
  },
  {
    preset_id: 'std.nature_architecture.concrete_grass_golden_hour',
    ui_name_uk: 'Камінь і трави · золота година',
    family: 'nature_architecture',
    camera: { lens_mm: 50, aspect_ratio: '4:5' },
    start: '#bdb6a4',
    end: '#71806b',
    sun: '#ffd27d',
    accent: '#46533f',
    geometry: '<g stroke="#ddd1b1" stroke-width="17" opacity=".65"><path d="M110 1110 210 650M265 1110 300 590M790 1110 720 620M900 1110 810 690"/></g><path d="M0 845h1024" stroke="#c8c2b3" stroke-width="90" opacity=".5"/>',
  },
];

const scenePresets = [];
const scenePreviewAssets = new Map();
const sceneResultAssets = new Map();
for (const spec of sceneSpecs) {
  const plateSvg = scenePlateSvg(spec);
  const [preview, result] = await Promise.all([
    sharp(Buffer.from(plateSvg)).webp({ quality: 88 }).toBuffer(),
    sharp(Buffer.from(sceneResultSvg(plateSvg, spec.accent))).webp({ quality: 90 }).toBuffer(),
  ]);
  const referencePackSha256 = sha256(Buffer.from(`fixture-reference-pack:${spec.preset_id}:1.0.0`));
  scenePreviewAssets.set(spec.preset_id, preview);
  sceneResultAssets.set(spec.preset_id, result);
  scenePresets.push({
    preset_id: spec.preset_id,
    preset_version: '1.0.0',
    ui_name_uk: spec.ui_name_uk,
    family: spec.family,
    camera: spec.camera,
    reference_pack_sha256: referencePackSha256,
    preview_url: `/api/scene-presets/${encodeURIComponent(spec.preset_id)}/1.0.0/preview`,
  });
}

const editorialConfig = JSON.parse(await readFile(
  path.join(projectRoot, 'config', 'scene-presets.json'),
  'utf8',
));
const editorialProgram = editorialConfig.editorial_program;
const editorialGenerationModeIds = [
  'editorial.edwin_novak.organic_contrast',
  'editorial.edwin_novak.urban_monochrome',
];
const editorialPreviewAssets = new Map();
const editorialModes = [];
for (const mode of editorialProgram.modes) {
  const sidecarPath = path.join(
    projectRoot,
    'assets',
    'scene-mood-cards',
    `${mode.preset_id}.json`,
  );
  const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8'));
  const expectedFile = `assets/scene-mood-cards/${mode.preset_id}.webp`;
  if (sidecar.schema_version !== '1.0.0'
    || sidecar.preset_id !== mode.preset_id
    || sidecar.kind !== 'editorial'
    || sidecar.asset_role !== 'mood_card'
    || sidecar.file !== expectedFile
    || sidecar.ui_name_uk !== mode.ui_name_uk
    || sidecar.delivery?.width !== 1024
    || sidecar.delivery?.height !== 1280
    || sidecar.delivery?.format !== 'webp'
    || sidecar.delivery?.aspect_ratio !== '4:5') {
    throw new Error(`Invalid editorial preview sidecar for ${mode.preset_id}`);
  }
  const bytes = await readFile(path.join(projectRoot, expectedFile));
  const metadata = await sharp(bytes).metadata();
  if (sha256(bytes) !== sidecar.sha256
    || metadata.format !== 'webp'
    || metadata.width !== 1024
    || metadata.height !== 1280
    || (metadata.pages ?? 1) !== 1) {
    throw new Error(`Invalid editorial preview asset for ${mode.preset_id}`);
  }
  editorialPreviewAssets.set(mode.preset_id, {
    bytes,
    sha256: sidecar.sha256,
  });
  editorialModes.push({
    mode_id: mode.preset_id,
    version: mode.version,
    ui_name_uk: mode.ui_name_uk,
    visual_system: mode.visual_system,
    source_set_status: mode.source_set_status,
    generation_available: editorialGenerationModeIds.includes(mode.preset_id),
    preview_url: `/api/editorial-modes/${encodeURIComponent(mode.preset_id)}/${encodeURIComponent(mode.version)}/preview`,
  });
}

const existingLook = {
  look_id: existingLookId,
  avatar_id: existingAvatarId,
  parent_look_id: null,
  name: 'Образ 01',
  image_url: '/fixture/look.svg',
  created_at: '2026-07-22T12:00:00.000Z',
  expires_at: expiresAt,
  scenes: [],
};
const existingAvatar = {
  avatar_id: existingAvatarId,
  name: 'Аватар 01',
  image_url: '/fixture/avatar.svg',
  created_at: '2026-07-22T12:00:00.000Z',
  expires_at: expiresAt,
  source_run_id: completedRunId,
  looks: [existingLook],
};
const initialProfile = {
  profile_id: 'fixture-browser-profile',
  created_at: '2026-07-23T12:00:00.000Z',
  expires_at: expiresAt,
  retention_days: 30,
  avatars: [existingAvatar],
  looks: [existingLook],
  scenes: [],
};

const legacyLook = {
  look_id: legacyLookId,
  avatar_id: legacyAvatarId,
  parent_look_id: null,
  name: 'Образ 02',
  image_url: `/api/runs/${completedRunId}/files/avatar_outfit.png`,
  created_at: '2026-07-23T12:00:00.000Z',
  expires_at: expiresAt,
  scenes: [],
};
const legacyAvatar = {
  avatar_id: legacyAvatarId,
  name: 'Аватар 02',
  image_url: `/api/runs/${completedRunId}/files/avatar.png`,
  created_at: '2026-07-23T12:00:00.000Z',
  expires_at: expiresAt,
  source_run_id: completedRunId,
  looks: [legacyLook],
};
const legacyCompletedRun = {
  run_id: completedRunId,
  status: 'COMPLETED',
  phase: 'COMPLETED',
  inner_state: 'COMPLETED',
  message: 'Аватар і образ пройшли перевірку та збережені.',
  created_at: '2026-07-23T12:00:00.000Z',
  updated_at: '2026-07-23T12:10:00.000Z',
  garments: [],
  outputs: {
    avatar: `/api/runs/${completedRunId}/files/avatar.png`,
    avatar_outfit: `/api/runs/${completedRunId}/files/avatar_outfit.png`,
  },
  execution_route: { avatar_reuse: false, garment_images_supplied: false },
  error: null,
};

function emptyDraft() {
  return {
    version: 4,
    draft_mode: 'NEW_AVATAR',
    outfit_text: '',
    generate_scene: false,
    source_avatar_id: null,
    source_look_id: null,
    updated_at: now(),
    person: null,
    identity: null,
    garments: [],
  };
}

let profile = clone(initialProfile);
let draftMeta = emptyDraft();
let draftFiles = { person: null, identity: null, garments: [] };
let fileSequence = 0;
let sceneSequence = 0;
const runs = new Map([[completedRunId, legacyCompletedRun]]);
const runTimers = new Map();
const scenes = new Map();
const sceneTimers = new Map();
const sceneIdempotency = new Map();
const claims = new Map();
const savedRuns = new Map();
const telemetryEvents = [];
const histories = { draft: [], runs: [], scenes: [] };
const counters = {
  uploads: 0,
  upload_deletes: 0,
  draft_reads: 0,
  draft_finalizations: 0,
  garment_selections: 0,
  run_sse_connections: 0,
  profile_claims: 0,
  profile_saves: 0,
  scene_creates: 0,
  scene_reads: 0,
  scene_sse_connections: 0,
  scene_downloads: 0,
  scene_deletes: 0,
};

function descriptor(slot, item) {
  if (!item) return null;
  return {
    id: item.id,
    sha256: item.sha256,
    size: item.size,
    mimetype: item.mimetype,
    url: `/api/draft/file/${slot}/${item.id}`,
  };
}

function publicDraft() {
  return {
    ...draftMeta,
    person: descriptor('person', draftFiles.person),
    identity: descriptor('identity', draftFiles.identity),
    garments: draftFiles.garments.map((item) => descriptor('garment', item)),
  };
}

function exactFileManifest() {
  const binding = (item) => item ? {
    id: item.id,
    sha256: item.sha256,
    size: item.size,
    mimetype: item.mimetype,
  } : null;
  return {
    version: 1,
    person: binding(draftFiles.person),
    identity: binding(draftFiles.identity),
    garments: draftFiles.garments.map(binding),
  };
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function findDraftFile(slot, id) {
  if (slot === 'person' || slot === 'identity') {
    return draftFiles[slot]?.id === id ? draftFiles[slot] : null;
  }
  if (slot === 'garment') return draftFiles.garments.find((item) => item.id === id) ?? null;
  return null;
}

function knownLook(lookId) {
  return profile.looks.find((look) => look.look_id === lookId) ?? null;
}

function knownAvatar(avatarId) {
  return profile.avatars.find((avatar) => avatar.avatar_id === avatarId) ?? null;
}

function updateLookCopies(lookId, mutate) {
  const topLevel = profile.looks.find((look) => look.look_id === lookId);
  if (topLevel) mutate(topLevel);
  for (const avatar of profile.avatars) {
    const nested = (avatar.looks ?? []).find((look) => look.look_id === lookId);
    if (nested) mutate(nested);
  }
}

function publicRun(run) {
  return clone(run);
}

function runItemCategory(index, count) {
  if (index >= Math.max(0, count - 2)) return 'footwear';
  return ['top', 'bag', 'bottom'][index] ?? 'accessory';
}

function buildNeedsInputRun(runId) {
  const garments = draftFiles.garments.map((file, index, all) => {
    const category = runItemCategory(index, all.length);
    return {
      source_index: index,
      reference_set_id: `set-${index}`,
      category,
      confidence: category === 'footwear' ? 0.97 : 0.94,
      preview_url: `/api/runs/${encodeURIComponent(runId)}/garments/${index}`,
      observed: {
        garment_type: category === 'footwear'
          ? (index === all.length - 1 ? 'бордові туфлі' : 'темні черевики')
          : category === 'top' ? 'верх' : category === 'bag' ? 'сумка' : 'річ',
      },
    };
  });
  const footwearIds = garments
    .filter((item) => item.category === 'footwear')
    .map((item) => item.reference_set_id);
  const createdAt = now();
  return {
    run_id: runId,
    status: 'NEEDS_INPUT',
    phase: 'GARMENT_GROUPING',
    inner_state: 'GARMENT_GROUPING',
    terminal_stage: 'GARMENT_GROUPING',
    message: 'Знайдено дві різні пари взуття. Обери одну пару для нового образу.',
    created_at: createdAt,
    updated_at: createdAt,
    garments,
    conflicts: [{
      type: 'DUPLICATE_SLOT',
      category: 'footwear',
      reference_set_ids: footwearIds,
    }],
    outputs: {},
    execution_route: { avatar_reuse: true, garment_images_supplied: true },
    source_avatar_id: draftMeta.source_avatar_id,
    source_look_id: draftMeta.source_look_id,
    selection: null,
    error: null,
  };
}

function emitRun(run, note) {
  run.updated_at = now();
  histories.runs.push({
    at: run.updated_at,
    run_id: run.run_id,
    status: run.status,
    phase: run.phase,
    note,
  });
  eventBus.emit(`run:${run.run_id}`, publicRun(run));
}

function completeRun(runId) {
  const run = runs.get(runId);
  if (!run || run.status !== 'RUNNING') return;
  run.status = 'COMPLETED';
  run.phase = 'COMPLETED';
  run.inner_state = 'COMPLETED';
  run.terminal_stage = 'COMPLETED';
  run.message = 'Новий образ для збереженого аватара пройшов перевірку.';
  run.outputs = {
    avatar: `/api/runs/${encodeURIComponent(runId)}/files/avatar.png`,
    avatar_outfit: `/api/runs/${encodeURIComponent(runId)}/files/avatar_outfit.png`,
  };
  emitRun(run, 'same run completed after footwear selection');
  runTimers.delete(runId);
}

function scheduleRunCompletion(runId) {
  clearTimeout(runTimers.get(runId));
  runTimers.set(runId, setTimeout(() => completeRun(runId), 220));
}

function sceneProjection(scene) {
  return {
    scene_id: scene.scene_id,
    look_id: scene.approved_look.look_id,
    status: scene.status,
    phase: scene.phase,
    message: scene.message,
    preset: clone(scene.preset),
    image_url: scene.output?.image_url ?? null,
    created_at: scene.created_at,
    updated_at: scene.updated_at,
  };
}

function syncSceneProjection(scene) {
  const projection = sceneProjection(scene);
  const index = profile.scenes.findIndex((item) => item.scene_id === scene.scene_id);
  if (index === -1) profile.scenes.push(projection);
  else profile.scenes[index] = projection;
  updateLookCopies(scene.approved_look.look_id, (look) => {
    look.scenes ??= [];
    const existing = look.scenes.findIndex((item) => item.scene_id === scene.scene_id);
    if (existing === -1) look.scenes.push(clone(projection));
    else look.scenes[existing] = clone(projection);
  });
}

function emitScene(scene, note) {
  scene.updated_at = now();
  syncSceneProjection(scene);
  histories.scenes.push({
    at: scene.updated_at,
    scene_id: scene.scene_id,
    status: scene.status,
    phase: scene.phase,
    note,
  });
  eventBus.emit(`scene:${scene.scene_id}`, clone(scene));
}

function clearSceneTimers(sceneId) {
  for (const timer of sceneTimers.get(sceneId) ?? []) clearTimeout(timer);
  sceneTimers.delete(sceneId);
}

function scheduleScene(sceneId) {
  clearSceneTimers(sceneId);
  const timers = [
    setTimeout(() => {
      const scene = scenes.get(sceneId);
      if (!scene || scene.status !== 'QUEUED') return;
      scene.status = 'RUNNING';
      scene.phase = 'GENERATING';
      scene.message = 'Поєднуємо збережений master-образ із вибраним середовищем.';
      emitScene(scene, 'generation started');
    }, 140),
    setTimeout(() => {
      const scene = scenes.get(sceneId);
      if (!scene || scene.status !== 'RUNNING') return;
      scene.phase = 'QA';
      scene.message = 'Перевіряємо обличчя, речі, світло, кадрування та контактну тінь.';
      emitScene(scene, 'scene QA started');
    }, 360),
    setTimeout(() => {
      const scene = scenes.get(sceneId);
      if (!scene || scene.status !== 'RUNNING') return;
      scene.status = 'COMPLETED';
      scene.phase = 'COMPLETED';
      scene.message = 'Сцена пройшла всі перевірки та збережена в образі.';
      scene.output = {
        sha256: sha256(sceneResultAssets.get(scene.preset.preset_id)),
        media_type: 'image/webp',
        image_url: `/api/profile/scenes/${encodeURIComponent(sceneId)}/image`,
        download_url: `/api/profile/scenes/${encodeURIComponent(sceneId)}/download`,
      };
      emitScene(scene, 'scene completed');
      clearSceneTimers(sceneId);
    }, 680),
  ];
  sceneTimers.set(sceneId, timers);
}

function deleteSceneProjection(sceneId, lookId) {
  profile.scenes = profile.scenes.filter((item) => item.scene_id !== sceneId);
  updateLookCopies(lookId, (look) => {
    look.scenes = (look.scenes ?? []).filter((item) => item.scene_id !== sceneId);
  });
}

function fixtureState() {
  return {
    profile: clone(profile),
    draft: publicDraft(),
    runs: [...runs.values()].map((run) => publicRun(run)),
    scenes: [...scenes.values()].map((scene) => clone(scene)),
    claims: Object.fromEntries(claims),
    saved_run_ids: [...savedRuns.keys()],
    counters: clone(counters),
    histories: clone(histories),
    telemetry: clone(telemetryEvents.slice(-100)),
  };
}

const app = Fastify({ logger: false, bodyLimit: 24 * 1024 * 1024 });
await app.register(multipart, {
  limits: { files: 1, fileSize: 18 * 1024 * 1024, fields: 2, parts: 3 },
});

app.get('/api/profile', async () => clone(profile));

app.delete('/api/profile', async (_request, reply) => {
  profile = clone(initialProfile);
  return reply.code(204).send();
});

app.delete('/api/profile/avatars/:avatarId', async (request, reply) => {
  const avatar = knownAvatar(request.params.avatarId);
  if (!avatar) return reply.code(404).send({ error: 'Fixture avatar not found' });
  const lookIds = new Set((avatar.looks ?? []).map((look) => look.look_id));
  profile.avatars = profile.avatars.filter((item) => item.avatar_id !== avatar.avatar_id);
  profile.looks = profile.looks.filter((item) => !lookIds.has(item.look_id));
  profile.scenes = profile.scenes.filter((item) => !lookIds.has(item.look_id));
  return reply.code(204).send();
});

app.delete('/api/profile/looks/:lookId', async (request, reply) => {
  if (!knownLook(request.params.lookId)) {
    return reply.code(404).send({ error: 'Fixture look not found' });
  }
  profile.looks = profile.looks.filter((look) => look.look_id !== request.params.lookId);
  for (const avatar of profile.avatars) {
    avatar.looks = (avatar.looks ?? []).filter((look) => look.look_id !== request.params.lookId);
  }
  profile.scenes = profile.scenes.filter((scene) => scene.look_id !== request.params.lookId);
  return reply.code(204).send();
});

app.post('/api/profile/runs/:runId/claim', async (request, reply) => {
  const run = runs.get(request.params.runId);
  if (!run) return reply.code(404).send({ error: 'Fixture run not found' });
  counters.profile_claims += 1;
  const previous = claims.get(run.run_id);
  const claim = {
    run_id: run.run_id,
    source_avatar_id: request.body?.source_avatar_id ?? null,
    source_look_id: request.body?.source_look_id ?? null,
    replayed: Boolean(previous),
  };
  if (run.source_avatar_id
    && (claim.source_avatar_id !== run.source_avatar_id
      || claim.source_look_id !== run.source_look_id)) {
    return reply.code(409).send({ error: 'Fixture run lineage mismatch' });
  }
  claims.set(run.run_id, claim);
  return reply.code(previous ? 200 : 201).send(claim);
});

app.post('/api/profile/runs/:runId/save', async (request, reply) => {
  const run = runs.get(request.params.runId);
  if (!run) return reply.code(404).send({ error: 'Fixture run not found' });
  if (run.status !== 'COMPLETED') {
    return reply.code(409).send({ error: 'Fixture run is not completed' });
  }
  counters.profile_saves += 1;
  if (savedRuns.has(run.run_id)) {
    return reply.code(200).send({ ...clone(savedRuns.get(run.run_id)), replayed: true });
  }

  let savedAvatar;
  let savedLook;
  if (run.run_id === completedRunId) {
    savedAvatar = clone(legacyAvatar);
    savedLook = clone(legacyLook);
    if (!knownAvatar(savedAvatar.avatar_id)) profile.avatars.push(clone(savedAvatar));
    if (!knownLook(savedLook.look_id)) profile.looks.push(clone(savedLook));
  } else {
    savedAvatar = knownAvatar(run.source_avatar_id);
    if (!savedAvatar) return reply.code(404).send({ error: 'Fixture source avatar not found' });
    const savedLookId = uuidFromSeed(`look:${run.run_id}`);
    savedLook = {
      look_id: savedLookId,
      avatar_id: savedAvatar.avatar_id,
      parent_look_id: run.source_look_id,
      name: `Образ ${String(profile.looks.length + 1).padStart(2, '0')}`,
      image_url: `/api/runs/${encodeURIComponent(run.run_id)}/files/avatar_outfit.png`,
      created_at: now(),
      expires_at: expiresAt,
      scenes: [],
    };
    if (!knownLook(savedLookId)) {
      profile.looks.push(clone(savedLook));
      const avatarRecord = knownAvatar(savedAvatar.avatar_id);
      avatarRecord.looks ??= [];
      avatarRecord.looks.push(clone(savedLook));
    }
    savedAvatar = knownAvatar(savedAvatar.avatar_id);
  }
  const response = {
    avatar: clone(savedAvatar),
    look: clone(savedLook),
    profile: clone(profile),
    replayed: false,
  };
  savedRuns.set(run.run_id, response);
  return reply.code(201).send(response);
});

app.get('/api/draft', async () => {
  counters.draft_reads += 1;
  return publicDraft();
});

app.put('/api/draft/meta', async (request, reply) => {
  const sourceAvatarId = request.body?.source_avatar_id ?? null;
  const sourceLookId = request.body?.source_look_id ?? null;
  if (sourceAvatarId !== null && !knownAvatar(sourceAvatarId)) {
    return reply.code(404).send({ error: 'Fixture avatar not found' });
  }
  if (sourceLookId !== null) {
    const sourceLook = knownLook(sourceLookId);
    if (!sourceLook || sourceLook.avatar_id !== sourceAvatarId) {
      return reply.code(409).send({ error: 'Fixture look/avatar mismatch' });
    }
  }
  draftMeta = {
    ...draftMeta,
    draft_mode: sourceAvatarId ? 'ADD_ITEMS' : 'NEW_AVATAR',
    outfit_text: String(request.body?.outfit_text ?? ''),
    generate_scene: false,
    source_avatar_id: sourceAvatarId,
    source_look_id: sourceLookId,
    updated_at: now(),
  };
  histories.draft.push({
    at: draftMeta.updated_at,
    type: 'META',
    draft_mode: draftMeta.draft_mode,
    source_avatar_id: sourceAvatarId,
    source_look_id: sourceLookId,
  });
  return publicDraft();
});

app.post('/api/draft/file/:slot', async (request, reply) => {
  const { slot } = request.params;
  if (!['person', 'identity', 'garment'].includes(slot)) {
    return reply.code(404).send({ error: 'Fixture draft slot not found' });
  }
  let upload = null;
  for await (const part of request.parts()) {
    if (part.type !== 'file' || upload) continue;
    const buffer = await part.toBuffer();
    upload = {
      id: uuidFromSeed(`draft-file:${++fileSequence}`),
      filename: part.filename || `fixture-${slot}.jpg`,
      mimetype: part.mimetype || 'image/jpeg',
      size: buffer.length,
      sha256: sha256(buffer),
      buffer,
    };
  }
  if (!upload?.size) return reply.code(400).send({ error: 'Fixture upload is empty' });
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(upload.mimetype)) {
    return reply.code(415).send({ error: 'Fixture accepts JPEG, PNG or WebP' });
  }
  if (slot === 'garment') draftFiles.garments.push(upload);
  else draftFiles[slot] = upload;
  draftMeta.updated_at = now();
  counters.uploads += 1;
  histories.draft.push({
    at: draftMeta.updated_at,
    type: 'UPLOAD',
    slot,
    id: upload.id,
    sha256: upload.sha256,
    size: upload.size,
  });
  return reply.code(201).send(descriptor(slot, upload));
});

app.get('/api/draft/file/:slot/:id', async (request, reply) => {
  const file = findDraftFile(request.params.slot, request.params.id);
  if (!file) return reply.code(404).send({ error: 'Fixture draft file not found' });
  return reply
    .type(file.mimetype)
    .header('Cache-Control', 'private, no-store')
    .send(file.buffer);
});

app.delete('/api/draft/file/:slot/:id', async (request, reply) => {
  const file = findDraftFile(request.params.slot, request.params.id);
  if (!file) return reply.code(404).send({ error: 'Fixture draft file not found' });
  if (request.params.slot === 'garment') {
    draftFiles.garments = draftFiles.garments.filter((item) => item.id !== file.id);
  } else {
    draftFiles[request.params.slot] = null;
  }
  draftMeta.updated_at = now();
  counters.upload_deletes += 1;
  histories.draft.push({
    at: draftMeta.updated_at,
    type: 'DELETE_FILE',
    slot: request.params.slot,
    id: file.id,
  });
  return reply.code(204).send();
});

app.delete('/api/draft', async (_request, reply) => {
  draftMeta = emptyDraft();
  draftFiles = { person: null, identity: null, garments: [] };
  histories.draft.push({ at: now(), type: 'CLEAR' });
  return reply.code(204).send();
});

app.post('/api/draft/run', async (request, reply) => {
  counters.draft_finalizations += 1;
  if (request.body?.consent !== true) {
    return reply.code(400).send({ error: 'Consent is required' });
  }
  if (!exactJson(request.body?.file_manifest, exactFileManifest())) {
    return reply.code(409).send({
      error: 'Файли чернетки змінилися; fixture відхилив неточний manifest',
      code: 'DRAFT_FILE_MANIFEST_MISMATCH',
    });
  }
  if (draftMeta.draft_mode !== 'ADD_ITEMS'
    || !draftMeta.source_avatar_id
    || !draftMeta.source_look_id) {
    return reply.code(409).send({
      error: 'Fixture A→Z flow requires a saved avatar and look',
      code: 'ADD_ITEMS_SOURCE_REQUIRED',
    });
  }
  if (request.body?.source_avatar_id !== draftMeta.source_avatar_id
    || request.body?.source_look_id !== draftMeta.source_look_id) {
    return reply.code(409).send({
      error: 'Fixture ADD_ITEMS lineage does not match the saved draft',
      code: 'DRAFT_LOOK_BINDING_MISMATCH',
    });
  }
  if (draftFiles.garments.length < 2) {
    return reply.code(400).send({ error: 'Для fixture-конфлікту додай щонайменше дві речі' });
  }
  const runId = request.body?.finalization_key;
  if (typeof runId !== 'string' || runId.length < 8) {
    return reply.code(400).send({ error: 'Fixture finalization_key is required' });
  }
  if (!runs.has(runId)) {
    const run = buildNeedsInputRun(runId);
    runs.set(runId, run);
    emitRun(run, 'draft finalized; duplicate footwear choice required');
  }
  return reply.code(202).send(publicRun(runs.get(runId)));
});

app.get('/api/runs/:runId', async (request, reply) => {
  const run = runs.get(request.params.runId);
  return run ? publicRun(run) : reply.code(404).send({ error: 'Fixture run not found' });
});

app.get('/api/runs/:runId/events', async (request, reply) => {
  const run = runs.get(request.params.runId);
  if (!run) return reply.code(404).send({ error: 'Fixture run not found' });
  counters.run_sse_connections += 1;
  let closed = false;
  const send = (snapshot) => {
    if (closed) return;
    reply.raw.write(`event: run\ndata: ${JSON.stringify(snapshot)}\n\n`);
    if (['COMPLETED', 'FAILED', 'NEEDS_INPUT'].includes(snapshot.status)) cleanup(true);
  };
  const listener = (snapshot) => send(snapshot);
  const cleanup = (end = false) => {
    if (closed) return;
    closed = true;
    eventBus.off(`run:${run.run_id}`, listener);
    if (end) reply.raw.end();
  };
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  eventBus.on(`run:${run.run_id}`, listener);
  send(publicRun(run));
  request.raw.on('close', () => cleanup(false));
  return reply;
});

app.post('/api/runs/:runId/garment-selection', async (request, reply) => {
  const run = runs.get(request.params.runId);
  if (!run) return reply.code(404).send({ error: 'Fixture run not found' });
  const selected = request.body?.selections?.footwear;
  const allowed = run.conflicts?.[0]?.reference_set_ids ?? [];
  if (run.status !== 'NEEDS_INPUT' || !allowed.includes(selected)) {
    return reply.code(409).send({ error: 'Обери одну із запропонованих пар взуття' });
  }
  counters.garment_selections += 1;
  run.selection = { footwear: selected };
  run.conflicts = [];
  run.status = 'RUNNING';
  run.phase = 'OUTFIT_GENERATING';
  run.inner_state = 'OUTFIT_GENERATING';
  run.terminal_stage = null;
  run.message = 'Вибір збережено. Продовжуємо той самий запуск із зафіксованим аватаром.';
  emitRun(run, `footwear selected: ${selected}`);
  scheduleRunCompletion(run.run_id);
  return reply.code(202).send(publicRun(run));
});

app.post('/api/runs/:runId/retry', async (request, reply) => {
  const run = runs.get(request.params.runId);
  if (!run) return reply.code(404).send({ error: 'Fixture run not found' });
  return reply.code(202).send(publicRun(run));
});

app.get('/api/runs/:runId/garments/:index', async (request, reply) => {
  const run = runs.get(request.params.runId);
  const index = Number.parseInt(request.params.index, 10);
  const file = Number.isInteger(index) ? draftFiles.garments[index] : null;
  if (!run || !file) return reply.code(404).send({ error: 'Fixture item preview not found' });
  const category = run.garments[index]?.category ?? 'accessory';
  return reply
    .type('image/svg+xml')
    .header('Cache-Control', 'private, no-store')
    .send(itemSvg(index, category));
});

app.get('/api/runs/:runId/files/:fileName', async (request, reply) => {
  const run = runs.get(request.params.runId);
  if (!run) return reply.code(404).send({ error: 'Fixture run not found' });
  if (request.params.fileName === 'avatar.png') {
    return reply.type('image/svg+xml').send(avatarBytes);
  }
  if (request.params.fileName === 'avatar_outfit.png') {
    return reply.type('image/svg+xml').send(
      run.run_id === completedRunId ? legacyLookBytes : generatedLookBytes,
    );
  }
  return reply.code(404).send({ error: 'Fixture output not found' });
});

app.get('/api/scene-presets', async (_request, reply) => reply
  .header('Cache-Control', 'private, no-store')
  .send({ presets: clone(scenePresets) }));

app.get('/api/scene-presets/:presetId/:presetVersion/preview', async (request, reply) => {
  const preset = scenePresets.find((item) => (
    item.preset_id === request.params.presetId
    && item.preset_version === request.params.presetVersion
  ));
  const bytes = preset ? scenePreviewAssets.get(preset.preset_id) : null;
  if (!preset || !bytes) return reply.code(404).send({ error: 'Fixture scene preset not found' });
  return reply
    .type('image/webp')
    .header('Cache-Control', 'public, max-age=3600')
    .header('ETag', `"${sha256(bytes)}"`)
    .header('Cross-Origin-Resource-Policy', 'same-origin')
    .send(bytes);
});

app.get('/api/editorial-modes', async (_request, reply) => reply
  .header('Cache-Control', 'private, no-store')
  .send({
    status: 'ACTIVE',
    generation_available: true,
    generation_mode_ids: [...editorialGenerationModeIds],
    shot_sequence: clone(editorialProgram.shot_sequence),
    modes: clone(editorialModes),
  }));

app.get('/api/editorial-modes/:modeId/:version/preview', async (request, reply) => {
  const mode = editorialModes.find((item) => (
    item.mode_id === request.params.modeId
    && item.version === request.params.version
  ));
  const preview = mode ? editorialPreviewAssets.get(mode.mode_id) : null;
  if (!mode || !preview) {
    return reply.code(404).send({ error: 'Fixture editorial mode not found' });
  }
  const etag = `"${preview.sha256}"`;
  reply
    .type('image/webp')
    .header('Cache-Control', 'public, max-age=31536000, immutable')
    .header('ETag', etag)
    .header('Cross-Origin-Resource-Policy', 'same-origin')
    .header('X-Content-Type-Options', 'nosniff');
  const matches = String(request.headers['if-none-match'] ?? '')
    .split(',')
    .some((candidate) => {
      const normalized = candidate.trim();
      return normalized === '*' || normalized === etag || normalized === `W/${etag}`;
    });
  if (matches) return reply.code(304).send();
  return reply.send(preview.bytes);
});

app.get('/api/profile/looks/:lookId/scenes', async (request, reply) => {
  const look = knownLook(request.params.lookId);
  if (!look) return reply.code(404).send({ error: 'Fixture look not found' });
  return reply.send({ scenes: clone(look.scenes ?? []) });
});

app.post('/api/profile/looks/:lookId/scenes', async (request, reply) => {
  const look = knownLook(request.params.lookId);
  if (!look) return reply.code(404).send({ error: 'Fixture look not found' });
  const preset = scenePresets.find((item) => (
    item.preset_id === request.body?.preset_id
    && item.preset_version === request.body?.preset_version
  ));
  if (!preset) return reply.code(404).send({ error: 'Fixture scene preset not found' });
  if (request.body?.expected_reference_pack_sha256
    && request.body.expected_reference_pack_sha256 !== preset.reference_pack_sha256) {
    return reply.code(409).send({
      error: 'Fixture scene preset changed',
      code: 'SCENE_PRESET_STALE',
    });
  }
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 8) {
    return reply.code(422).send({ error: 'Fixture Idempotency-Key is required' });
  }
  counters.scene_creates += 1;
  const existingSceneId = sceneIdempotency.get(`${look.look_id}:${key}`);
  if (existingSceneId && scenes.has(existingSceneId)) {
    return reply.code(202).send(clone(scenes.get(existingSceneId)));
  }
  const sceneId = `fixture-scene-${String(++sceneSequence).padStart(3, '0')}`;
  const createdAt = now();
  const scene = {
    scene_id: sceneId,
    status: 'QUEUED',
    phase: 'BINDING_INPUTS',
    message: 'Фіксуємо master-образ, preset і reference pack.',
    created_at: createdAt,
    updated_at: createdAt,
    approved_look: {
      look_id: look.look_id,
      image_sha256: sha256(Buffer.from(look.image_url)),
    },
    preset: {
      preset_id: preset.preset_id,
      version: preset.preset_version,
      ui_name_uk: preset.ui_name_uk,
      reference_pack_sha256: preset.reference_pack_sha256,
    },
    execution: {
      model: { name: 'gpt-image-2', version: 'fixture', quality: 'high' },
    },
    output: null,
    error: null,
  };
  scenes.set(sceneId, scene);
  sceneIdempotency.set(`${look.look_id}:${key}`, sceneId);
  emitScene(scene, 'scene created');
  scheduleScene(sceneId);
  return reply.code(202).send(clone(scene));
});

app.get('/api/profile/scenes/:sceneId', async (request, reply) => {
  const scene = scenes.get(request.params.sceneId);
  if (!scene) return reply.code(404).send({ error: 'Fixture scene not found' });
  counters.scene_reads += 1;
  return clone(scene);
});

app.get('/api/profile/scenes/:sceneId/events', async (request, reply) => {
  const scene = scenes.get(request.params.sceneId);
  if (!scene) return reply.code(404).send({ error: 'Fixture scene not found' });
  counters.scene_sse_connections += 1;
  let closed = false;
  const send = (snapshot) => {
    if (closed) return;
    reply.raw.write(`event: scene\ndata: ${JSON.stringify(snapshot)}\n\n`);
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(snapshot.status)) cleanup(true);
  };
  const listener = (snapshot) => send(snapshot);
  const cleanup = (end = false) => {
    if (closed) return;
    closed = true;
    eventBus.off(`scene:${scene.scene_id}`, listener);
    if (end) reply.raw.end();
  };
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'private, no-cache, no-transform',
    Connection: 'keep-alive',
  });
  eventBus.on(`scene:${scene.scene_id}`, listener);
  send(clone(scene));
  request.raw.on('close', () => cleanup(false));
  return reply;
});

app.post('/api/profile/scenes/:sceneId/cancel', async (request, reply) => {
  const scene = scenes.get(request.params.sceneId);
  if (!scene) return reply.code(404).send({ error: 'Fixture scene not found' });
  if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(scene.status)) {
    clearSceneTimers(scene.scene_id);
    scene.status = 'CANCELLED';
    scene.phase = 'CANCELLED';
    scene.message = 'Fixture scene cancelled.';
    emitScene(scene, 'scene cancelled');
  }
  return reply.code(202).send(clone(scene));
});

app.post('/api/profile/scenes/:sceneId/retry', async (request, reply) => {
  const scene = scenes.get(request.params.sceneId);
  if (!scene) return reply.code(404).send({ error: 'Fixture scene not found' });
  scene.status = 'QUEUED';
  scene.phase = 'BINDING_INPUTS';
  scene.message = 'Fixture scene retry accepted.';
  scene.output = null;
  emitScene(scene, 'scene retry');
  scheduleScene(scene.scene_id);
  return reply.code(202).send(clone(scene));
});

app.get('/api/profile/scenes/:sceneId/image', async (request, reply) => {
  const scene = scenes.get(request.params.sceneId);
  const bytes = scene?.status === 'COMPLETED'
    ? sceneResultAssets.get(scene.preset.preset_id)
    : null;
  if (!bytes) return reply.code(404).send({ error: 'Fixture scene image not found' });
  return reply
    .type('image/webp')
    .header('Cache-Control', 'private, no-store')
    .send(bytes);
});

app.get('/api/profile/scenes/:sceneId/download', async (request, reply) => {
  const scene = scenes.get(request.params.sceneId);
  const bytes = scene?.status === 'COMPLETED'
    ? sceneResultAssets.get(scene.preset.preset_id)
    : null;
  if (!bytes) return reply.code(404).send({ error: 'Fixture scene image not found' });
  counters.scene_downloads += 1;
  return reply
    .type('image/webp')
    .header('Cache-Control', 'private, no-store')
    .header('Content-Disposition', 'attachment; filename="fixture-scene.webp"')
    .send(bytes);
});

app.delete('/api/profile/scenes/:sceneId', async (request, reply) => {
  const scene = scenes.get(request.params.sceneId);
  if (!scene) return reply.code(404).send({ error: 'Fixture scene not found' });
  clearSceneTimers(scene.scene_id);
  scenes.delete(scene.scene_id);
  deleteSceneProjection(scene.scene_id, scene.approved_look.look_id);
  counters.scene_deletes += 1;
  histories.scenes.push({
    at: now(),
    scene_id: scene.scene_id,
    status: 'DELETED',
    phase: 'DELETED',
    note: 'scene deleted',
  });
  return reply.code(204).send();
});

app.post('/api/telemetry', async (request, reply) => {
  telemetryEvents.push({ at: now(), ...(request.body ?? {}) });
  return reply.code(204).send();
});

app.get('/api/fixture-state', async () => fixtureState());
app.get('/fixture/avatar.svg', async (_request, reply) => (
  reply.type('image/svg+xml').send(avatarBytes)
));
app.get('/fixture/look.svg', async (_request, reply) => (
  reply.type('image/svg+xml').send(legacyLookBytes)
));

await app.register(fastifyStatic, {
  root: publicRoot,
  prefix: '/',
  index: ['index.html'],
});

await app.listen({ host: '127.0.0.1', port });
process.stdout.write(`add-items UI fixture ready at http://127.0.0.1:${port} from ${publicRoot}\n`);
