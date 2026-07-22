import assert from 'node:assert/strict';
import test from 'node:test';
import { compileFullLookText, findGarmentConflicts, garmentLocks, groupGarmentViews } from '../../src/web/garment-passport.js';

const item = (category, source_index) => ({ source_index, category, confidence: 0.9,
  observed: { garment_type: `${category} garment`, colors: ['black'], material: ['wool'], pattern: [], logo_text: [], construction: ['clean seams'] }, unknowns: [], blockers: [] });

test('structured garment record detects duplicate slots and one-piece conflicts', () => {
  assert.equal(findGarmentConflicts([item('top', 0), item('top', 1)])[0].type, 'DUPLICATE_SLOT');
  assert.equal(findGarmentConflicts([item('one_piece', 0), item('bottom', 1)]).at(-1).type, 'ONE_PIECE_LAYER_CONFLICT');
  assert.deepEqual(findGarmentConflicts([item('top', 0), item('bottom', 1), item('accessory', 2), item('accessory', 3)]), []);
});

test('multiple views of one exact garment become one reference set', () => {
  const front = item('top', 0);
  const detail = { ...item('top', 1), confidence: 0.96 };
  detail.observed = { ...detail.observed, construction: ['clean seams', 'mother-of-pearl buttons'] };
  const together = [{ source_indexes: [0, 1], primary_source_index: 1, same_item_confidence: 0.97, evidence: ['same seams and buttons'] }];
  assert.deepEqual(findGarmentConflicts([front, detail], together), []);
  const grouped = groupGarmentViews([front, detail], together);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].source_indexes, [0, 1]);
  assert.ok(grouped[0].observed.construction.includes('mother-of-pearl buttons'));
  assert.equal(findGarmentConflicts([front, detail])[0].type, 'DUPLICATE_SLOT');
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
