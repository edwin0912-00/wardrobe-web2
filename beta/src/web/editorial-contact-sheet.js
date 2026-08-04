import {
  EDITORIAL_SHOOT_STATES,
  EDITORIAL_SHOT_SLOTS,
  EDITORIAL_SHOT_STATES,
  canonicalJsonBytes,
  isEditorialSha256,
  sha256,
} from './editorial-shoot-contract.js';

export const CONTACT_SHEET_NOT_READY = 'EDITORIAL_CONTACT_SHEET_NOT_READY';
const CONTACT_SHEET_SCHEMA_VERSION = '1.0.0';
const PUBLIC_EDITORIAL_SHOT_SLOTS = EDITORIAL_SHOT_SLOTS.filter(
  (slot) => slot !== 'clean_identity_hero',
);

export class EditorialContactSheetError extends Error {
  constructor(message = 'Contact sheet is available only after the internal identity check and five delivered frames are approved') {
    super(message);
    this.name = 'EditorialContactSheetError';
    this.statusCode = 409;
    this.code = CONTACT_SHEET_NOT_READY;
  }
}

function unavailable() {
  throw new EditorialContactSheetError();
}

function approvedFrame(shootId, slot, shot) {
  const output = shot?.output;
  if (shot?.status !== EDITORIAL_SHOT_STATES.APPROVED
    || !output
    || !isEditorialSha256(output.sha256)
    || !isEditorialSha256(output.receipt_sha256)
    || !Number.isInteger(output.width)
    || output.width < 1
    || !Number.isInteger(output.height)
    || output.height < 1
    || output.media_type !== 'image/png') {
    unavailable();
  }
  const encodedShootId = encodeURIComponent(shootId);
  const encodedSlot = encodeURIComponent(slot);
  return {
    slot,
    output_sha256: output.sha256,
    receipt_sha256: output.receipt_sha256,
    width: output.width,
    height: output.height,
    media_type: output.media_type,
    image_url: `/api/profile/editorial-shoots/${encodedShootId}/shots/${encodedSlot}/image`,
    download_url: `/api/profile/editorial-shoots/${encodedShootId}/shots/${encodedSlot}/download`,
  };
}

/**
 * Produces the only public contact-sheet projection of a completed editorial shoot.
 *
 * The shoot service and persisted schema own QA and approval semantics. This layer
 * consumes their terminal state, reorders frames from the canonical slot list, and
 * intentionally omits resource IDs, paths, execution keys, and runtime metadata.
 */
export function createEditorialContactSheetManifest(shoot) {
  if (!shoot
    || shoot.status !== EDITORIAL_SHOOT_STATES.COMPLETED
    || typeof shoot.shoot_id !== 'string'
    || !isEditorialSha256(shoot.bindings?.approved_look?.image_sha256)
    || !isEditorialSha256(shoot.bindings?.shoot_bible?.sha256)
    || typeof shoot.bindings?.shoot_bible?.mode_id !== 'string'
    || typeof shoot.bindings?.shoot_bible?.mode_version !== 'string'
    || !Array.isArray(shoot.shots)
    || shoot.shots.length !== EDITORIAL_SHOT_SLOTS.length) {
    unavailable();
  }

  const bySlot = new Map();
  for (const shot of shoot.shots) {
    if (!shot || typeof shot.slot !== 'string' || bySlot.has(shot.slot)) unavailable();
    bySlot.set(shot.slot, shot);
  }
  if (bySlot.size !== EDITORIAL_SHOT_SLOTS.length
    || [...bySlot.keys()].some((slot) => !EDITORIAL_SHOT_SLOTS.includes(slot))) {
    unavailable();
  }
  const approvedBySlot = new Map(
    EDITORIAL_SHOT_SLOTS.map(
      (slot) => [slot, approvedFrame(shoot.shoot_id, slot, bySlot.get(slot))],
    ),
  );

  const core = {
    schema_version: CONTACT_SHEET_SCHEMA_VERSION,
    shoot_id: shoot.shoot_id,
    status: EDITORIAL_SHOOT_STATES.COMPLETED,
    approved_look_sha256: shoot.bindings.approved_look.image_sha256,
    shoot_bible: {
      mode_id: shoot.bindings.shoot_bible.mode_id,
      mode_version: shoot.bindings.shoot_bible.mode_version,
      sha256: shoot.bindings.shoot_bible.sha256,
    },
    // clean_identity_hero is a production identity gate, not one of the five
    // photographs the customer bought. It remains hash-bound in shoot state but
    // never appears in this public contact-sheet projection.
    frames: PUBLIC_EDITORIAL_SHOT_SLOTS.map(
      (slot) => approvedBySlot.get(slot),
    ),
  };
  return {
    ...core,
    manifest_sha256: sha256(canonicalJsonBytes(core)),
  };
}
