// Wire-contract for the video feature. This is a pure-data module with no
// Fastify dependency: it describes what the UI needs to render the video
// creation flow (surfaces, motion modes, QA checks, locks) and nothing else.
//
// Route registration belongs to `opencloud` — this module is not imported by
// app.js. The UI team can import it directly or consume it from a GET endpoint
// that opencloud registers later.

import { MOTION_MODES, SURFACES } from './video-motion-plan.js';

/**
 * The public contract that a UI consumer needs to build the video creation
 * interface. No secrets, no internal ids, no provider details.
 */
export function videoWireContract() {
  return {
    schema_version: '1.0.0',
    product: 'fashion_video',

    surfaces: Object.values(SURFACES).map((s) => ({
      id: s.id,
      aspectRatio: s.aspectRatio,
      hint: s.hint,
    })),

    motion_modes: Object.values(MOTION_MODES).map((mode) => ({
      id: mode.id,
      title: mode.title,
      seconds: { ...mode.seconds },
      requires: [...mode.requires],
    })),

    qa_checks: [
      { id: 'duration',     title: 'Duration within mode window' },
      { id: 'aspect',       title: 'Aspect matches selected surface' },
      { id: 'no_audio',     title: 'No audio track in delivered clip' },
      { id: 'first_frame',  title: 'First frame is not black' },
      { id: 'last_frame',   title: 'Last frame is not black' },
    ],

    locks: [
      { id: 'identity',                 label: 'Identity, hair and silhouette' },
      { id: 'approved_look',            label: 'Approved look unchanged' },
      { id: 'colour_material_placement', label: 'Colour, material and placement of every item' },
      { id: 'no_new_props',             label: 'No new props, text or logos' },
      { id: 'no_anatomy_defects',       label: 'No anatomy defects' },
    ],

    // The source must always be a locked master-look, never an arbitrary image.
    source_contract: {
      required: 'approved_master_look',
      description: 'An already-approved master-look from the profile',
    },
  };
}
