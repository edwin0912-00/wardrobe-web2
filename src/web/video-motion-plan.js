// The four canonical motion modes from docs/VIDEO_LIVE_CANON_UA.md, turned into
// something a machine can enforce instead of a paragraph a prompt can ignore.
//
// Each mode owns its duration window and its own prompt body. The body never
// names an aspect, a duration or a resolution — those are provider parameters,
// and the transport refuses a prompt that mentions them.
//
// Surfaces (operator decision 2026-07-28): the user picks a playback surface,
// not a raw aspect ratio. `tv` → 16:9, `mirror` → 9:16. There is no free-text
// aspect field, so vertical on a TV is impossible by construction. Each surface
// carries a framing hint in words only — no digits — because digits trip the
// geometry guard in the transport.

// Where the clip plays decides its shape, so the caller picks a surface and the
// aspect follows. Operator decision, 2026-07-28: the television in the scene runs
// 16:9, the mirror runs 9:16. Exposing a free aspect field instead would make a
// vertical clip on the television a one-keystroke mistake.
export const VIDEO_SURFACES = Object.freeze({
  tv: Object.freeze({
    id: 'tv',
    title: 'Телевізор',
    aspectRatio: '16:9',
    // Never names the ratio: the transport refuses a prompt that does.
    framingNote: 'Compose for a wide landscape screen: the figure sits within the frame with air on both sides, and the horizon of the set reads across the width.',
  }),
  mirror: Object.freeze({
    id: 'mirror',
    title: 'Дзеркало',
    aspectRatio: '9:16',
    framingNote: 'Compose for a tall upright screen: the figure fills the height, the set falls away above and below, and nothing important sits near the left or right edge.',
  }),
});

export const DEFAULT_VIDEO_SURFACE = 'tv';

export function videoSurface(id = DEFAULT_VIDEO_SURFACE) {
  const surface = VIDEO_SURFACES[id];
  if (!surface) {
    throw new MotionPlanError(`Unknown video surface: ${String(id)}`, { code: 'UNKNOWN_VIDEO_SURFACE' });
  }
  return surface;
}

export const MOTION_MODES = Object.freeze({
  editorial_micro_moment: Object.freeze({
    id: 'editorial_micro_moment',
    title: 'Editorial micro-moment',
    seconds: Object.freeze({ minimum: 4, maximum: 6, default: 5 }),
    requires: Object.freeze([]),
    body: 'The subject breathes and blinks, the gaze settles, hands and fabric move only as much as breathing moves them, and stray hair drifts. The camera is effectively still.',
  }),
  camera_drift: Object.freeze({
    id: 'camera_drift',
    title: 'Camera drift',
    seconds: Object.freeze({ minimum: 5, maximum: 7, default: 6 }),
    requires: Object.freeze([]),
    body: 'One very slow camera move — a push in, a pull out, or a lateral glide — while the subject holds the pose. No cut, no speed change, no hand-held shake.',
  }),
  walk_stride: Object.freeze({
    id: 'walk_stride',
    title: 'Walk / stride',
    seconds: Object.freeze({ minimum: 5, maximum: 8, default: 6 }),
    // The canon allows this one only when the source frame actually shows the
    // legs and footwear; otherwise the model invents the half it cannot see.
    requires: Object.freeze(['full_length_source']),
    body: 'One controlled stride carried through: the rear heel lifts, the leading foot lands, the trouser hem swings forward as one mass, arms swing naturally out of phase. The full figure stays in frame.',
  }),
  garment_gesture: Object.freeze({
    id: 'garment_gesture',
    title: 'Garment gesture',
    seconds: Object.freeze({ minimum: 4, maximum: 6, default: 5 }),
    requires: Object.freeze([]),
    body: 'One single action that shows the garment: a collar adjusted, a turn to three-quarters, a sleeve moved, a bag lifted into the hand. Exactly one action, and no new item enters the frame.',
  }),
});

// Legacy alias — kept for backward compatibility with older callers
export const SURFACES = Object.freeze({
  tv: Object.freeze({
    id: 'tv',
    aspectRatio: '16:9',
    hint: 'Landscape composition for a wide screen, with generous horizontal breathing room around the subject',
  }),
  mirror: Object.freeze({
    id: 'mirror',
    aspectRatio: '9:16',
    hint: 'Portrait framing as seen in a full-length mirror, the subject fills the vertical frame',
  }),
});

// Stated once, appended to every plan. These are the canon's inviolable locks,
// and they are the difference between a fashion clip and a different person in
// similar clothes.
const LOCKS = [
  'Identity, hair, silhouette and the approved look are locked: the person and every approved garment stay exactly as they are in the attached source frame.',
  'Colour, material and placement of every approved item are locked. No garment is added, removed, restyled or rebranded.',
  'No new props, no text, no logos beyond those already on the approved garment.',
  'No anatomy defects, no extra fingers, no melted hands, no face drift.',
].join(' ');

export function buildFashionVideoReferencePrompt({
  hasIdentityReference = false,
  hasGarmentReference = false,
} = {}) {
  const lines = [
    '[Video 1] is private reference-only directing material, never delivery media.',
    'Use it only to reconstruct its complete shot sequence, cut timing, transitions, action timing, pose choreography, camera movement, framing, environment, lighting, colour grade, optical effects, props and environmental text.',
    'Every final frame must be newly generated. Never splice, reuse, reveal, freeze, picture-in-picture, reflection, monitor image, transition frame or background person from [Video 1].',
    '[Image 1] is the only permitted visible human: the exact approved person wearing the exact complete approved outfit.',
    'For every cut: if a person is visible, render [Image 1] as that person with the same identity, body, hair and complete approved outfit. If the reference cut has no person, render no person. Remove any secondary person rather than retaining a reference performer.',
    'No source performer face, body, skin, hair, clothing, silhouette or motion-blurred fragment may survive in any cut. Never mix [Image 1] with the reference performer.',
  ];
  if (hasIdentityReference) {
    lines.push(
      '[Image 2] defines face identity and hair only. Ignore its clothing and background.',
    );
  }
  if (hasGarmentReference) {
    lines.push(
      `[Image ${hasIdentityReference ? 3 : 2}] defines the approved garment and footwear construction, colour, material, pattern, hardware, logo and text only. Do not redesign any item.`,
    );
  }
  lines.push(
    'Never replace the reference environment with the background of an appearance image.',
    'Do not simplify the reference into a static portrait or a single continuous camera setup, but reconstruct every cut with the approved person or an empty environment only.',
    'Do not add people, props, scene text, wardrobe changes, music, dialogue, voice or sound effects.',
  );
  return lines.join(' ');
}

export class MotionPlanError extends Error {
  constructor(message, { code = 'MOTION_PLAN_INVALID' } = {}) {
    super(message);
    this.name = 'MotionPlanError';
    this.code = code;
  }
}

export function motionMode(id) {
  const mode = MOTION_MODES[id];
  if (!mode) {
    throw new MotionPlanError(`Unknown motion mode: ${String(id)}`, { code: 'UNKNOWN_MOTION_MODE' });
  }
  return mode;
}

export function surface(id) {
  const s = SURFACES[id];
  if (!s) {
    throw new MotionPlanError(`Unknown surface: ${String(id)}`, { code: 'UNKNOWN_SURFACE' });
  }
  return s;
}

/**
 * Build the motion plan for one clip.
 *
 * `sourceCapabilities` describes what the source frame can actually support —
 * today only `full_length` matters, and it gates walk/stride. A mode whose
 * requirement is unmet is refused here rather than discovered in the output.
 */
export function buildMotionPlan({
  modeId,
  durationSeconds,
  surface: surfaceId = DEFAULT_VIDEO_SURFACE,
  sourceCapabilities = {},
  styleNote = null,
} = {}) {
  const mode = motionMode(modeId);
  const resolvedSurface = videoSurface(surfaceId);

  if (mode.requires.includes('full_length_source') && sourceCapabilities.full_length !== true) {
    throw new MotionPlanError(
      `${mode.title} needs a source frame showing the legs and footwear`,
      { code: 'MOTION_MODE_SOURCE_MISMATCH' },
    );
  }

  const seconds = durationSeconds ?? mode.seconds.default;
  if (!Number.isInteger(seconds) || seconds < mode.seconds.minimum || seconds > mode.seconds.maximum) {
    throw new MotionPlanError(
      `${mode.title} runs ${mode.seconds.minimum}–${mode.seconds.maximum} seconds`,
      { code: 'MOTION_DURATION_OUT_OF_RANGE' },
    );
  }

  if (styleNote !== null && (typeof styleNote !== 'string' || styleNote.trim().length === 0)) {
    throw new MotionPlanError('A style note must be a non-empty string when supplied');
  }

  const prompt = [
    'Fashion motion from the attached approved frame, photoreal, one continuous shot.',
    mode.body,
    resolvedSurface.framingNote,
    styleNote ? styleNote.trim() : null,
    LOCKS,
  ].filter(Boolean).join(' ');

  return {
    mode: mode.id,
    title: mode.title,
    surface: resolvedSurface.id,
    aspectRatio: resolvedSurface.aspectRatio,
    durationSeconds: seconds,
    prompt,
  };
}
