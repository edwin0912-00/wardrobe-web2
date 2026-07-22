const PRIVATE_KEYS = new Set([
  'path', 'paths', 'pack_path', 'packPath', 'job_path', 'jobPath',
  'checkpoint_path', 'checkpointPath', 'events_path', 'eventsPath',
  'journal_path', 'journalPath', 'work_directory', 'workDirectory',
  'output_directory', 'outputDirectory', 'source_path', 'source_paths',
  'filename', 'stack', 'prompt', 'prompts',
]);

const WHOLE_WINDOWS_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\)/;
const WHOLE_UNIX_PATH = /^\/(?:Users|home|root|tmp|private|var|Volumes|workspace|workspaces|mnt|srv|opt|Applications)(?:\/|$)/;
const EMBEDDED_WINDOWS_PATH = /(?:[a-zA-Z]:[\\/]|\\\\)[^\s"'<>]+/g;
const EMBEDDED_UNIX_PATH = /\/(?:Users|home|root|tmp|private|var|Volumes|workspace|workspaces|mnt|srv|opt|Applications)(?:\/[^\s"'<>),;]*)?/g;
const FILE_URI = /file:\/\/[^\s"'<>]+/g;

export function sanitizeOutboundString(value, { stripProjectName = true } = {}) {
  if (typeof value !== 'string') return value;
  if (WHOLE_WINDOWS_PATH.test(value) || WHOLE_UNIX_PATH.test(value)) return '[redacted-local-path]';
  let sanitized = value
    .replace(FILE_URI, '[redacted-local-path]')
    .replace(EMBEDDED_WINDOWS_PATH, '[redacted-local-path]')
    .replace(EMBEDDED_UNIX_PATH, '[redacted-local-path]');
  if (stripProjectName) sanitized = sanitized.replace(/\b(?:zeely|madeforthisjob)\b/gi, 'the application');
  return sanitized;
}

export function sanitizeOutbound(value, options = {}) {
  if (typeof value === 'string') return sanitizeOutboundString(value, options);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeOutbound(item, options));
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (PRIVATE_KEYS.has(key)) return [];
    return [[key, sanitizeOutbound(item, options)]];
  }));
}

export function hasPrivateInfrastructure(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return /\b(?:zeely|madeforthisjob)\b/i.test(serialized)
    || /file:\/\//i.test(serialized)
    || /(?:^|[\s"'])(?:[a-zA-Z]:[\\/]|\\\\)/m.test(serialized)
    || /\/(?:Users|home|root|tmp|private|var|Volumes|workspace|workspaces|mnt|srv|opt|Applications)(?:\/|[\s"']|$)/.test(serialized);
}
