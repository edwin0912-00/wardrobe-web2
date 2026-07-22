import assert from 'node:assert/strict';
import test from 'node:test';
import { neutralizeItemTerms } from '../../web/public/visible-copy.js';

test('visible copy hides legacy item terminology in prose and contract-shaped text', () => {
  const raw = [
    'GARMENT_CONDITIONING',
    'GARMENT_GROUPING',
    'GARMENT_GENERATING',
    'GARMENT_QA',
    'client.garment_selected',
    'garment_count',
    'GarmentNeedsInputError',
    '/api/runs/id/garments/0',
    'Visible garment mismatch',
  ].join(' | ');

  const visible = neutralizeItemTerms(raw);
  assert.doesNotMatch(visible, /garment/i);
  assert.match(visible, /ITEM_FACTS/);
  assert.match(visible, /VIEW_GROUPING/);
  assert.match(visible, /ITEM_PREPARATION/);
  assert.match(visible, /ITEM_QA/);
  assert.match(visible, /client\.item_selected/);
  assert.match(visible, /item_count/);
  assert.match(visible, /ItemNeedsInputError/);
  assert.match(visible, /\/items\/0/);
});
