const WAITING_STATUSES = new Set(['SUBMITTING', 'CREATED', 'GENERATING']);
const TERMINAL_FAILURE_STATUSES = new Set(['FAIL', 'FAILED']);

/**
 * Resolve one executable next step from persisted Fashion Video evidence.
 * This never changes a QA verdict: it prevents a repairable result from
 * becoming a dead-end and prevents a retry from being confused with polling.
 */
export function resolveVideoQaAction(clip, { deliverable = false } = {}) {
  if (!clip || typeof clip !== 'object') {
    return { action: 'BLOCK', reason_code: 'VIDEO_CLIP_STATE_MISSING', retry_available: false };
  }

  if (WAITING_STATUSES.has(clip.status)) {
    return { action: 'WAIT', reason_code: 'VIDEO_PROVIDER_JOB_IN_PROGRESS', retry_available: false };
  }

  if (clip.salvage?.status === 'BLOCKED') {
    return {
      action: 'REPAIR_SALVAGE_RUNTIME',
      reason_code: clip.salvage.failureCode ?? 'VIDEO_QA_SALVAGE_BLOCKED',
      retry_available: true,
    };
  }

  if (clip.salvage?.status === 'NEEDS_QA') {
    const action = clip.salvageIdentityItemQa
      ? 'RUN_REFERENCE_QA'
      : 'RUN_IDENTITY_QA';
    return { action, reason_code: 'VIDEO_QA_SALVAGE_REVIEW_REQUIRED', retry_available: false };
  }

  if (clip.status === 'NEEDS_QA') {
    if (clip.qa?.pass !== true) {
      return { action: 'RUN_TECHNICAL_QA', reason_code: 'VIDEO_TECHNICAL_QA_REQUIRED', retry_available: false };
    }
    if (clip.motionReferenceBinding && !clip.identityItemQa) {
      return { action: 'RUN_IDENTITY_QA', reason_code: 'VIDEO_IDENTITY_ITEM_QA_REQUIRED', retry_available: false };
    }
    if (clip.motionReferenceBinding && !clip.referenceAdherenceQa) {
      return { action: 'RUN_REFERENCE_QA', reason_code: 'VIDEO_REFERENCE_QA_REQUIRED', retry_available: false };
    }
    if (clip.motionReferenceBinding && clip.identityItemQa?.pass === false) {
      return { action: 'RETRY_AVAILABLE', reason_code: 'VIDEO_IDENTITY_ITEM_QA_FAILED', retry_available: true };
    }
    return { action: 'RUN_QA', reason_code: 'VIDEO_QA_INCOMPLETE', retry_available: false };
  }

  if (clip.status === 'PASS') {
    return deliverable
      ? { action: 'DELIVER', reason_code: null, retry_available: false }
      : { action: 'BLOCK', reason_code: 'VIDEO_STYLE_PROVENANCE_MISSING', retry_available: false };
  }

  if (TERMINAL_FAILURE_STATUSES.has(clip.status)) {
    return {
      action: 'RETRY_AVAILABLE',
      reason_code: clip.failureCode ?? 'VIDEO_QA_FAILED',
      retry_available: true,
    };
  }

  return { action: 'BLOCK', reason_code: 'VIDEO_CLIP_STATUS_UNKNOWN', retry_available: false };
}
