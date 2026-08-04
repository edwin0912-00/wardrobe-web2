import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveVideoQaAction } from '../../src/web/video-qa-action.js';

test('provider lifecycle waits on the persisted job and never advertises a paid retry', () => {
  assert.deepEqual(resolveVideoQaAction({ status: 'GENERATING' }), {
    action: 'WAIT', reason_code: 'VIDEO_PROVIDER_JOB_IN_PROGRESS', retry_available: false,
  });
});

test('failed first/last identity on a reference clip continues into cut salvage analysis', () => {
  assert.deepEqual(resolveVideoQaAction({
    status: 'NEEDS_QA', qa: { pass: true }, motionReferenceBinding: {},
    identityItemQa: { pass: false },
  }), {
    action: 'RUN_REFERENCE_QA', reason_code: 'VIDEO_REFERENCE_QA_REQUIRED', retry_available: false,
  });
});

test('salvaged bytes must receive fresh SHA-bound semantic QA before delivery', () => {
  assert.equal(resolveVideoQaAction({
    status: 'NEEDS_QA', salvage: { status: 'NEEDS_QA' },
  }).action, 'RUN_IDENTITY_QA');
  assert.equal(resolveVideoQaAction({
    status: 'NEEDS_QA', salvage: { status: 'NEEDS_QA' }, salvageIdentityItemQa: { pass: true },
  }).action, 'RUN_REFERENCE_QA');
});

test('terminal failures always expose an explicit retry while PASS still needs provenance', () => {
  assert.deepEqual(resolveVideoQaAction({ status: 'FAIL', failureCode: 'VIDEO_REFERENCE_QA_FAILED' }), {
    action: 'RETRY_AVAILABLE', reason_code: 'VIDEO_REFERENCE_QA_FAILED', retry_available: true,
  });
  assert.equal(resolveVideoQaAction({ status: 'PASS' }, { deliverable: false }).action, 'BLOCK');
  assert.equal(resolveVideoQaAction({ status: 'PASS' }, { deliverable: true }).action, 'DELIVER');
  assert.deepEqual(resolveVideoQaAction({
    status: 'OUTPUT_DOWNLOAD_FAILED', failureCode: 'VIDEO_OUTPUT_DOWNLOAD_FAILED',
  }), {
    action: 'RETRY_AVAILABLE', reason_code: 'VIDEO_OUTPUT_DOWNLOAD_FAILED', retry_available: true,
  });
});

test('reference QA parent waits while its bounded automatic child retry is being created', () => {
  assert.deepEqual(resolveVideoQaAction({
    status: 'FAIL',
    failureCode: 'VIDEO_REFERENCE_QA_FAILED',
    automaticRetry: {
      state: 'CREATED',
      retry_number: 1,
      max_retries: 2,
      child_clip_id: '44444444-4444-4444-8444-444444444444',
    },
  }), {
    action: 'WAIT',
    reason_code: 'VIDEO_REFERENCE_QA_AUTORETRY_IN_PROGRESS',
    retry_available: false,
  });
});
