import assert from 'node:assert/strict';
import test from 'node:test';
import { contactPointInsideFrame } from '../../src/web/scene-contract.js';

test('contactPointInsideFrame owns the strict canvas-bottom geometry check', () => {
  assert.equal(contactPointInsideFrame({ subject_bbox_xywh_px: [12, 8, 40, 80] }, { height: 100 }), true);
  assert.equal(contactPointInsideFrame({ subject_bbox_xywh_px: [12, 20, 40, 80] }, { height: 100 }), false);
});

test('contactPointInsideFrame rejects malformed canvas or subject geometry', () => {
  assert.throws(
    () => contactPointInsideFrame({ subject_bbox_xywh_px: [12, 8, 40, 80] }, { height: 100.5 }),
    /positive integer canvas height/,
  );
  assert.throws(
    () => contactPointInsideFrame({ subject_bbox_xywh_px: [12, 8, 40] }, { height: 100 }),
    /must contain four integers/,
  );
  assert.throws(
    () => contactPointInsideFrame({ subject_bbox_xywh_px: [12, 8, 40, 80.5] }, { height: 100 }),
    /must contain four integers/,
  );
});
