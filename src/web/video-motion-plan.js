// The four canonical motion modes from docs/VIDEO_LIVE_CANON_UA.md, turned into
// something a machine can enforce instead of a paragraph a prompt can ignore.
//
// Each mode owns its duration window and its own prompt body. The body never
// names an aspect, a duration or a resolution — those are provider parameters,
// and the transport refuses a prompt that mentions them.

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

// Stated once, appended to every plan. These are the canon's inviolable locks,
// and they are the difference between a fashion clip and a different person in
// similar clothes.
const LOCKS = [
  'Identity, hair, silhouette and the approved look are locked: the person and every approved garment stay exactly as they are in the attached source frame.',
  'Colour, material and placement of every approved item are locked. No garment is added, removed, restyled or rebranded.',
  'No new props, no text, no logos beyond those already on the approved garment.',
  'No anatomy defects, no extra fingers, no melted hands, no face drift.',
].join(' ');

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
  sourceCapabilities = {},
  styleNote = null,
} = {}) {
  const mode = motionMode(modeId);

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
    styleNote ? styleNote.trim() : null,
    LOCKS,
  ].filter(Boolean).join(' ');

  return { mode: mode.id, title: mode.title, durationSeconds: seconds, prompt };
}
