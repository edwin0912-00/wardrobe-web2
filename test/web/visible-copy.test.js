import assert from 'node:assert/strict';
import test from 'node:test';
import { needsInputPresentation, neutralizeItemTerms } from '../../web/public/visible-copy.js';

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

test('a headwear-only core look requests the missing outfit material instead of a retry', () => {
  const presentation = needsInputPresentation(
    'Identity references clearly show the person’s face, but the outfit references show only a brown cowboy hat and do not show the person wearing it or any body/garment details.',
  );

  assert.equal(presentation.title, 'Додай речі для повного образу');
  assert.match(presentation.message, /лише головний убір/i);
  assert.match(presentation.message, /верху, низу або цільного образу/i);
});

test('other NEEDS_INPUT messages keep their real reason and do not invent a provider failure', () => {
  const presentation = needsInputPresentation('raw garment photo is too obscured to establish construction');

  assert.equal(presentation.title, 'Потрібні інші матеріали');
  assert.match(presentation.message, /item photo is too obscured/i);
});
