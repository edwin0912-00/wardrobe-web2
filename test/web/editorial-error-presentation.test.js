import assert from 'node:assert/strict';
import test from 'node:test';

import { editorialRequestFailurePresentation } from '../../web/public/editorial-shoot-ui.js';

test('Fashion Shoot never exposes a raw HTTP Conflict as product copy', () => {
  const presentation = editorialRequestFailurePresentation({
    status: 409,
    code: 'LOOK_ITEM_EVIDENCE_INVALID',
    message: 'Conflict',
  });

  assert.equal(presentation.retryable, false);
  assert.match(presentation.status, /ПЕРЕВІРКА/);
  assert.match(presentation.message, /збережен/i);
  assert.match(presentation.message, /Код: LOOK_ITEM_EVIDENCE_INVALID/);
  assert.doesNotMatch(presentation.message, /Conflict/i);
});

test('Fashion Shoot keeps a retry only for a real transport failure', () => {
  const presentation = editorialRequestFailurePresentation(new TypeError('Network request failed'));

  assert.equal(presentation.retryable, true);
  assert.match(presentation.status, /З’ЄДНАННЯ/);
  assert.doesNotMatch(presentation.message, /Network request failed/i);
});
