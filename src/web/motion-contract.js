// The rules of a motion job that a JSON schema cannot express, and the route that
// decides which model runs it.
//
// Everything here is a measurement from 2026-07-27, not a preference. Each rule
// carries the failure it prevents, because every one of them was learned by
// spending credits and getting a defect back.
//
// The server never calls a provider. It emits a job, an MCP-capable agent fulfils
// it, and the receipt comes back here to be checked against what was asked. That
// boundary exists because Higgsfield and Magnific are reached over MCP only, and an
// MCP session belongs to an agent, not to a long-running web process.

import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, '..', '..', 'schemas', 'motion-job.schema.json');

export const MOTION_SCHEMA = JSON.parse(readFileSync(schemaPath, 'utf8'));

// Ordinary backgrounds go to Omni; art and fashion shoots go to Seedance. Operator
// decision, taken on measured behaviour: Omni is the more realistic of the two and
// is the only one that executes a written shot list in the order given, while
// Seedance carries the energy of a supplied reference clip and ignores shot order.
export const ROUTE_BY_SCENE_KIND = Object.freeze({
  standard_background: 'gemini-omni-preview',
  art_fashion_shoot: 'bytedance-seedance-pro-2.0',
});

// Per-model ceilings, read off the provider catalogue rather than assumed. Omni also
// caps a video reference at three seconds, which is why a long reference has to be
// trimmed for it and not merely passed through.
export const MODEL_LIMITS = Object.freeze({
  'gemini-omni-preview': Object.freeze({
    maxDurationSeconds: 10,
    resolutions: Object.freeze(['720p']),
    maxVideoReferenceSeconds: 3,
    honoursShotList: true,
  }),
  'bytedance-seedance-pro-2.0': Object.freeze({
    maxDurationSeconds: 15,
    resolutions: Object.freeze(['720p', '1080p']),
    maxVideoReferenceSeconds: 15,
    honoursShotList: false,
  }),
});

// A reference whose role is the person, their garment or a part of either must be a
// cut-out on flat white. One delivered frame that carried its own environment moved
// half a fifteen-second reel into a garden that appeared in no prompt and in no
// video reference — it was the only environment in the pack and that was enough.
const PERSON_ROLES = new Set(['identity', 'face', 'garment_detail', 'footwear_detail', 'hem_detail']);

// `validateFormats: false` matches every other Ajv instance in this codebase. Formats
// are documentation here; the fields that must actually hold a shape — hashes, ids —
// are pinned by pattern, which Ajv does enforce.
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validateSchema = ajv.compile(MOTION_SCHEMA);

export function routeForSceneKind(sceneKind) {
  const slug = ROUTE_BY_SCENE_KIND[sceneKind];
  if (!slug) throw new Error(`Unknown scene kind: ${sceneKind}`);
  return slug;
}

/**
 * Every defect in a motion job, as a list of codes. An empty list means the job may
 * be sent. Returning all of them rather than throwing on the first keeps a caller
 * from fixing one problem per round trip.
 */
export function motionJobDefects(job) {
  const defects = [];
  if (!validateSchema(job)) {
    for (const error of validateSchema.errors ?? []) {
      defects.push({ code: 'SCHEMA_INVALID', detail: `${error.instancePath || '/'} ${error.message}` });
    }
    // A job that fails the schema cannot be reasoned about field by field.
    return defects;
  }

  const expected = ROUTE_BY_SCENE_KIND[job.source.scene_kind];
  if (job.route.model_slug !== expected) {
    defects.push({
      code: 'ROUTE_DOES_NOT_MATCH_SCENE_KIND',
      detail: `${job.source.scene_kind} routes to ${expected}, not ${job.route.model_slug}`,
    });
  }

  const limits = MODEL_LIMITS[job.route.model_slug];
  if (job.delivery.duration_seconds > limits.maxDurationSeconds) {
    defects.push({
      code: 'DURATION_ABOVE_MODEL_CEILING',
      detail: `${job.route.model_slug} stops at ${limits.maxDurationSeconds}s, job asks ${job.delivery.duration_seconds}s`,
    });
  }
  if (!limits.resolutions.includes(job.delivery.resolution)) {
    defects.push({
      code: 'RESOLUTION_UNSUPPORTED_BY_MODEL',
      detail: `${job.route.model_slug} delivers ${limits.resolutions.join(', ')}`,
    });
  }

  // A shot list on a model that ignores it is not a small waste — it is a promise to
  // the caller that the delivery will not keep.
  if ((job.route.shot_list?.length ?? 0) > 0 && !limits.honoursShotList) {
    defects.push({
      code: 'SHOT_LIST_IGNORED_BY_MODEL',
      detail: `${job.route.model_slug} produces its own shot order; move the list to the other route or drop it`,
    });
  }

  if (job.source.scene_kind === 'art_fashion_shoot' && !job.source.style_unit_id) {
    defects.push({ code: 'STYLE_UNIT_REQUIRED', detail: 'an art fashion shoot names the shoot whose world it lives in' });
  }

  for (const [index, reference] of job.references.entries()) {
    const at = `references[${index}]`;
    if (PERSON_ROLES.has(reference.role) && reference.background_free !== true) {
      defects.push({
        code: 'PERSON_REFERENCE_CARRIES_BACKGROUND',
        detail: `${at} role ${reference.role} must be a cut-out on flat white`,
      });
    }
    if (reference.role === 'environment_motion') {
      if (reference.kind !== 'video') {
        defects.push({ code: 'ENVIRONMENT_MOTION_MUST_BE_VIDEO', detail: at });
      }
      if (reference.excludes_foreign_footwear !== true) {
        defects.push({
          code: 'REFERENCE_CLIP_KEEPS_FOREIGN_FOOTWEAR',
          detail: `${at} must have the supplied clip's own footwear close-ups cut out`,
        });
      }
      if (Number.isFinite(reference.seconds) && reference.seconds > limits.maxVideoReferenceSeconds) {
        defects.push({
          code: 'VIDEO_REFERENCE_ABOVE_MODEL_CEILING',
          detail: `${job.route.model_slug} takes at most ${limits.maxVideoReferenceSeconds}s of reference clip`,
        });
      }
    }
  }

  const roles = new Set(job.references.map((reference) => reference.role));
  if (!roles.has('identity')) {
    defects.push({ code: 'IDENTITY_REFERENCE_MISSING', detail: 'nothing in the pack carries who she is' });
  }
  // A reference holds only what it resolves. Footwear occupied about 150 soft pixels
  // in a full-length frame while a stranger's sandal filled 700 sharp ones, and the
  // stranger's leg is what arrived. Any reel can reveal feet, so the detail is not
  // optional.
  if (!roles.has('footwear_detail')) {
    defects.push({
      code: 'FOOTWEAR_DETAIL_REFERENCE_MISSING',
      detail: 'a reel can always reveal feet, and a full-length frame cannot hold footwear at close-shot scale',
    });
  }

  return defects;
}

export function assertMotionJob(job) {
  const defects = motionJobDefects(job);
  if (defects.length) {
    const error = new Error(`Motion job is not deliverable: ${defects.map((d) => d.code).join(', ')}`);
    error.code = 'MOTION_JOB_INVALID';
    error.defects = defects;
    throw error;
  }
  return job;
}

/**
 * Check a fulfilled receipt against what the job asked for. The provider is trusted
 * to return bytes and nothing else: the delivered geometry and duration are measured
 * from the file by the caller and compared here.
 */
export function receiptDefects(job, receipt) {
  const defects = [];
  if (!receipt) return [{ code: 'RECEIPT_MISSING', detail: 'the job has not been fulfilled' }];
  if (receipt.width !== 1080 || receipt.height !== 1920) {
    defects.push({
      code: 'DELIVERED_GEOMETRY_NOT_VERTICAL',
      detail: `${receipt.width}x${receipt.height} is not the 1080x1920 delivery`,
    });
  }
  const asked = job.delivery.duration_seconds;
  // Providers land a little either side of the requested length; half a second is the
  // tolerance measured across every clip produced on 2026-07-27.
  if (!(Math.abs(receipt.duration_seconds - asked) <= 0.5)) {
    defects.push({
      code: 'DELIVERED_DURATION_OFF_TARGET',
      detail: `asked ${asked}s, got ${receipt.duration_seconds}s`,
    });
  }
  if (job.audio.source === 'muxed_in_post' && receipt.audio_replaced !== true) {
    defects.push({
      code: 'MODEL_AUDIO_WOULD_SHIP',
      detail: 'the job declares a muxed track, so the invented audio must have been replaced',
    });
  }
  return defects;
}
