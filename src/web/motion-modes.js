// The motion mode catalogue: loader, invariants a schema cannot express, and the
// public projection.
//
// A caller picks a mode id and nothing else. The model, the delivery geometry and the
// permitted reference roles are all read from here, which is what satisfies node
// VIDEO.02's ALLOWED_PRESET_ONLY gate — a request that could name its own model would
// route around every measured ceiling in the contract.

import Ajv2020 from 'ajv/dist/2020.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MODEL_LIMITS, ROUTE_BY_SCENE_KIND } from './motion-contract.js';

const defaultRoot = path.resolve(import.meta.dirname, '..', '..');

// Invariants the JSON schema cannot state, because each one is a relationship between
// the catalogue and the measured model limits rather than a property of one field.
function assertCatalogue(catalogue) {
  const seen = new Set();
  for (const mode of catalogue.modes) {
    if (seen.has(mode.id)) throw new Error(`Duplicate motion mode id: ${mode.id}`);
    seen.add(mode.id);

    // The route is a consequence of the scene kind, not an independent choice. Letting
    // a mode cross them would put an art shoot on the model that carries no reference
    // clip, or an ordinary background on the model that ignores a written shot list.
    const expected = ROUTE_BY_SCENE_KIND[mode.scene_kind];
    if (mode.route.model_slug !== expected) {
      throw new Error(
        `Motion mode ${mode.id} routes ${mode.scene_kind} to ${mode.route.model_slug}, but that scene kind belongs to ${expected}`,
      );
    }

    // A mode may not promise a delivery the model cannot reach. Discovering this after
    // the credits are spent is exactly what the contract exists to prevent.
    const limits = MODEL_LIMITS[mode.route.model_slug];
    if (mode.delivery.duration_seconds > limits.maxDurationSeconds) {
      throw new Error(
        `Motion mode ${mode.id} asks ${mode.delivery.duration_seconds}s of ${mode.route.model_slug}, which stops at ${limits.maxDurationSeconds}s`,
      );
    }
    if (!limits.resolutions.includes(mode.delivery.resolution)) {
      throw new Error(
        `Motion mode ${mode.id} asks ${mode.delivery.resolution} of ${mode.route.model_slug}, which delivers ${limits.resolutions.join(', ')}`,
      );
    }
    if (mode.shot_list === 'SUPPORTED_REQUIRES_PROMPT_ALONGSIDE'
      && limits.shotList !== 'supported_requires_prompt_alongside') {
      throw new Error(`Motion mode ${mode.id} declares a shot-list contract its model does not have`);
    }

    // Footwear is the role that was actually lost: our own shoes occupied about 150 soft
    // pixels of a full-length frame while a stranger's sandal filled 700 sharp ones, and
    // the stranger's leg is what arrived. A mode that cannot carry that detail is a mode
    // that will reproduce the defect.
    for (const required of ['identity', 'footwear_detail']) {
      if (!mode.reference_roles.includes(required)) {
        throw new Error(`Motion mode ${mode.id} omits the mandatory ${required} reference role`);
      }
    }
  }
}

export async function loadMotionModes({ projectRoot = defaultRoot } = {}) {
  const [schemaText, catalogueText] = await Promise.all([
    readFile(path.join(projectRoot, 'schemas', 'motion-modes.schema.json'), 'utf8'),
    readFile(path.join(projectRoot, 'config', 'motion-modes.json'), 'utf8'),
  ]);
  const catalogue = JSON.parse(catalogueText);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(schemaText));
  if (!validate(catalogue)) {
    const detail = (validate.errors ?? []).map((item) => `${item.instancePath || '/'} ${item.message}`).join('; ');
    throw new Error(`Invalid motion mode catalogue: ${detail}`);
  }
  assertCatalogue(catalogue);
  // Callers never share the loaded object: a mutation here would change the route of a
  // job that has already been priced.
  return structuredClone(catalogue);
}

// The HTTP surface, as an explicit allowlist. The model slug is deliberately absent —
// a client has no use for it and publishing it invites a request that names one.
export function publicMotionModes(catalogue) {
  return {
    catalog_id: catalogue.catalog_id,
    modes: catalogue.modes.map((mode) => ({
      id: mode.id,
      title: mode.title,
      description: mode.description,
      billable: mode.billable,
      duration_seconds: mode.delivery.duration_seconds,
      aspect_ratio: mode.delivery.aspect_ratio,
      resolution: mode.delivery.resolution,
    })),
  };
}

export function motionModeById(catalogue, modeId) {
  return catalogue.modes.find((mode) => mode.id === modeId) ?? null;
}
