import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCANNER = path.join(ROOT, 'tools/coordination/scan-pr-diff.mjs');
const CREDENTIAL_FAMILIES = Object.freeze([
  {
    name: 'OpenRouter token',
    value: () => ['sk', 'or', 'v1', 'a'.repeat(24)].join('-'),
  },
  {
    name: 'OpenAI project token',
    value: () => ['sk', 'proj', 'b'.repeat(24)].join('-'),
  },
  {
    name: 'GitHub token',
    value: () => ['ghp', '_', 'c'.repeat(24)].join(''),
  },
  {
    name: 'Google API key',
    value: () => ['AI', 'za', 'd'.repeat(28)].join(''),
  },
  {
    name: 'AWS access key',
    value: () => ['AK', 'IA', 'E'.repeat(16)].join(''),
  },
  {
    name: 'Engram token',
    value: () => ['ek', 'live', 'f'.repeat(24)].join('_'),
  },
  {
    name: 'Hugging Face or Higgsfield-style token',
    value: () => ['h', 'f', '_', 'g'.repeat(24)].join(''),
  },
  {
    name: 'GitLab token',
    value: () => ['gl', 'pat', '-', 'h'.repeat(24)].join(''),
  },
  {
    name: 'JWT',
    value: () => [
      ['ey', 'J', 'i'.repeat(16)].join(''),
      'j'.repeat(16),
      'k'.repeat(16),
    ].join('.'),
  },
  {
    name: 'Bearer credential',
    value: () => ['Bear', 'er', ' ', 'l'.repeat(24)].join(''),
  },
  {
    name: 'Basic credential',
    value: () => ['Bas', 'ic', ' ', 'm'.repeat(24)].join(''),
  },
  {
    name: 'generic API key assignment',
    value: () => ['api', '_key', '=', 'n'.repeat(24)].join(''),
  },
]);

test('every recognized credential family is rejected in blobs, commit metadata and filenames', async (t) => {
  for (const family of CREDENTIAL_FAMILIES) {
    for (const location of ['blob', 'message', 'author', 'filename']) {
      await t.test(`${family.name} in ${location}`, () => {
        assertCredentialRejected({
          family,
          location,
        });
      });
    }
  }
});

test('a secret-like value added and deleted in separate commits is still rejected', () => {
  const repo = createRepository();
  try {
    writeFileSync(path.join(repo, 'README.md'), 'safe\n');
    commitAll(repo, 'base');
    const base = revParse(repo, 'HEAD');

    const transientSecret = ['sk', 'or', 'v1', 'a'.repeat(24)].join('-');
    writeFileSync(path.join(repo, 'transient.txt'), `value=${transientSecret}\n`);
    commitAll(repo, 'temporarily add sensitive value');
    const introducingCommit = revParse(repo, 'HEAD');

    rmSync(path.join(repo, 'transient.txt'));
    commitAll(repo, 'remove sensitive value');
    const head = revParse(repo, 'HEAD');

    const result = spawnSync(
      process.execPath,
      [SCANNER, '--root', repo, '--base', base, '--head', head],
      { encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    const report = JSON.parse(result.stderr);
    const violation = report.violations.find(
      (entry) => entry.code === 'TOKEN_SHAPED_VALUE'
        && entry.line === 1,
    );
    assert.deepEqual(
      Object.keys(violation).sort(),
      ['code', 'commit', 'line', 'path'],
    );
    assert.equal(violation.path, 'transient.txt');
    assert.equal(violation.line, 1);
    assert.equal(violation.commit, introducingCommit);
    assert.equal(result.stderr.includes(transientSecret), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a non-linear introduced history is rejected without reporting patch content', () => {
  const repo = createRepository();
  try {
    writeFileSync(path.join(repo, 'README.md'), 'safe\n');
    commitAll(repo, 'base');
    const base = revParse(repo, 'HEAD');

    git(repo, ['switch', '--create', 'side']);
    writeFileSync(path.join(repo, 'side.txt'), 'side branch content\n');
    commitAll(repo, 'side change');

    git(repo, ['switch', 'main']);
    writeFileSync(path.join(repo, 'main.txt'), 'main branch content\n');
    commitAll(repo, 'main change');
    git(repo, ['merge', '--no-ff', 'side', '--message', 'merge side']);
    const head = revParse(repo, 'HEAD');

    const result = spawnSync(
      process.execPath,
      [SCANNER, '--root', repo, '--base', base, '--head', head],
      { encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    const report = JSON.parse(result.stderr);
    const violation = report.violations.find(
      (entry) => entry.code === 'NON_LINEAR_HISTORY',
    );
    assert.deepEqual(
      Object.keys(violation).sort(),
      ['code', 'commit', 'line', 'path'],
    );
    assert.equal(violation.path, null);
    assert.equal(violation.line, null);
    assert.equal(violation.commit, head);
    assert.equal(result.stderr.includes('side branch content'), false);
    assert.equal(result.stderr.includes('main branch content'), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a binary secret added and deleted across commits is still rejected', () => {
  const repo = createRepository();
  try {
    writeFileSync(path.join(repo, 'README.md'), 'safe\n');
    commitAll(repo, 'base');
    const base = revParse(repo, 'HEAD');

    const transientSecret = ['sk', 'or', 'v1', 'b'.repeat(24)].join('-');
    writeFileSync(
      path.join(repo, 'binary.bin'),
      Buffer.concat([
        Buffer.from([0, 1, 2, 0]),
        Buffer.from(transientSecret),
        Buffer.from([0, 255, 0]),
      ]),
    );
    commitAll(repo, 'temporarily add binary value');
    const introducingCommit = revParse(repo, 'HEAD');
    rmSync(path.join(repo, 'binary.bin'));
    commitAll(repo, 'remove binary value');
    const head = revParse(repo, 'HEAD');

    const result = runScanner(repo, base, head);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stderr);
    const violation = report.violations.find(
      (entry) => entry.code === 'TOKEN_SHAPED_VALUE'
        && entry.commit === introducingCommit
        && entry.path === 'binary.bin',
    );
    assert.ok(violation);
    assert.equal(result.stderr.includes(transientSecret), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('secret-shaped commit messages are rejected without echoing them', () => {
  const repo = createRepository();
  try {
    writeFileSync(path.join(repo, 'README.md'), 'safe\n');
    commitAll(repo, 'base');
    const base = revParse(repo, 'HEAD');

    const transientSecret = ['ghp', '_', 'c'.repeat(24)].join('');
    writeFileSync(path.join(repo, 'change.txt'), 'ordinary content\n');
    commitAll(repo, `message ${transientSecret}`);
    const head = revParse(repo, 'HEAD');

    const result = runScanner(repo, base, head);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stderr);
    assert.ok(report.violations.some(
      (entry) => entry.code === 'TOKEN_SHAPED_VALUE'
        && entry.commit === head
        && entry.path === null,
    ));
    assert.equal(result.stderr.includes(transientSecret), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('option-object test suppression is rejected', () => {
  const repo = createRepository();
  try {
    writeFileSync(path.join(repo, 'README.md'), 'safe\n');
    commitAll(repo, 'base');
    const base = revParse(repo, 'HEAD');

    const suppression = [
      'test',
      "('must execute', { ",
      'skip',
      ': true }, () => {});\n',
    ].join('');
    mkdirSync(path.join(repo, 'test'));
    writeFileSync(path.join(repo, 'test', 'suppressed.test.js'), suppression);
    commitAll(repo, 'add suppressed test');
    const head = revParse(repo, 'HEAD');

    const result = runScanner(repo, base, head);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stderr);
    assert.ok(report.violations.some(
      (entry) => entry.code === 'TEST_SUPPRESSION'
        && entry.path === 'test/suppressed.test.js',
    ));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('credential-shaped filenames are rejected without echoing the path', () => {
  const repo = createRepository();
  try {
    writeFileSync(path.join(repo, 'README.md'), 'safe\n');
    commitAll(repo, 'base');
    const base = revParse(repo, 'HEAD');

    const transientSecret = ['gho', '_', 'd'.repeat(24)].join('');
    writeFileSync(path.join(repo, `${transientSecret}.txt`), 'ordinary content\n');
    commitAll(repo, 'add unsafe filename');
    const head = revParse(repo, 'HEAD');

    const result = runScanner(repo, base, head);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stderr);
    assert.ok(report.violations.some(
      (entry) => entry.code === 'TOKEN_SHAPED_VALUE'
        && entry.path === '[REDACTED]',
    ));
    assert.equal(result.stderr.includes(transientSecret), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('credential-shaped author metadata is rejected without echoing it', () => {
  const repo = createRepository();
  try {
    writeFileSync(path.join(repo, 'README.md'), 'safe\n');
    commitAll(repo, 'base');
    const base = revParse(repo, 'HEAD');

    const transientSecret = ['ghu', '_', 'e'.repeat(24)].join('');
    writeFileSync(path.join(repo, 'change.txt'), 'ordinary content\n');
    git(repo, ['add', '--all']);
    git(repo, [
      'commit',
      '--author',
      `Unsafe ${transientSecret} <wardrobe-test@example.invalid>`,
      '--message',
      'ordinary message',
    ]);
    const head = revParse(repo, 'HEAD');

    const result = runScanner(repo, base, head);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stderr);
    assert.ok(report.violations.some(
      (entry) => entry.code === 'TOKEN_SHAPED_VALUE'
        && entry.path === null,
    ));
    assert.equal(result.stderr.includes(transientSecret), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

function createRepository() {
  const repo = mkdtempSync(path.join(tmpdir(), 'wardrobe-diff-history-'));
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.name', 'Wardrobe Test']);
  git(repo, ['config', 'user.email', 'wardrobe-test@example.invalid']);
  return repo;
}

function commitAll(repo, message) {
  git(repo, ['add', '--all']);
  git(repo, ['commit', '--message', message]);
}

function revParse(repo, revision) {
  return git(repo, ['rev-parse', revision]).trim();
}

function runScanner(repo, base, head) {
  return spawnSync(
    process.execPath,
    [SCANNER, '--root', repo, '--base', base, '--head', head],
    { encoding: 'utf8' },
  );
}

function assertCredentialRejected({ family, location }) {
  const repo = createRepository();
  const credential = family.value();
  try {
    writeFileSync(path.join(repo, 'README.md'), 'safe\n');
    commitAll(repo, 'base');
    const base = revParse(repo, 'HEAD');

    if (location === 'blob') {
      writeFileSync(path.join(repo, 'candidate.txt'), `value=${credential}\n`);
      commitAll(repo, 'add candidate value');
    } else if (location === 'message') {
      writeFileSync(path.join(repo, 'candidate.txt'), 'ordinary content\n');
      commitAll(repo, `candidate message ${credential}`);
    } else if (location === 'author') {
      writeFileSync(path.join(repo, 'candidate.txt'), 'ordinary content\n');
      git(repo, ['add', '--all']);
      git(repo, [
        'commit',
        '--author',
        `Candidate ${credential} <wardrobe-test@example.invalid>`,
        '--message',
        'ordinary message',
      ]);
    } else {
      writeFileSync(path.join(repo, `${credential}.txt`), 'ordinary content\n');
      commitAll(repo, 'add candidate filename');
    }

    const head = revParse(repo, 'HEAD');
    const result = runScanner(repo, base, head);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stderr);
    const violation = report.violations.find(
      (entry) => entry.code === 'TOKEN_SHAPED_VALUE',
    );
    assert.ok(violation);
    if (location === 'filename') {
      assert.equal(violation.path, '[REDACTED]');
    } else if (location === 'message' || location === 'author') {
      assert.equal(violation.path, null);
    }
    assert.equal(result.stderr.includes(credential), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

function git(repo, args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
