export const REPORT_TEXT_RULES = Object.freeze([
  Object.freeze({
    code: 'REPORT_TEXT_CREDENTIAL_LIKE',
    pattern: /\b(?:authorization|(?:api|access|refresh)?[_-]?(?:key|token)|password|cookie|secret)\s*[:=]/iu,
  }),
  Object.freeze({
    code: 'REPORT_TEXT_RAW_CREDENTIAL',
    pattern: /\b(?:bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,}|gh[pous]_[a-z0-9_]{8,})\b/iu,
  }),
  Object.freeze({
    code: 'REPORT_TEXT_PROMPT_LIKE',
    pattern: /\b(?:prompt|negative[_-]?prompt|system[_-]?prompt)\s*[:=]/iu,
  }),
  Object.freeze({
    code: 'REPORT_TEXT_PATH_FIELD',
    pattern: /\b(?:path|file|directory|cwd|workdir)\s*[:=]/iu,
  }),
  Object.freeze({
    code: 'REPORT_TEXT_LOCAL_PATH',
    pattern: /(?:^|[^a-z0-9._-])(?:~\/|\/(?:users|root|home|private|var|tmp|opt|volumes|etc|mnt|usr|library)\/|[a-z]:\\)/iu,
  }),
  Object.freeze({
    code: 'REPORT_TEXT_RUNTIME_IDENTIFIER',
    pattern: /\b(?:artifact(?:[_-]?id)?|run(?:[_-]?id)?|execution(?:[_-]?id)?|resource(?:[_-]?id)?|output(?:[_-]?id)?|runtime(?:[_-]?id)?)\s*[:=]/iu,
  }),
  Object.freeze({
    code: 'REPORT_TEXT_PRIVATE_REFERENCE',
    pattern: /(?:^|[^a-z0-9._-])(?:\.env(?:\b|\/)|(?:runtime|output)\/)/iu,
  }),
  Object.freeze({
    code: 'REPORT_TEXT_EMAIL',
    pattern: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/iu,
  }),
  Object.freeze({
    code: 'REPORT_TEXT_DATA_URL',
    pattern: /\bdata:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+)*;base64,/iu,
  }),
  Object.freeze({
    code: 'REPORT_TEXT_PHONE',
    pattern: /(?:\b(?:phone|tel|mobile)\s*[:=]\s*|\+)\d(?:[\d ()-]{7,}\d)|\b\d{3}[ -]\d{3}[ -]\d{3,4}\b/iu,
  }),
  Object.freeze({
    code: 'REPORT_TEXT_LONG_NUMBER',
    pattern: /\b\d{10,15}\b/u,
  }),
]);

export function validateSafeReportText(value) {
  if (typeof value !== 'string') return [];
  return REPORT_TEXT_RULES
    .filter((rule) => rule.pattern.test(value))
    .map((rule) => ({ code: rule.code }));
}
