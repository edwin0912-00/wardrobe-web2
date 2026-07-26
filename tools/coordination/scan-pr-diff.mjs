#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
for (const required of ['root', 'base', 'head']) {
  if (!args[required]) throw new Error(`--${required} is required`);
}
const root = path.resolve(args.root);
const violations = [];
const MAX_SCANNABLE_BLOB_BYTES = 32 * 1024 * 1024;
const TOKEN_SHAPED_VALUE = new RegExp([
  String.raw`\bsk-(?:(?:or-v1|proj|ant)-)?[A-Za-z0-9_-]{12,}`,
  String.raw`\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{12,}`,
  String.raw`\bgh[pousr]_[A-Za-z0-9_-]{12,}`,
  String.raw`\bAIza[A-Za-z0-9_-]{20,}`,
  String.raw`\bAKIA[A-Z0-9]{16}\b`,
  String.raw`\bek_(?:live|test|proj)_[A-Za-z0-9_-]{12,}`,
  String.raw`\bhf_[A-Za-z0-9_-]{12,}`,
  String.raw`\bglpat-[A-Za-z0-9_-]{12,}`,
  String.raw`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b`,
  String.raw`\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}`,
  String.raw`\bBasic\s+[A-Za-z0-9+/]{12,}={0,2}`,
  String.raw`\b(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret|token|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}`,
].join('|'), 'iu');
const CONTENT_PATTERNS = Object.freeze([
  ['ABSOLUTE_USER_PATH', /(?:\/Users\/[^/\s]+|\/home\/[^/\s]+)\//u],
  ['PRIVATE_KEY_MATERIAL', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ['TOKEN_SHAPED_VALUE', TOKEN_SHAPED_VALUE],
  ['CONFLICT_MARKER', /^(?:<<<<<<<|=======|>>>>>>>)(?: |$)/mu],
]);
const mergeBase = git(['merge-base', args.base, args.head]).trim();
const history = git([
  'rev-list',
  '--reverse',
  '--topo-order',
  '--parents',
  `${mergeBase}..${args.head}`,
]);
for (const row of history.split('\n').filter(Boolean)) {
  const [commit, ...parents] = row.trim().split(/\s+/u);
  if (parents.length !== 1) {
    addViolation('NON_LINEAR_HISTORY', { commit });
  }
  scanContent(
    git(['show', '--no-patch', '--format=%an%n%ae%n%cn%n%ce%n%B', commit]),
    { commit, path: null, line: null },
  );
  const parent = parents[0];
  if (!parent) continue;
  scanCommit(parent, commit);
}

if (violations.length > 0) {
  process.stderr.write(`${JSON.stringify({ ok: false, violations }, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ ok: true })}\n`);

function scanCommit(parent, commit) {
  const names = git([
    'diff',
    '--name-status',
    '--no-renames',
    parent,
    commit,
    '--',
  ]);
  for (const row of names.split('\n').filter(Boolean)) {
    const columns = row.split('\t');
    const status = columns[0] ?? '';
    const changedPath = columns.at(-1) ?? '';
    const reportedPath = redactPath(changedPath);
    scanContent(changedPath, { commit, path: reportedPath, line: null });
    if (changedPath === '.env'
      || changedPath.startsWith('.env.')
      || changedPath.startsWith('secrets/')) {
      addViolation('PRIVATE_FILE_CHANGED', { commit, path: reportedPath });
    }
    if (!status.startsWith('D')) scanBlob(commit, changedPath, reportedPath);
  }

  const raw = git([
    'diff',
    '--raw',
    '--no-renames',
    parent,
    commit,
    '--',
  ]);
  for (const row of raw.split('\n').filter(Boolean)) {
    const [metadata, ...changedPaths] = row.split('\t');
    const modes = /^:(\d{6}) (\d{6}) /u.exec(metadata);
    if (modes && [modes[1], modes[2]].some((mode) => mode === '120000' || mode === '160000')) {
      addViolation('SYMLINK_OR_GITLINK_CHANGED', {
        commit,
        path: redactPath(changedPaths.at(-1) ?? null),
      });
    }
  }

  const patch = git([
    'diff',
    '--no-ext-diff',
    '--unified=0',
    '--no-renames',
    parent,
    commit,
    '--',
  ], { maxBuffer: 64 * 1024 * 1024 });
  let currentPath = null;
  let addedLine = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      currentPath = null;
      continue;
    }
    if (line.startsWith('+++ b/')) {
      currentPath = redactPath(line.slice(6));
      continue;
    }
    const hunk = /^@@ -[^+]*\+(\d+)/u.exec(line);
    if (hunk) {
      addedLine = Number(hunk[1]);
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    scanContent(line.slice(1), {
      commit,
      path: currentPath,
      line: addedLine,
    });
    addedLine += 1;
  }
}

function scanBlob(commit, changedPath, reportedPath) {
  const blob = git(['rev-parse', `${commit}:${changedPath}`]).trim();
  const size = Number(git(['cat-file', '-s', blob]).trim());
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_SCANNABLE_BLOB_BYTES) {
    addViolation('UNSCANNABLE_BLOB', { commit, path: reportedPath });
    return;
  }
  const bytes = execFileSync(
    'git',
    ['cat-file', 'blob', blob],
    {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: MAX_SCANNABLE_BLOB_BYTES + 1,
    },
  );
  scanContent(bytes.toString('latin1'), {
    commit,
    path: reportedPath,
    line: null,
  });
}

function redactPath(changedPath) {
  if (changedPath == null) return null;
  return CONTENT_PATTERNS
    .filter(([code]) => code !== 'CONFLICT_MARKER')
    .some(([, pattern]) => pattern.test(changedPath))
    ? '[REDACTED]'
    : changedPath;
}

function scanContent(value, metadata) {
  for (const [code, pattern] of CONTENT_PATTERNS) {
    if (pattern.test(value)) addViolation(code, metadata);
  }
  if (metadata.path?.startsWith('test/')
    && (/\b(?:test|it|describe)\.(?:skip|todo)\s*\(/u.test(value)
      || /\b(?:skip|todo)\s*:/u.test(value))) {
    addViolation('TEST_SUPPRESSION', metadata);
  }
}

function addViolation(code, {
  commit,
  path: changedPath = null,
  line = null,
}) {
  violations.push({
    code,
    path: changedPath,
    line,
    commit,
  });
}

function git(gitArgs, options = {}) {
  return execFileSync(
    'git',
    gitArgs,
    {
      cwd: root,
      encoding: 'utf8',
      ...options,
    },
  );
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith('--') || values[index + 1] == null) {
      throw new Error(`Invalid argument: ${key}`);
    }
    parsed[key.slice(2)] = values[index + 1];
  }
  return parsed;
}
