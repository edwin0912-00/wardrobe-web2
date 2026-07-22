import { invariant } from './errors.mjs';

export const REFERENCE_DECISION = Object.freeze({
  READY: 'READY',
  REPAIRABLE: 'REPAIRABLE',
  NEEDS_INPUT: 'NEEDS_INPUT',
  INCOMPATIBLE: 'INCOMPATIBLE',
});

const FRAME_VISIBILITY = Object.freeze({
  HEADSHOT: new Set(['HEADWEAR', 'EYEWEAR', 'JEWELRY']),
  HALF_BODY: new Set(['HEADWEAR', 'EYEWEAR', 'JEWELRY', 'ACCESSORY', 'TOP', 'OUTERWEAR', 'DRESS']),
  FULL_BODY: new Set(['HEADWEAR', 'EYEWEAR', 'JEWELRY', 'ACCESSORY', 'TOP', 'OUTERWEAR', 'DRESS', 'BOTTOM', 'FOOTWEAR']),
});

function issueCodes(issues) {
  return (issues ?? []).map((entry) => typeof entry === 'string' ? entry : entry.code);
}

function actionsFrom(issues) {
  return [...new Set((issues ?? [])
    .map((entry) => typeof entry === 'object' ? entry.repair : null)
    .filter(Boolean))];
}

function hasPath(object, path) {
  const value = path.split('.').reduce((current, key) => current?.[key], object);
  return value !== undefined && value !== null && value !== false;
}

function result(decision, reasons, actions = []) {
  return {
    decision,
    reasons: [...new Set(reasons)],
    actions: [...new Set(actions)],
    terminal: [REFERENCE_DECISION.NEEDS_INPUT, REFERENCE_DECISION.INCOMPATIBLE].includes(decision),
  };
}

/**
 * Routes already measured technical and semantic evidence. It never runs a VLM
 * or silently fills missing evidence.
 */
export function decideReferenceReadiness({
  kind,
  assessment,
  evidence = {},
  requirements = {},
}) {
  invariant(['HUMAN', 'GARMENT', 'QUALITY_SAMPLE'].includes(kind), 'INVALID_REFERENCE_KIND', 'Unsupported reference kind.');
  invariant(assessment && typeof assessment === 'object', 'MISSING_ASSESSMENT', 'assessment is required.');

  const targetFraming = requirements.targetFraming?.toUpperCase();
  const category = evidence.category?.toUpperCase();
  if (kind === 'GARMENT' && targetFraming && category) {
    const visible = requirements.visibleGarmentCategories
      ? new Set(requirements.visibleGarmentCategories.map((value) => value.toUpperCase()))
      : FRAME_VISIBILITY[targetFraming];
    if (visible && !visible.has(category)) {
      return result(REFERENCE_DECISION.INCOMPATIBLE, [
        `GARMENT_${category}_NOT_VISIBLE_IN_${targetFraming}`,
      ], ['CHANGE_TARGET_FRAMING_OR_REFERENCE']);
    }
  }

  const requiredEvidence = requirements.requiredEvidence ?? [];
  const missingEvidence = requiredEvidence.filter((path) => !hasPath(evidence, path));
  if (requirements.requiresBodyProportions) {
    const visibility = evidence.bodyVisibility?.toUpperCase();
    if (!visibility || visibility === 'NONE') missingEvidence.push('bodyVisibility');
    else if (visibility === 'PARTIAL' && !requirements.allowPartialBodyEvidence) {
      missingEvidence.push('fullBodyProportionEvidence');
    }
  }
  if (missingEvidence.length > 0) {
    return result(
      REFERENCE_DECISION.NEEDS_INPUT,
      missingEvidence.map((field) => `MISSING_EVIDENCE:${field}`),
      ['REQUEST_ADDITIONAL_REFERENCE'],
    );
  }

  const fatalCodes = issueCodes(assessment.fatal_issues);
  if (fatalCodes.length > 0) {
    return result(REFERENCE_DECISION.NEEDS_INPUT, fatalCodes, ['REQUEST_HIGHER_QUALITY_REFERENCE']);
  }

  const riskCodes = issueCodes(assessment.risks);
  if (requirements.requiresExactDetail && riskCodes.includes('RESOLUTION_TARGET_UNREACHABLE')) {
    return result(
      REFERENCE_DECISION.NEEDS_INPUT,
      ['EXACT_DETAIL_UNSUPPORTED_BY_RESOLUTION'],
      ['REQUEST_HIGHER_RESOLUTION_REFERENCE'],
    );
  }

  const repairReasons = issueCodes(assessment.repairable_issues);
  const repairActions = actionsFrom(assessment.repairable_issues);
  if (kind === 'GARMENT' && requirements.requireIsolatedGarment && !evidence.isIsolated) {
    if (evidence.alphaMaskAvailable || evidence.bbox) {
      repairReasons.push('GARMENT_REQUIRES_LOCAL_ISOLATION');
      repairActions.push(evidence.alphaMaskAvailable ? 'APPLY_ALPHA_MASK' : 'CREATE_BBOX_REFERENCE_CROP');
    } else {
      return result(
        REFERENCE_DECISION.NEEDS_INPUT,
        ['MISSING_GARMENT_ALPHA_OR_BBOX'],
        ['REQUEST_ALPHA_MASK_OR_BBOX'],
      );
    }
  }
  if (repairReasons.length > 0) {
    return result(REFERENCE_DECISION.REPAIRABLE, repairReasons, repairActions);
  }

  return result(REFERENCE_DECISION.READY, ['ALL_REQUIRED_EVIDENCE_AND_TECHNICAL_GATES_PASS']);
}
