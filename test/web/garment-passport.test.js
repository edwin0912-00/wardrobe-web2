import assert from 'node:assert/strict';
import test from 'node:test';
import { compileFullLookText, findGarmentConflicts, garmentLocks } from '../../src/web/garment-passport.js';

const item = (category, source_index) => ({ source_index, category, confidence: 0.9,
  observed: { garment_type: `${category} garment`, colors: ['black'], material: ['wool'], pattern: [], logo_text: [], construction: ['clean seams'] }, unknowns: [], blockers: [] });

test('garment passport detects duplicate slots and one-piece conflicts', () => {
  assert.equal(findGarmentConflicts([item('top', 0), item('top', 1)])[0].type, 'DUPLICATE_SLOT');
  assert.equal(findGarmentConflicts([item('one_piece', 0), item('bottom', 1)]).at(-1).type, 'ONE_PIECE_LAYER_CONFLICT');
  assert.deepEqual(findGarmentConflicts([item('top', 0), item('bottom', 1), item('accessory', 2), item('accessory', 3)]), []);
});

test('garment locks and full-look prompt preserve observable details', () => {
  const value = item('outerwear', 0);
  value.observed.logo_text = ['ZEELY'];
  assert.ok(garmentLocks(value).some((lock) => lock.includes('ZEELY')));
  const prompt = compileFullLookText([value], 'editorial fit');
  assert.match(prompt, /editorial fit/);
  assert.match(prompt, /outerwear/);
  assert.match(prompt, /ZEELY/);
});
