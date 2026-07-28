import {
  EDITORIAL_SCHEMA_VERSION,
  EDITORIAL_SHOT_SLOTS,
  canonicalJsonBytes as editorialCanonicalJsonBytes,
  editorialShotSpecSha256,
  sha256,
  validateEditorialShootBible,
} from './editorial-shoot-contract.js';
import {
  canonicalJsonBytes as sceneCanonicalJsonBytes,
  editorialFramingLock,
} from './scene-contract.js';

export const READY_EDITORIAL_MODE_IDS = Object.freeze([
  'editorial.edwin_novak.organic_contrast',
  'editorial.edwin_novak.urban_monochrome',
  'shoot.skylight_haze',
  'shoot.terracotta_hardlight',
  'shoot.window_gobo_warm',
  'shoot.grey_studio_stride',
  'shoot.sky_dune_surreal',
  'shoot.hardsun_brick_doorway',
  'shoot.overcast_street_stride',
  'shoot.grey_wall_gloss',
  'shoot.ochre_stage_tailoring',
  'shoot.shutter_amber_interior',
]);

export const EDITORIAL_BASE_PRESETS = Object.freeze({
  'editorial.edwin_novak.organic_contrast': Object.freeze({
    preset_id: 'std.nature_architecture.concrete_grass_golden_hour',
    preset_version: '1.0.0',
  }),
  'editorial.edwin_novak.urban_monochrome': Object.freeze({
    preset_id: 'std.city.golden_hour_gloss',
    preset_version: '1.0.0',
  }),
});

const MODE_CONTENT = Object.freeze({
  'editorial.edwin_novak.organic_contrast': Object.freeze({
    title: 'Органічний контраст — преміальна fashion-фотосесія',
    environment: 'Original deep-green landscape, controlled foliage, water or pale concrete planes with generous negative space and no identifiable location.',
    palette: 'Deep green, warm off-white, restrained mustard, concrete grey, natural skin and the exact approved item colors.',
    lighting: 'Low warm morning or golden-hour side light, cool open-sky fill, coherent contact shadow and protected face and item detail.',
    materials: ['deep green foliage', 'pale concrete or stone', 'controlled water reflection'],
    contrast: 'medium',
  }),
  // The monochrome is the set, not the render. Ordering a monochrome grade lost
  // editorial.edwin_novak.urban_monochrome two gates at once on the same frame:
  // ITEM_FIDELITY returned ITEM_DETAIL_NOT_VERIFIABLE because a greyscale garment
  // cannot prove its approved dark-green body or its red-versus-navy twisted-rope
  // stripe, and IDENTITY refused the subject because the grade turned vivid auburn
  // hair dark brown. Colour is half of what this product sells and part of what
  // identity is, so the near-neutral range stays on concrete, metal and sky while
  // skin, hair and the approved item keep their own colour. True greyscale was the
  // other way out, but it can only be made passable by exempting colour from the
  // two gates the shoot exists to satisfy. Note that the negative constraints
  // already forbade a recoloured approved item — the mode prose was commanding the
  // very thing they refuse.
  'editorial.edwin_novak.urban_monochrome': Object.freeze({
    title: 'Міський монохром — преміальна fashion-фотосесія',
    environment: 'Original rooftop or clean urban concrete composition with invented facade grids, disciplined negative space and no identifiable architecture.',
    palette: 'Black, warm white, concrete grey and restrained silver in the environment, natural skin, natural hair color and the exact approved item colors at full saturation; black and white is the set and never the render.',
    lighting: 'Early-morning or low golden side light shaped into graphic near-neutral tonal contrast across concrete and sky, with readable midtones, coherent contact shadow and no desaturating grade over skin, hair or an approved item.',
    materials: ['clean concrete', 'invented facade grid', 'restrained metal'],
    contrast: 'high',
  }),
});

// Create Universe is a separate product from standard backgrounds. Its visual
// content comes from a hash-verified local unit at resolver time; it is never
// inferred from, or coupled to, a std.* preset.
function modeContent(mode) {
  const content = mode?.create_universe?.content ?? MODE_CONTENT[mode?.preset_id];
  if (!content
    || typeof content.title !== 'string'
    || typeof content.environment !== 'string'
    || typeof content.palette !== 'string'
    || typeof content.lighting !== 'string'
    || !Array.isArray(content.materials)
    || typeof content.contrast !== 'string') {
    throw new Error('Editorial mode has no verified visual content');
  }
  return content;
}

// The vertical lock of a slot — subject-height band, clear space, and head and footwear
// visibility — is owned by scene-contract.js, which is also the file that refuses a
// resolved camera disagreeing with it ('Resolved editorial camera does not match its
// canonical framing lock'). Restating those numbers here bought nothing and could only
// drift, and drift did not make a slot wrong, it made it unshootable. So read them.
function withVerticalLock(slots) {
  return Object.freeze(Object.fromEntries(
    Object.entries(slots).map(([slot, content]) => {
      const lock = editorialFramingLock(slot);
      return [slot, Object.freeze({
        ...content,
        subject_height_percent: Object.freeze([...lock.subject]),
        clear_space: Object.freeze({ above_hair: lock.above, below_footwear: lock.below }),
        require_full_head: lock.head,
        require_full_footwear: lock.footwear,
      })];
    }),
  ));
}

const SLOT_CONTENT = withVerticalLock({
  clean_identity_hero: Object.freeze({
    title: 'Чистий hero-кадр',
    objective: 'Establish exact identity, natural body proportions and every approved item without obstruction before any experimental frame.',
    lens_mm: 50,
    // Art direction carries no full-body or footwear lock. That lock belongs to
    // the standard scene families, where "try the garment on" is the product
    // promise; here the crop is the style. With it in place this slot forced a
    // full-length frame, the generator had to invent a lower garment and shoes
    // the approved look never contained, and ITEM_FIDELITY correctly refused to
    // verify invented items — so the first slot of every shoot was unpassable
    // and blocked the three crop slots behind it.
    framing: 'three_quarter',
    height: 'eye_level',
    angle: 'Eye level with disciplined verticals and no optical distortion.',
    pose: 'Grounded confident stance, separated hands, readable silhouette and unobstructed outfit.',
    identity_visibility: 'full_face',
    optical_device: null,
  }),
  environmental_hero: Object.freeze({
    title: 'Hero у просторі',
    objective: 'Integrate the exact approved person and look into the mode environment while preserving clear identity and complete item evidence.',
    lens_mm: 50,
    // Same reason as clean_identity_hero: the environment frame is art
    // direction, not a fitting shot. The avatar is full-length, so this is no
    // longer about what a reference can cover — three-quarter is the crop this
    // slot wants, placing the look against the mode environment instead of
    // measuring it head to foot.
    framing: 'three_quarter',
    height: 'low_max_5deg',
    angle: 'Controlled low angle no more than five degrees with straight architecture.',
    pose: 'Editorial full-body stance with one natural weight shift and hands clear of critical garment evidence.',
    identity_visibility: 'full_face',
    optical_device: null,
  }),
  sculptural_three_quarter: Object.freeze({
    title: 'Скульптурний 3/4',
    objective: 'Create a sculptural three-quarter fashion portrait while keeping face, upper-body construction and the dominant accessories exact.',
    lens_mm: 65,
    framing: 'three_quarter',
    height: 'eye_level',
    angle: 'Eye-level three-quarter portrait with compressed perspective and disciplined verticals.',
    pose: 'Sculptural shoulder and torso rotation with anatomically clear hands and no product occlusion.',
    identity_visibility: 'full_face',
    optical_device: null,
  }),
  interference_frame: Object.freeze({
    title: 'Кадр з оптичним акцентом',
    objective: 'Use exactly one controlled foreground optical interruption without covering identity, logos, text or critical construction.',
    lens_mm: 55,
    framing: 'three_quarter',
    height: 'eye_level',
    angle: 'Slightly oblique eye-level composition with one clean foreground layer.',
    pose: 'Controlled fashion pose with readable limbs and protected face and item evidence.',
    identity_visibility: 'full_face',
    optical_device: 'One narrow translucent foreground reflection or dappled-light interruption outside the face, logos, text and critical item construction.',
  }),
  material_or_accessory_detail: Object.freeze({
    title: 'Деталь матеріалу або аксесуара',
    objective: 'Show one approved material, construction, logo, text, footwear or accessory detail at forensic fidelity while retaining non-conflicting visible identity evidence.',
    lens_mm: 85,
    framing: 'detail',
    height: 'eye_level',
    angle: 'Close editorial detail with natural perspective and no macro distortion.',
    pose: 'Detail-led crop with anatomically plausible hand or body context and no invented item surface.',
    identity_visibility: 'partial_face',
    optical_device: null,
  }),
  wide_campaign_coda: Object.freeze({
    title: 'Широкий campaign-фінал',
    objective: 'Close the series with a wide campaign frame that preserves the exact complete person and look inside strong original negative space.',
    lens_mm: 35,
    // A full-body coda makes any visible lower garment or footwear a
    // first-appearance evidence candidate. Capture those existing pixels into
    // an immutable item lock before reuse; never replace them with synthesis.
    framing: 'wide_full_body',
    height: 'waist_level',
    angle: 'Waist-level wide composition with corrected verticals and no wide-angle body distortion.',
    pose: 'Small but fully readable figure with separated limbs and an unmistakable complete approved silhouette.',
    identity_visibility: 'full_face',
    optical_device: null,
  }),
});

function unique(values, maximum = Infinity) {
  return [...new Set(values.filter(Boolean))].slice(0, maximum);
}

function styleObservations(mode) {
  return mode.sources.map((source) => ({
    url: source.url,
    role: source.role,
    use: source.use,
    not_authority_for: [...source.not_authority_for],
  }));
}

function verifiedRightsSummary(sourceLedger) {
  const evidence = sourceLedger.sources.map((source) => (
    `${source.rights.basis}:${source.rights.evidence_uri}:${source.rights.evidence_sha256}`
  ));
  return `Verified production-pack rights evidence (${evidence.join(', ')}).`;
}

function bibleSourceReferences(basePack) {
  const roleMap = {
    environment_anchor: 'environment',
    lighting_anchor: 'lighting',
    composition_anchor: 'composition',
    palette_anchor: 'palette',
  };
  const rightsBasis = verifiedRightsSummary(basePack.reference_pack.source_ledger);
  return basePack.reference_pack.references
    .filter((reference) => roleMap[reference.role])
    .map((reference) => ({
      reference_id: `editorial_${reference.role}`,
      sha256: reference.sha256,
      role: roleMap[reference.role],
      rights_basis: rightsBasis,
      expires_at: '2099-12-31T23:59:59.000Z',
    }));
}

function shotSpec(modeDefinition, slot) {
  const mode = modeContent(modeDefinition);
  const shot = SLOT_CONTENT[slot];
  return {
    slot,
    title: shot.title,
    objective: shot.objective,
    camera: {
      lens_mm: shot.lens_mm,
      framing: shot.framing,
      angle: shot.angle,
      subject_height_percent: [...shot.subject_height_percent],
    },
    pose: shot.pose,
    lighting: mode.lighting,
    environment: mode.environment,
    palette: mode.palette,
    identity_visibility: shot.identity_visibility,
    item_evidence: [
      'Preserve every approved item that intersects the intentional crop in exact type, silhouette, color, material and construction.',
      'Preserve every visible logo, graphic, letter, number, pattern, closure, hardware and footwear detail exactly; never invent an out-of-frame item.',
      'Preserve every already approved item exactly. When a full-body approved look visibly carries an unregistered lower garment or footwear, treat those pixels as first-appearance evidence: capture and lock that item before it is reused; never replace it with a prettier synthesis.',
    ],
    optical_device: shot.optical_device,
    negative_constraints: [
      'No identity drift, age change, face replacement, body redesign or skin smoothing.',
      'No removed, substituted, recolored or redesigned approved garment, accessory, footwear, logo or text. Do not replace an unregistered item already visible in the approved look with a synthesized alternative.',
      'No copied source person, landmark, readable signage or exact source architecture.',
      'No malformed hands, merged limbs, destructive crop or incoherent contact shadow.',
    ],
  };
}

export function compileEditorialShootBible({ mode, basePack }) {
  if (!mode || !READY_EDITORIAL_MODE_IDS.includes(mode.preset_id)) {
    throw new Error('Only a READY editorial mode can compile a production ShootBible');
  }
  if (mode.source_set_status !== 'READY') {
    throw new Error('Editorial mode source set is not READY');
  }
  const content = modeContent(mode);
  if (!content || !basePack?.reference_pack?.source_ledger) {
    throw new Error('Editorial ShootBible compiler is missing its verified production base pack');
  }
  const sourceCreatedAt = basePack.reference_pack.source_ledger.created_at;
  const bible = {
    schema_version: EDITORIAL_SCHEMA_VERSION,
    bible_id: `bible_${mode.preset_id.replaceAll('.', '_')}_${mode.version.replaceAll('.', '_')}`,
    mode_id: mode.preset_id,
    mode_version: mode.version,
    title: content.title,
    visual_system: mode.visual_system,
    source_references: bibleSourceReferences(basePack),
    shots: EDITORIAL_SHOT_SLOTS.map((slot) => shotSpec(mode, slot)),
    created_at: sourceCreatedAt,
  };
  return validateEditorialShootBible(bible);
}

function referenceAsset(referenceId, role, document) {
  const data = sceneCanonicalJsonBytes(document);
  return {
    reference_id: referenceId,
    role,
    media_type: 'application/json',
    data,
    sha256: sha256(data),
    not_authority_for: ['identity', 'body', 'hair', 'outfit'],
  };
}

function compiledReferenceAssets({ presetId, modeId, shotSpec: shot, basePack }) {
  const mode = modeContent(basePack.create_universe_mode ?? { preset_id: modeId });
  const slot = SLOT_CONTENT[shot.slot];
  const basePreset = basePack.preset;
  const palette = unique(
    mode.palette.split(',').map((item) => item.trim()),
    12,
  );
  const createUniverseAssets = basePack.create_universe_assets;
  if (Array.isArray(createUniverseAssets)) {
    const byRole = new Map(createUniverseAssets.map((asset) => [asset.role, asset]));
    const required = [
      ['environment_anchor', 'environment'],
      ['lighting_anchor', 'colour_grade'],
      ['composition_anchor', 'camera_lens'],
      ['palette_anchor', 'garment_behaviour'],
      ['negative_reference', 'blocking'],
    ];
    return required.map(([role, sourceRole]) => {
      const asset = byRole.get(sourceRole);
      if (!asset) throw new Error(`Create Universe unit is missing ${sourceRole}`);
      return {
        reference_id: `${presetId}.${role}`,
        role,
        media_type: 'image/png',
        data: Buffer.from(asset.data),
        sha256: asset.sha256,
        not_authority_for: ['identity', 'body', 'hair', 'outfit'],
      };
    });
  }
  const assets = [
    referenceAsset(`${presetId}.environment`, 'environment_anchor', {
      schema_version: '1.0.0',
      role: 'environment_anchor',
      facts: {
        description: shot.environment,
        spatial_cues: [
          `Compose an original ${shot.camera.framing.replaceAll('_', ' ')} fashion frame.`,
          'Keep coherent depth, grounded perspective and controlled negative space around visible item evidence.',
        ],
        materials: [...mode.materials],
        originality_rules: [
          'Invent new geometry; do not reconstruct a preview, source photograph, landmark or identifiable place.',
          'No signage, external brand, other person, vehicle or unauthorized prop.',
        ],
      },
    }),
    referenceAsset(`${presetId}.lighting`, 'lighting_anchor', {
      schema_version: '1.0.0',
      role: 'lighting_anchor',
      facts: {
        time_or_setup: basePreset.lighting.time_or_setup,
        key: shot.lighting.slice(0, 240),
        fill: basePreset.lighting.fill,
        finish: 'polished_editorial_gloss_without_skin_smoothing_or_hdr',
        protected_regions: [...basePreset.lighting.protected_regions],
      },
    }),
    referenceAsset(`${presetId}.composition`, 'composition_anchor', {
      schema_version: '1.0.0',
      role: 'composition_anchor',
      facts: {
        aspect_ratio: '4:5',
        lens_mm: shot.camera.lens_mm,
        camera_height: slot.height,
        subject_height_percent: [...slot.subject_height_percent],
        minimum_clear_space_percent: { ...slot.clear_space },
        max_vertical_error_deg: 1.5,
        notes: [
          shot.camera.angle,
          `Framing intent: ${shot.camera.framing}; full head required=${slot.require_full_head}; full footwear required=${slot.require_full_footwear}.`,
        ],
      },
    }),
    referenceAsset(`${presetId}.palette`, 'palette_anchor', {
      schema_version: '1.0.0',
      role: 'palette_anchor',
      facts: {
        colors: palette,
        contrast: mode.contrast,
        materials: [...mode.materials],
        notes: [
          'Apply this palette only to environment, light and grade.',
          'Preserve natural skin, natural hair color and every approved item color exactly.',
        ],
      },
    }),
    referenceAsset(`${presetId}.negative`, 'negative_reference', {
      schema_version: '1.0.0',
      role: 'negative_reference',
      facts: {
        avoid: unique([...shot.negative_constraints, ...basePreset.hard_negatives], 20),
        notes: [
          'Scene inputs never have authority for identity, body, hair or outfit.',
          'Reject invented, removed, recolored or structurally changed approved items.',
        ],
      },
    }),
  ];
  return assets;
}

function compiledPrompt({ mode, shotSpec: shot }) {
  const slot = SLOT_CONTENT[shot.slot];
  const lines = [
    'Create exactly one premium fashion editorial photograph from the immutable approved look.',
    `MODE: ${mode.ui_name_uk}`,
    `VISUAL SYSTEM: ${mode.visual_system}`,
    `SHOT SLOT: ${shot.slot}`,
    `SHOT OBJECTIVE: ${shot.objective}`,
    // The upper end of that band is not a target, it is the point where the subject
    // would start eating the clear space above the hair, so the guard has to be said out
    // loud. Stating the ceiling alone made the generator aim straight at it: three
    // consecutive interference_frame attempts measured 96.33%, 96.48% and 96.72% against
    // a 96% ceiling with only 3.67%, 3.52% and 3.28% left above the hair, failing a 4%
    // guard it was never told about in the instruction it actually reads.
    `CAMERA: ${shot.camera.lens_mm} mm; ${shot.camera.framing}; ${shot.camera.angle}; subject height ${slot.subject_height_percent.join('–')}% of frame height${slot.clear_space.above_hair > 0 ? `, and at least ${slot.clear_space.above_hair}% of frame height must stay clear above the hair` : ''}.`,
    `POSE: ${shot.pose}`,
    `LIGHT: ${shot.lighting}`,
    `ENVIRONMENT: ${shot.environment}`,
    `PALETTE: ${shot.palette}`,
    `IDENTITY VISIBILITY: ${shot.identity_visibility}`,
    `ITEM EVIDENCE: ${shot.item_evidence.join(' | ')}`,
    ...(shot.optical_device ? [`ONE OPTICAL DEVICE: ${shot.optical_device}`] : []),
    `BLOCKING NEGATIVES: ${shot.negative_constraints.join(' | ')}`,
    'The named editorial pages are style observations only. Do not copy their people, bodies, hair, clothing, brands, readable text or exact architecture.',
    'The attached approved look is the sole authority for identity, body, hair and every product detail.',
    'Return one original 1024x1280 sRGB 4:5 PNG composition with no text overlay.',
  ];
  return `${lines.join('\n')}\n`;
}

export function compileEditorialShotPack({
  mode,
  basePack,
  shotSpec: shot,
}) {
  if (!mode || !READY_EDITORIAL_MODE_IDS.includes(mode.preset_id)
    || mode.source_set_status !== 'READY') {
    throw new Error('Only a READY editorial mode can compile a production shot pack');
  }
  if (!shot || !EDITORIAL_SHOT_SLOTS.includes(shot.slot)) {
    throw new Error('Editorial shot pack requires one canonical shot slot');
  }
  const modeId = mode.preset_id;
  const presetId = `${modeId}.${shot.slot}`;
  const version = mode.version;
  const slot = SLOT_CONTENT[shot.slot];
  const assets = compiledReferenceAssets({
    presetId,
    modeId,
    shotSpec: shot,
    basePack,
  });
  const baseLedger = basePack.reference_pack.source_ledger;
  const sourceLedger = {
    ...structuredClone(baseLedger),
    ledger_id: `ledger.${presetId}.v1`,
    preset_id: presetId,
    preset_version: version,
  };
  const preset = {
    preset_id: presetId,
    version,
    family: 'editorial',
    ui_name_uk: `${mode.ui_name_uk} — ${shot.title}`,
    source_authorities: structuredClone(basePack.preset.source_authorities),
    style_observations: styleObservations(mode),
    environment: shot.environment,
    lighting: {
      ...structuredClone(basePack.preset.lighting),
      key: shot.lighting,
    },
    camera: {
      aspect_ratio: '4:5',
      lens_mm: shot.camera.lens_mm,
      height: slot.height,
      framing: shot.camera.framing,
      // The band is read from the canonical slot lock rather than from this
      // ShootBible's own camera declaration, for the same reason the clear-space and
      // visibility locks always were: a bible is frozen and hash-bound at shoot
      // creation, so sourcing a contract-owned lock from it meant that widening the
      // lock made every persisted bible unshootable — 'Resolved editorial camera does
      // not match its canonical framing lock' — instead of repairing the very shots it
      // was widened for. The bible keeps recording the band it was compiled with.
      subject_height_percent: [...slot.subject_height_percent],
      minimum_clear_space_percent: { ...slot.clear_space },
      max_vertical_error_deg: 1.5,
      required_visibility: {
        full_head: slot.require_full_head,
        full_footwear: slot.require_full_footwear,
      },
    },
    palette: unique(modeContent(mode).palette.split(',').map((item) => item.trim()), 6),
    hard_negatives: unique([...shot.negative_constraints, ...basePack.preset.hard_negatives], 20),
    prompt_path: `prompts/scenes/${presetId}.txt`,
    mvp_assets: ['mood_card'],
    post_selection_assets: ['environment_plate', 'lighting_preview'],
    editorial: {
      mode_id: modeId,
      mode_version: version,
      shot_slot: shot.slot,
      shot_spec_sha256: editorialShotSpecSha256(shot),
      base_preset_id: basePack.preset.preset_id,
      base_preset_version: basePack.preset.version,
      identity_visibility: shot.identity_visibility,
      item_scope: shot.slot === 'material_or_accessory_detail'
        ? 'FIRST_ORDERED_ITEM'
        : ['sculptural_three_quarter', 'interference_frame'].includes(shot.slot)
        ? 'EXCLUDE_FOOTWEAR'
        : 'ALL',
    },
  };
  const presetBytes = sceneCanonicalJsonBytes(preset);
  const prompt = compiledPrompt({ mode, shotSpec: shot });
  const promptBytes = Buffer.from(prompt);
  const references = assets.map((asset) => ({
    reference_id: asset.reference_id,
    role: asset.role,
    sha256: asset.sha256,
    media_type: asset.media_type,
    not_authority_for: [...asset.not_authority_for],
  }));
  const referencePack = {
    schema_version: '1.0.0',
    reference_pack_id: `pack.${presetId}.v1.1`,
    version: basePack.create_universe_assets ? '1.0.0' : '1.1.0',
    preset_id: presetId,
    preset_version: version,
    preset_sha256: sha256(presetBytes),
    prompt_sha256: sha256(promptBytes),
    references,
    source_ledger: sourceLedger,
  };
  const referencePackBytes = sceneCanonicalJsonBytes(referencePack);
  const reference = {
    preset_id: presetId,
    preset_version: version,
    preset_sha256: sha256(presetBytes),
    reference_pack_id: referencePack.reference_pack_id,
    reference_pack_version: referencePack.version,
    reference_pack_sha256: sha256(referencePackBytes),
    prompt_sha256: sha256(promptBytes),
  };
  return {
    preset,
    preset_bytes: presetBytes,
    prompt,
    reference_pack: referencePack,
    reference_pack_bytes: referencePackBytes,
    assets,
    reference,
    fingerprint: sha256(editorialCanonicalJsonBytes({
      mode_id: modeId,
      mode_version: version,
      shot_spec_sha256: editorialShotSpecSha256(shot),
      reference,
    })),
  };
}
