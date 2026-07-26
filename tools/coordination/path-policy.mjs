export const CONTROL_FILES = Object.freeze([
  'OWNERS.md',
  'LOG.md',
  'STATE.md',
  'TASKS.json',
]);

export const CONTROL_PATTERNS = Object.freeze([
  '.gitattributes',
  '.gitmodules',
  '.gitignore',
  'AGENTS.md',
  'CLAUDE.md',
  ...CONTROL_FILES,
  'package.json',
  'package-lock.json',
  '.github/**',
  '.agents/README.md',
  '.agents/policies/**',
  'docs/coordination/**',
  'schemas/agent-*.schema.json',
  'tools/coordination/**',
  'test/governance/**',
]);

export const BASELINE_EXEMPT_PATTERNS = Object.freeze([
  '.gitattributes',
  '.gitmodules',
  '.gitignore',
  'AGENTS.md',
  'CLAUDE.md',
  ...CONTROL_FILES,
  '.github/**',
  '.agents/README.md',
  '.agents/policies/**',
  '.agents/handoffs/**',
  'docs/coordination/**',
  'schemas/agent-*.schema.json',
  'tools/coordination/**',
  'test/governance/**',
]);

export function matchOwnedPath(filePath, pattern) {
  const normalizedPath = normalizeRepoPath(filePath);
  const normalizedPattern = normalizeRepoPath(pattern);
  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('?', '[^/]')
    .replaceAll('\u0000', '.*');
  return new RegExp(`^${escaped}$`, 'u').test(normalizedPath);
}

export function isProductPath(filePath) {
  return !BASELINE_EXEMPT_PATTERNS
    .some((pattern) => matchOwnedPath(filePath, pattern));
}

export function normalizeRepoPath(value) {
  const normalized = String(value ?? '').replaceAll('\\', '/').replace(/^\.\/+/u, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Invalid repository path: ${value}`);
  }
  return normalized;
}
