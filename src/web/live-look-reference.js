import sharp from 'sharp';

import { GARMENT_CATEGORIES } from './garment-passport.js';
import { normalizeWhitePngBytes } from '../qa/white-normalizer.mjs';
import { sha256 } from './scene-contract.js';

// The Live mirror needs a garment-only reference. The person arrives on the
// camera track, so putting a person into the reference is not a nicety: it
// contradicts the prompt the mirror sends and it hands the provider a second,
// competing identity. What the pipeline already holds is better — every approved
// item exists as a hash-verified RGBA cutout with its background removed by
// removeBorderConnectedWhiteToAlpha, re-verified byte for byte inside
// runService.approvedItemEvidenceForRun before it is handed out.
//
// This module composites those verified bytes into one card and nothing else. It
// invents no pixels: every non-white pixel it writes came out of a cutout whose
// sha256 was already checked, the layout is a pure function of item order, and
// the finished card carries its own sha256 so a consumer can bind to it.

export const LIVE_REFERENCE_WIDTH = 1024;
export const LIVE_REFERENCE_HEIGHT = 1024;
const CARD_PADDING = 48;
const CELL_GAP = 24;

// The same bar the editorial coda already enforces in scene-service.js, spelled
// once here so the two cannot drift apart silently. `one_piece` legitimately
// replaces top plus bottom, which the coda rule does not yet allow for.
export const LIVE_REQUIRED_CATEGORY_GROUPS = Object.freeze([
  Object.freeze(['top', 'one_piece']),
  Object.freeze(['bottom', 'one_piece']),
  Object.freeze(['footwear']),
]);

export class LiveLookReferenceError extends Error {
  constructor(message, { code = 'LIVE_REFERENCE_INVALID', status = 422 } = {}) {
    super(message);
    this.name = 'LiveLookReferenceError';
    this.code = code;
    this.status = status;
  }
}

function assertEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new LiveLookReferenceError('Approved item evidence is required');
  }
  if (evidence.kind !== 'APPROVED_ITEM_EVIDENCE') {
    throw new LiveLookReferenceError(
      `Expected APPROVED_ITEM_EVIDENCE, received ${String(evidence.kind)}`,
    );
  }
  if (!Array.isArray(evidence.items) || evidence.items.length === 0) {
    throw new LiveLookReferenceError(
      'Approved item evidence carries no items',
      { code: 'LIVE_REFERENCE_NO_ITEMS' },
    );
  }
}

function assertItem(item, index) {
  const label = `item ${index + 1}`;
  if (!GARMENT_CATEGORIES.includes(item?.category)) {
    throw new LiveLookReferenceError(`${label} has an unknown category: ${String(item?.category)}`);
  }
  if (!Number.isInteger(item.order) || item.order < 0) {
    throw new LiveLookReferenceError(`${label} has no ordered position`);
  }
  if (item.media_type !== 'image/png') {
    throw new LiveLookReferenceError(`${label} is not PNG: ${String(item.media_type)}`);
  }
  if (!Buffer.isBuffer(item.data) && !(item.data instanceof Uint8Array)) {
    throw new LiveLookReferenceError(`${label} carries no cutout bytes`);
  }
  const bytes = Buffer.from(item.data);
  // The evidence producer already checked this hash. Checking it again here is
  // cheap and means this module cannot be handed swapped bytes by a future caller
  // that skipped the producer.
  if (sha256(bytes) !== item.sha256) {
    throw new LiveLookReferenceError(
      `${label} bytes do not match their declared sha256`,
      { code: 'LIVE_REFERENCE_HASH_MISMATCH', status: 409 },
    );
  }
  return bytes;
}

function assertCompleteness(categories, requiredGroups) {
  const missing = requiredGroups
    .filter((group) => !group.some((category) => categories.has(category)))
    .map((group) => group.join(' or '));
  if (missing.length) {
    throw new LiveLookReferenceError(
      `Live needs a complete locked look; missing: ${missing.join(', ')}`,
      { code: 'LIVE_REFERENCE_INCOMPLETE_LOOK' },
    );
  }
}

// Deterministic: cell count and therefore every cell rectangle follow only from
// how many items the look has, so the same look always composites to the same
// bytes and the same sha256.
function planCells(count) {
  const columns = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / columns);
  const usableWidth = LIVE_REFERENCE_WIDTH - (CARD_PADDING * 2) - (CELL_GAP * (columns - 1));
  const usableHeight = LIVE_REFERENCE_HEIGHT - (CARD_PADDING * 2) - (CELL_GAP * (rows - 1));
  const cellWidth = Math.floor(usableWidth / columns);
  const cellHeight = Math.floor(usableHeight / rows);
  if (cellWidth < 1 || cellHeight < 1) {
    throw new LiveLookReferenceError('Too many items to lay out on one reference card');
  }
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      left: CARD_PADDING + (column * (cellWidth + CELL_GAP)),
      top: CARD_PADDING + (row * (cellHeight + CELL_GAP)),
      width: cellWidth,
      height: cellHeight,
    };
  });
}

export async function buildLiveLookReferenceCard(evidence, {
  requiredCategoryGroups = LIVE_REQUIRED_CATEGORY_GROUPS,
} = {}) {
  assertEvidence(evidence);

  const ordered = [...evidence.items].sort((a, b) => a.order - b.order);
  const prepared = ordered.map((item, index) => ({ item, bytes: assertItem(item, index) }));
  assertCompleteness(new Set(prepared.map(({ item }) => item.category)), requiredCategoryGroups);

  const cells = planCells(prepared.length);
  const composites = [];
  for (const [index, { bytes }] of prepared.entries()) {
    const cell = cells[index];
    // `contain` keeps every item's own proportions; a stretched garment would be
    // a changed observable characteristic, which the conditioning canon forbids.
    const fitted = await sharp(bytes, { failOn: 'error' })
      .resize({
        width: cell.width,
        height: cell.height,
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .png()
      .toBuffer();
    composites.push({ input: fitted, left: cell.left, top: cell.top });
  }

  // Compositing RGBA cutouts promotes the canvas to four channels, so the
  // transparent margins are flattened against white here, explicitly and once.
  // That is the declared operation, not the implicit flatten the normalizer
  // refuses: the only thing behind a cutout's transparency on this card is the
  // card's own white ground.
  const flattened = await sharp({
    create: {
      width: LIVE_REFERENCE_WIDTH,
      height: LIVE_REFERENCE_HEIGHT,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(composites)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    // flatten alone still writes four channels here, and the normalizer refuses
    // an alpha channel by design, so the now-meaningless channel is dropped.
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();

  // The one deterministic enforcement point for exact #FFFFFF in this codebase.
  // Reached with an already-opaque canvas, so it never performs an implicit
  // flatten — the call it refuses.
  const normalized = await normalizeWhitePngBytes(flattened);
  const image = normalized.image;
  const metadata = await sharp(image).metadata();

  return {
    kind: 'LIVE_LOOK_REFERENCE',
    schema_version: '1.0.0',
    image,
    sha256: sha256(image),
    width: metadata.width,
    height: metadata.height,
    source_run_id: evidence.source_run_id,
    items: prepared.map(({ item }) => ({
      order: item.order,
      category: item.category,
      sha256: item.sha256,
    })),
  };
}
