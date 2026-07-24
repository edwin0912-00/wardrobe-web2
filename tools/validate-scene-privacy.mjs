#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultScopes = [
  'config/scene-presets.json',
  'config/scene-release-candidates.json',
  'prompts/scenes',
  'prompts/scene-presets',
  'assets/scene-mood-cards',
  'assets/scene-presets',
  'evidence/licenses',
  'evidence/scene-sources',
  'output/scene-mvp',
  'output/scene-production',
  'ops/zeely-scene-mvp-loop',
];
const checkedRules = [
  'NO_ABSOLUTE_USER_PATHS',
  'NO_PRIVATE_RUNTIME_PATHS',
  'NO_SECRET_VALUES',
  'NO_LOCAL_FILE_URIS',
  'PERSONAL_INPUT_POLICY',
];
const textExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.text',
  '.txt',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const imageExtensions = new Set(['.avif', '.jpeg', '.jpg', '.png', '.webp']);
const ignoredNames = new Set(['.git', 'node_modules']);

function parseArgs(argv) {
  const result = { scope: [], exclude: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    const value = next && !next.startsWith('--') ? argv[++index] : true;
    if (key === 'scope') result.scope.push(value);
    else if (key === 'exclude') result.exclude.push(value);
    else result[key] = value;
  }
  return result;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function displayPath(filename) {
  const relative = path.relative(projectRoot, filename);
  return relative.startsWith('..') ? path.basename(filename) : relative;
}

async function collectFiles(target, files, seen) {
  const targetStats = await lstat(target);
  if (targetStats.isSymbolicLink()) return;
  const resolved = await realpath(target);
  if (seen.has(resolved)) return;
  seen.add(resolved);
  const stats = await lstat(resolved);
  if (stats.isFile()) {
    files.push(resolved);
    return;
  }
  if (!stats.isDirectory()) return;
  for (const entry of await readdir(resolved, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name)) continue;
    await collectFiles(path.join(resolved, entry.name), files, seen);
  }
}

function lineForOffset(value, offset) {
  return value.slice(0, offset).split('\n').length;
}

function addRegexFindings(text, filename, findings) {
  const rules = [
    {
      rule: 'NO_ABSOLUTE_USER_PATHS',
      message: 'Absolute local user path is present.',
      regex: /(?:\/Users\/[^/\s"'<>]+(?:\/|$)|\/home\/[^/\s"'<>]+(?:\/|$)|[A-Za-z]:\\Users\\[^\\\s"'<>]+(?:\\|$))/g,
    },
    {
      rule: 'NO_PRIVATE_RUNTIME_PATHS',
      message: 'Private runtime run/draft path is present.',
      regex: /(?:^|[/'"\\])runtime[\\/](?:runs|drafts)[\\/][a-zA-Z0-9_-]{4,}/gim,
    },
    {
      rule: 'NO_LOCAL_FILE_URIS',
      message: 'Local file URI is present.',
      regex: /\bfile:\/\/[^\s"'<>]+/gim,
    },
    {
      rule: 'NO_SECRET_VALUES',
      message: 'A value matching a secret credential pattern is present.',
      regex: /\b(?:sk|ek)_(?:live|test|proj)_[a-zA-Z0-9_-]{12,}\b|\bAIza[a-zA-Z0-9_-]{20,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[a-zA-Z0-9_./+=-]{16,}/gim,
    },
  ];
  for (const { rule, message, regex } of rules) {
    for (const match of text.matchAll(regex)) {
      findings.push({
        rule,
        path: displayPath(filename),
        line: lineForOffset(text, match.index ?? 0),
        message,
      });
    }
  }
}

function findPersonalInputFlags(value, trail = '$') {
  const matches = [];
  if (!value || typeof value !== 'object') return matches;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      matches.push(...findPersonalInputFlags(item, `${trail}[${index}]`));
    });
    return matches;
  }
  for (const [key, child] of Object.entries(value)) {
    const childTrail = `${trail}.${key}`;
    if (
      ['contains_personal_input', 'generated_with_personal_inputs'].includes(key) &&
      child === true
    ) {
      matches.push(childTrail);
    }
    matches.push(...findPersonalInputFlags(child, childTrail));
  }
  return matches;
}

async function inspectFile(filename, forbidPersonalInput, findings) {
  const content = await readFile(filename);
  const extension = path.extname(filename).toLowerCase();
  let inspection = 'BINARY_HASH_ONLY';
  if (textExtensions.has(extension)) {
    inspection = 'TEXT';
    const text = content.toString('utf8');
    addRegexFindings(text, filename, findings);
    if (forbidPersonalInput && extension === '.json') {
      try {
        const parsed = JSON.parse(text);
        for (const jsonPath of findPersonalInputFlags(parsed)) {
          findings.push({
            rule: 'PERSONAL_INPUT_POLICY',
            path: displayPath(filename),
            line: null,
            message: `Personal-input flag is true at ${jsonPath}.`,
          });
        }
      } catch {
        // Invalid JSON is a contract concern; privacy scanning still checks it as text.
      }
    }
  } else if (imageExtensions.has(extension)) {
    inspection = 'IMAGE_METADATA';
    const metadata = await sharp(content).metadata();
    const metadataText = [
      metadata.exif,
      metadata.icc,
      metadata.iptc,
      metadata.xmp,
      metadata.comments ? Buffer.from(JSON.stringify(metadata.comments)) : null,
    ]
      .filter(Boolean)
      .map((value) => Buffer.from(value).toString('utf8'))
      .join('\n');
    addRegexFindings(metadataText, filename, findings);
  }
  return {
    path: displayPath(filename),
    sha256: sha256(content),
    inspection,
  };
}

export async function validateScenePrivacy(options = {}) {
  const scopes = (options.scopes?.length ? options.scopes : defaultScopes).map((value) =>
    path.resolve(projectRoot, value),
  );
  const findings = [];
  const files = [];
  const seen = new Set();
  const excludedPaths = new Set(
    (options.excludePaths ?? []).map((value) => path.resolve(projectRoot, value)),
  );
  for (const scope of scopes) {
    try {
      await collectFiles(scope, files, seen);
    } catch (error) {
      findings.push({
        rule: 'PERSONAL_INPUT_POLICY',
        path: displayPath(scope),
        line: null,
        message: `Declared privacy scope cannot be inspected: ${error.code ?? error.message}.`,
      });
    }
  }
  const includedFiles = files.filter((filename) => !excludedPaths.has(filename)).sort();
  const checkedFiles = [];
  for (const filename of includedFiles) {
    checkedFiles.push(
      await inspectFile(filename, options.forbidPersonalInput === true, findings),
    );
  }
  if (!checkedFiles.length) {
    findings.push({
      rule: 'PERSONAL_INPUT_POLICY',
      path: '.',
      line: null,
      message: 'Privacy scope contained no inspectable files.',
    });
  }
  return {
    schema_version: '1.0.0',
    status: findings.length ? 'FAIL' : 'PASS',
    scope: scopes.map(displayPath),
    excluded_paths: [...excludedPaths].sort().map(displayPath),
    checked_rules: checkedRules,
    checked_files: checkedFiles,
    findings,
    completed_at: new Date().toISOString(),
  };
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = await validateScenePrivacy({
      scopes: args.scope,
      excludePaths: [
        ...args.exclude,
        ...(args.report ? [args.report] : []),
      ],
      forbidPersonalInput: args['forbid-personal-input'] === true,
    });
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (args.report) await writeFile(path.resolve(args.report), serialized);
    process.stdout.write(serialized);
    if (result.status !== 'PASS') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
