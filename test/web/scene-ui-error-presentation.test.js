import assert from 'node:assert/strict';
import test from 'node:test';

import { sceneRequestFailurePresentation } from '../../web/public/scene-ui.js';

test('structured item-evidence 409 is not presented as a lost connection', () => {
  const presentation = sceneRequestFailurePresentation({
    status: 409,
    code: 'LOOK_ITEM_EVIDENCE_INVALID',
    message: 'Conflict',
  });

  assert.equal(presentation.connection, 'СЕРВЕР НА ЗВ’ЯЗКУ');
  assert.equal(presentation.status, 'ЗАПУСК ВІДХИЛЕНО');
  assert.equal(presentation.reconnect, false);
  assert.match(presentation.message, /підтвердження речей/i);
  assert.doesNotMatch(presentation.message, /Conflict|з’єднання перервалося/i);
});

test('transport failures still offer reconnect', () => {
  const presentation = sceneRequestFailurePresentation(new TypeError('fetch failed'));

  assert.equal(presentation.connection, 'З’ЄДНАННЯ ПЕРЕРВАЛОСЯ');
  assert.equal(presentation.reconnect, true);
});
