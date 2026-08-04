// Public failure presentation is deliberately separate from raw provider/VLM
// output.  A machine code is useful to a tester and is stable enough to
// support a concrete recovery action; unstructured provider text may contain
// private input details or unsupported model reasoning and never belongs in
// the browser UI.

const PUBLIC_CODE = /^[A-Z][A-Z0-9_]{1,119}$/;

const NEXT_ACTION_COPY = Object.freeze({
  REPLACE_INPUT: 'додайте інше фото або ракурс',
  REMOVE_EXTRA_INPUTS: 'залиште один варіант речі цього типу',
  RETRY_AVAILABLE: 'можна повторити цю саму спробу',
  CREATE_NEW_ATTEMPT: 'створіть нову спробу',
  SELECT_VERIFIED_VIDEO_STYLE: 'оберіть перевірений відеостиль',
  CREATE_SCENE_FROM_SAVED_LOOK: 'оберіть збережений образ і спробуйте ще раз',
  RETRY_AFTER_PROVIDER_READY: 'спробуйте ще раз, коли провайдер буде готовий',
  WAIT: 'дочекайтеся наступного оновлення',
  BLOCK: 'цей результат не можна видати без виправлення',
});

function valuesFrom(source) {
  if (!source || typeof source !== 'object') return [];
  const nested = [source.error, source.body, source.response].filter(Boolean);
  return [source, ...nested];
}

function firstPublicCode(values, fields) {
  for (const value of values) {
    for (const field of fields) {
      const candidate = value?.[field];
      if (typeof candidate === 'string' && PUBLIC_CODE.test(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Return only a structurally valid public machine code.  This intentionally
 * never falls back to a provider's free-form error message.
 */
export function publicErrorCode(source, fallback = null) {
  const code = firstPublicCode(valuesFrom(source), [
    'failure_code',
    'failureCode',
    'reason_code',
    'reasonCode',
    'next_action_reason_code',
    'nextActionReasonCode',
    'code',
  ]);
  if (code) return code;
  return typeof fallback === 'string' && PUBLIC_CODE.test(fallback) ? fallback : null;
}

export function publicNextAction(source) {
  const action = firstPublicCode(valuesFrom(source), ['next_action', 'nextAction', 'action']);
  return action ? { code: action, copy: NEXT_ACTION_COPY[action] ?? null } : null;
}

/**
 * Add a terse, safe diagnostic to authored Ukrainian copy.  The caller owns
 * the human sentence; this module only exposes fields explicitly structured by
 * our API/provider adapter.
 */
export function withPublicDiagnostic(message, source, { fallbackCode = null } = {}) {
  const fragments = [String(message || '').trim()].filter(Boolean);
  const code = publicErrorCode(source, fallbackCode);
  const next = publicNextAction(source);
  if (code) fragments.push(`Код: ${code}`);
  if (next?.copy) fragments.push(`Далі: ${next.copy}`);
  return fragments.join(' · ');
}

/** Construct a normal Error while preserving the safe structured API fields. */
export function errorFromApiResponse(response, body = {}, fallbackMessage = null) {
  const error = new Error(body?.error || fallbackMessage || `HTTP ${response?.status ?? 0}`);
  error.status = Number(response?.status) || 0;
  error.code = publicErrorCode(body);
  error.failure_code = publicErrorCode(body);
  error.reason_code = publicErrorCode({ reason_code: body?.reason_code });
  error.next_action = typeof body?.next_action === 'string' ? body.next_action : null;
  error.next_action_reason_code = publicErrorCode({
    next_action_reason_code: body?.next_action_reason_code,
  });
  error.body = body && typeof body === 'object' ? body : {};
  return error;
}
