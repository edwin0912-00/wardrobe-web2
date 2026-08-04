import assert from 'node:assert/strict';
import test from 'node:test';

import {
  errorFromApiResponse,
  publicErrorCode,
  publicNextAction,
  withPublicDiagnostic,
} from '../../web/public/error-presentation.js';

test('public diagnostic prefers the exact structured failure code and keeps an authored next action', () => {
  const failure = {
    error: 'Higgsfield provider output that must not be repeated in the UI',
    failure_code: 'VIDEO_INPUT_MEDIA_IP_CHECK_PENDING',
    next_action: 'RETRY_AVAILABLE',
  };

  assert.equal(publicErrorCode(failure), 'VIDEO_INPUT_MEDIA_IP_CHECK_PENDING');
  assert.deepEqual(publicNextAction(failure), {
    code: 'RETRY_AVAILABLE',
    copy: 'можна повторити цю саму спробу',
  });
  assert.equal(
    withPublicDiagnostic('Провайдер ще перевіряє медіа.', failure),
    'Провайдер ще перевіряє медіа. · Код: VIDEO_INPUT_MEDIA_IP_CHECK_PENDING · Далі: можна повторити цю саму спробу',
  );
});

test('API response error retains safe structured fields without treating free-form provider text as a code', () => {
  const error = errorFromApiResponse(
    { status: 422 },
    {
      error: 'the raw provider response remains server-side',
      code: 'IMAGE_TOO_SMALL',
      next_action: 'REPLACE_INPUT',
    },
  );

  assert.equal(error.status, 422);
  assert.equal(error.code, 'IMAGE_TOO_SMALL');
  assert.equal(error.next_action, 'REPLACE_INPUT');
  assert.match(withPublicDiagnostic('Потрібне інше зображення.', error), /Код: IMAGE_TOO_SMALL/);
  assert.match(withPublicDiagnostic('Потрібне інше зображення.', error), /Далі: додайте інше фото або ракурс/);
  assert.equal(publicErrorCode({ error: 'MODEL SAID NO' }), null);
});
