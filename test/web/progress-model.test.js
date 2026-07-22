import assert from 'node:assert/strict';
import test from 'node:test';
import { nodeState, resolveProgressState } from '../../web/public/progress-model.js';

test('pipeline milestones are monotonic and exclude optional video work', () => {
  const states = [
    'UPLOADED', 'GARMENT_CONDITIONING', 'GARMENT_GROUPING', 'GARMENT_GENERATING', 'GARMENT_QA',
    'CORE_PIPELINE', 'RECEIVED', 'VALIDATING', 'CONDITIONING_IDENTITY', 'CONDITIONING_OUTFIT',
    'CONDITIONING_QA', 'REFERENCES_READY', 'GENERATING_AVATAR', 'AVATAR_QA',
    'GENERATING_OUTFIT', 'OUTFIT_QA', 'COMPLETED',
  ];
  const percentages = states.map((state) => resolveProgressState(state).percent);
  assert.deepEqual(percentages, [...percentages].sort((a, b) => a - b));
  assert.equal(resolveProgressState('COMPLETED').percent, 100);
  assert.equal(resolveProgressState('OPTIONAL_SCENE').title.includes('video'), false);
});

test('explicit byte progress is bounded and node states are deterministic', () => {
  assert.equal(resolveProgressState('UPLOADING', 47.6).percent, 48);
  assert.equal(resolveProgressState('UPLOADING', 140).percent, 100);
  assert.deepEqual([0, 1, 2].map((index) => nodeState(index, 1)), ['done', 'active', 'pending']);
});
