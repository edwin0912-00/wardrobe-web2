import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { EDITORIAL_SHOT_SLOTS } from './editorial-shoot-contract.js';
import { editorialFramingLock, sha256 } from './scene-contract.js';

export const EDITORIAL_BLOCKING_VERSION = 'v1';

export const EDITORIAL_BLOCKING_DIRECTORY = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'assets',
  'editorial-blocking',
  EDITORIAL_BLOCKING_VERSION,
);

// Bytes and manifest are cached; the drawn-facts comparison below never is, because it
// is the only thing in here that depends on the shot being served.
const diagrams = new Map();

async function verifiedDiagram(slot) {
  const cached = diagrams.get(slot);
  if (cached) return cached;
  const manifest = JSON.parse(await readFile(path.join(EDITORIAL_BLOCKING_DIRECTORY, 'index.json'), 'utf8'));
  if (manifest?.schema_version !== '1.0.0' || manifest.asset_role !== 'blocking_topdown') {
    throw new Error('Editorial blocking manifest does not declare the blocking_topdown asset role');
  }
  const declared = manifest.diagrams?.find((item) => item?.slot === slot);
  if (!declared || declared.media_type !== 'image/png') {
    throw new Error(`Editorial blocking manifest has no PNG diagram for ${slot}`);
  }
  if (declared.file !== `assets/editorial-blocking/${EDITORIAL_BLOCKING_VERSION}/${slot}.png`) {
    throw new Error(`Editorial blocking diagram for ${slot} is declared at an unexpected path`);
  }
  const data = await readFile(path.join(EDITORIAL_BLOCKING_DIRECTORY, `${slot}.png`));
  if (sha256(data) !== declared.sha256) {
    throw new Error(`Editorial blocking diagram for ${slot} does not match its declared SHA-256`);
  }
  const diagram = { declared, data };
  diagrams.set(slot, diagram);
  return diagram;
}

/**
 * The one hash-bound blocking diagram for a fixed editorial slot.
 *
 * Six slots, six diagrams, drawn once from the declared slot fields and reused by
 * every shoot — which is why they can live in the asset tree at all instead of being
 * regenerated per request. The catch is that the numbers are drawn INTO the pixels:
 * lettered "SUBJ HEIGHT 50-94%" and "LENS 50 MM" cannot be recompiled the way a
 * structured composition_anchor can. So when a framing lock moves — and these have
 * moved repeatedly — the diagram becomes a picture of the old contract while still
 * passing every hash check, and the request then carries a prose camera line and a
 * drawing that disagree. That is what this refuses: the manifest restates every drawn
 * number, and a slot whose lock or lens has since changed stops shipping its diagram
 * rather than conditioning on a stale one.
 */
export async function editorialBlockingReference({ shotSpec }) {
  const slot = shotSpec?.slot;
  if (!EDITORIAL_SHOT_SLOTS.includes(slot)) {
    throw new Error('Editorial blocking diagram requires one canonical shot slot');
  }
  const { declared, data } = await verifiedDiagram(slot);
  const lock = editorialFramingLock(slot);
  const expected = {
    lens_mm: shotSpec.camera?.lens_mm,
    framing: shotSpec.camera?.framing,
    subject_height_percent: [...lock.subject],
    minimum_clear_space_percent: { above_hair: lock.above, below_footwear: lock.below },
    require_full_head: lock.head,
    require_full_footwear: lock.footwear,
  };
  if (JSON.stringify(declared.drawn_facts) !== JSON.stringify(expected)) {
    throw new Error(`Editorial blocking diagram ${slot} no longer states the lock it was drawn from`);
  }
  return {
    role: 'blocking_topdown',
    reference_id: `blocking.${EDITORIAL_BLOCKING_VERSION}.${slot}`,
    media_type: 'image/png',
    sha256: declared.sha256,
    data,
  };
}
