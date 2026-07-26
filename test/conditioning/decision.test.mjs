import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decideReferenceReadiness,
  REFERENCE_DECISION,
} from '../../src/conditioning/decision.mjs';
import { ConditioningError } from '../../src/conditioning/errors.mjs';

const cleanAssessment = Object.freeze({
  fatal_issues: [],
  repairable_issues: [],
  risks: [],
});

test('READY requires all declared evidence and passing technical gates', () => {
  const routed = decideReferenceReadiness({
    kind: 'HUMAN',
    assessment: cleanAssessment,
    evidence: { faceBbox: [0.2, 0.1, 0.3, 0.3], bodyVisibility: 'FULL' },
    requirements: { requiredEvidence: ['faceBbox'], requiresBodyProportions: true },
  });
  assert.equal(routed.decision, REFERENCE_DECISION.READY);
  assert.equal(routed.terminal, false);
});

test('REPAIRABLE carries deterministic local repair actions', () => {
  const routed = decideReferenceReadiness({
    kind: 'HUMAN',
    assessment: {
      ...cleanAssessment,
      repairable_issues: [
        { code: 'EXIF_ORIENTATION_PRESENT', repair: 'AUTO_ORIENT' },
        { code: 'NON_SRGB_COLOR_SPACE', repair: 'CONVERT_TO_SRGB' },
      ],
    },
    evidence: { faceBbox: [0, 0, 0.5, 0.5] },
    requirements: { requiredEvidence: ['faceBbox'] },
  });
  assert.equal(routed.decision, REFERENCE_DECISION.REPAIRABLE);
  assert.deepEqual(routed.actions, ['AUTO_ORIENT', 'CONVERT_TO_SRGB']);
});

test('NEEDS_INPUT refuses to invent missing body-proportion evidence', () => {
  const routed = decideReferenceReadiness({
    kind: 'HUMAN',
    assessment: cleanAssessment,
    evidence: { faceBbox: [0, 0, 0.5, 0.5], bodyVisibility: 'NONE' },
    requirements: { requiredEvidence: ['faceBbox'], requiresBodyProportions: true },
  });
  assert.equal(routed.decision, REFERENCE_DECISION.NEEDS_INPUT);
  assert.match(routed.reasons[0], /^MISSING_EVIDENCE:/);
  assert.equal(routed.terminal, true);
});

test('NEEDS_INPUT blocks exact details when bounded upscale cannot reach target', () => {
  const routed = decideReferenceReadiness({
    kind: 'GARMENT',
    assessment: {
      ...cleanAssessment,
      risks: [{ code: 'RESOLUTION_TARGET_UNREACHABLE' }],
    },
    evidence: { category: 'TOP' },
    requirements: { targetFraming: 'FULL_LENGTH', requiresExactDetail: true },
  });
  assert.equal(routed.decision, REFERENCE_DECISION.NEEDS_INPUT);
  assert.deepEqual(routed.reasons, ['EXACT_DETAIL_UNSUPPORTED_BY_RESOLUTION']);
});

test('INCOMPATIBLE detects a footwear reference outside headshot framing', () => {
  const routed = decideReferenceReadiness({
    kind: 'GARMENT',
    assessment: cleanAssessment,
    evidence: { category: 'FOOTWEAR' },
    requirements: { targetFraming: 'HEADSHOT' },
  });
  assert.equal(routed.decision, REFERENCE_DECISION.INCOMPATIBLE);
  assert.deepEqual(routed.actions, ['CHANGE_TARGET_FRAMING_OR_REFERENCE']);
});

test('the full-length avatar contract keeps a footwear reference compatible', () => {
  const routed = decideReferenceReadiness({
    kind: 'GARMENT',
    assessment: cleanAssessment,
    evidence: { category: 'FOOTWEAR' },
    requirements: { targetFraming: 'FULL_LENGTH' },
  });
  assert.equal(routed.decision, REFERENCE_DECISION.READY);
});

test('a retired framing name is refused instead of skipping the compatibility gate', () => {
  assert.throws(
    () => decideReferenceReadiness({
      kind: 'GARMENT',
      assessment: cleanAssessment,
      evidence: { category: 'FOOTWEAR' },
      requirements: { targetFraming: 'HALF_BODY' },
    }),
    (error) => error instanceof ConditioningError && error.code === 'UNKNOWN_TARGET_FRAMING',
  );
});

test('opaque garment with an explicit bbox is locally repairable, not silently segmented', () => {
  const routed = decideReferenceReadiness({
    kind: 'GARMENT',
    assessment: cleanAssessment,
    evidence: { category: 'TOP', isIsolated: false, bbox: [0.1, 0.1, 0.8, 0.8] },
    requirements: { targetFraming: 'FULL_LENGTH', requireIsolatedGarment: true },
  });
  assert.equal(routed.decision, REFERENCE_DECISION.REPAIRABLE);
  assert.deepEqual(routed.reasons, ['GARMENT_REQUIRES_LOCAL_ISOLATION']);
  assert.deepEqual(routed.actions, ['CREATE_BBOX_REFERENCE_CROP']);
});
