import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ACTIVE_STATES,
  isProductPath,
  validateBoardDocument,
  validateTaskScope,
} from '../../tools/coordination/control-plane.mjs';
import {
  CANONICAL_ORIGIN_URLS,
  collectIntroducedHistoryPaths,
  isCanonicalOriginUrl,
  verifyActiveContextPins,
} from '../../tools/coordination/repository-policy.mjs';
import { isStrictRfc3339 } from '../../tools/coordination/schema-validation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE_SHA = '622c8783060cb64970e7c8952d51ca7c50307edd';

test('active tasks require a non-empty lock group list', () => {
  const errors = validateBoardDocument(boardFixture(taskFixture({ lock_groups: [] })), {
    now: new Date('2026-07-26T20:00:00.000Z'),
  });
  assert.ok(errors.some((error) =>
    error.code === 'BOARD_SCHEMA_INVALID'
    && error.path.endsWith('/lock_groups')
    && error.keyword === 'minItems'));
});

test('coordination timestamps require strict RFC 3339 calendar values', () => {
  assert.equal(isStrictRfc3339('2026-07-26T20:00:00.000Z'), true);
  assert.equal(isStrictRfc3339('2026-07-26'), false);
  assert.equal(isStrictRfc3339('2026-02-29T20:00:00Z'), false);
  assert.equal(isStrictRfc3339('2024-02-29T20:00:00+02:00'), true);
  assert.equal(isStrictRfc3339('2026-07-26 20:00:00Z'), false);
});

test('acceptance check identifiers are unique within a task', () => {
  const task = taskFixture({
    acceptance: [
      acceptanceFixture({ command: ['node', 'real-check.js'] }),
      acceptanceFixture({ command: ['true'] }),
    ],
  });
  const errors = validateBoardDocument(boardFixture(task), {
    now: new Date('2026-07-26T20:00:00.000Z'),
  });
  assert.ok(errors.some((error) =>
    error.code === 'DUPLICATE_ACCEPTANCE_CHECK_ID'
    && error.check_id === 'fixture-check'));
});

test('acceptance commands cannot invoke shells, inline code, or mismatched sentinels', () => {
  for (const acceptance of [
    acceptanceFixture({ command: ['sh', '-c', 'true'] }),
    acceptanceFixture({ command: ['node', '-e', 'process.exit(0)'] }),
    acceptanceFixture({ command: ['node', '--eval=process.exit(0)'] }),
    acceptanceFixture({ command: ['node', '--import=./run-me.js'] }),
    acceptanceFixture({
      command: ['node', '--test', 'test/../../outside.test.js'],
    }),
    acceptanceFixture({
      command: ['node', '--test', 'test/./fixture.test.js'],
    }),
    acceptanceFixture({ command: ['rg', '--pre', 'run-me', 'pattern'] }),
    acceptanceFixture({
      command: ['rg', '-n', 'pattern', '.', '--hostname-bin=run-me'],
    }),
    acceptanceFixture({ command: ['git', '-c', 'alias.x=!run-me', 'x'] }),
    acceptanceFixture({
      execution_class: 'manual',
      command: ['node', 'fixture-check.js'],
    }),
  ]) {
    assert.notDeepEqual(
      validateBoardDocument(boardFixture(taskFixture({ acceptance: [acceptance] })), {
        now: new Date('2026-07-26T20:00:00.000Z'),
      }),
      [],
    );
  }
});

test('acceptance exit policies cannot treat a failed test as success', () => {
  for (const expectedExitCodes of [[1], [0, 1]]) {
    const acceptance = acceptanceFixture({
      expected_exit_codes: expectedExitCodes,
    });
    const errors = validateBoardDocument(
      boardFixture(taskFixture({ acceptance: [acceptance] })),
      { now: new Date('2026-07-26T20:00:00.000Z') },
    );
    assert.ok(errors.some((error) =>
      error.code === 'ACCEPTANCE_EXIT_POLICY_INVALID'));
  }
});

test('every task has a focused test-first CI acceptance route', () => {
  const noTestFirstCheck = taskFixture({
    acceptance: [
      acceptanceFixture({
        command: ['rg', '-n', 'forbidden-pattern', 'src'],
      }),
    ],
  });
  const errors = validateBoardDocument(boardFixture(noTestFirstCheck), {
    now: new Date('2026-07-26T20:00:00.000Z'),
  });
  assert.ok(errors.some((error) =>
    error.code === 'TASK_TEST_FIRST_ACCEPTANCE_REQUIRED'));
});

test('canonical origin matching is an exact shared allowlist', () => {
  for (const remote of CANONICAL_ORIGIN_URLS) {
    assert.equal(isCanonicalOriginUrl(remote), true, remote);
  }
  assert.equal(
    isCanonicalOriginUrl(
      'https://evilgithub.com/edwin0912-00/zeely-ai-engineering-test.git',
    ),
    false,
  );
  assert.equal(
    isCanonicalOriginUrl(
      'https://github.com/edwin0912-00/zeely-ai-engineering-test.git?token=leak',
    ),
    false,
  );
});

test('scope validation receives every introduced path, including transient changes', () => {
  const history = [
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'cccccccccccccccccccccccccccccccccccccccc bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  ].join('\n');
  const observed = collectIntroducedHistoryPaths(history, (parent, commit) => {
    if (commit.startsWith('b')) return ['src/outside/transient.js'];
    assert.ok(parent.startsWith('b'));
    return ['src/inside/final.js', 'src/outside/transient.js'];
  });
  assert.deepEqual(observed.errors, []);
  assert.deepEqual(observed.paths, [
    'src/inside/final.js',
    'src/outside/transient.js',
  ]);
  const task = taskFixture({ allowed_paths: ['src/inside/**'] });
  assert.ok(validateTaskScope(task, observed.paths).some((error) =>
    error.code === 'PATH_OUTSIDE_TASK_SCOPE'
    && error.path === 'src/outside/transient.js'));
});

test('control and handoff-only diffs do not masquerade as product changes', () => {
  for (const coordinationPath of [
    'TASKS.json',
    'tools/coordination/control-plane.mjs',
    '.agents/README.md',
    '.agents/handoffs/CTRL-001.json',
  ]) {
    assert.equal(isProductPath(coordinationPath), false, coordinationPath);
  }
  assert.equal(isProductPath('src/web/scene-service.js'), true);
  assert.equal(isProductPath('package.json'), true);
  assert.equal(isProductPath('package-lock.json'), true);
});

test('the shared repository verifier rejects missing or mismatched context pins', () => {
  const valid = boardFixture(taskFixture({
    required_context: [
      {
        path: 'spec/ZEELY_CANON_UA.md',
        git_blob_sha: 'bc077a4cdeefabeede93315af1db860dd0ce0b50',
      },
    ],
  }));
  assert.deepEqual(verifyActiveContextPins(valid, ROOT, ACTIVE_STATES), []);

  const wrongBlob = structuredClone(valid);
  wrongBlob.tasks[0].required_context[0].git_blob_sha =
    '1111111111111111111111111111111111111111';
  assert.ok(
    verifyActiveContextPins(wrongBlob, ROOT, ACTIVE_STATES)
      .some((error) => error.code === 'TASK_CONTEXT_BLOB_MISMATCH'),
  );

  const missingBase = structuredClone(valid);
  missingBase.tasks[0].base_sha = '1111111111111111111111111111111111111111';
  assert.ok(
    verifyActiveContextPins(missingBase, ROOT, ACTIVE_STATES)
      .some((error) => error.code === 'TASK_BASE_COMMIT_MISSING'),
  );
});

test('watcher startup failures are one JSON document without a stack trace', () => {
  const result = spawnSync(
    process.execPath,
    ['tools/coordination/watch-assignments.mjs', '--once'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, WARDROBE_AGENT_ID: '' },
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr.trim());
  assert.equal(error.ok, false);
  assert.deepEqual(error.errors, [{ code: 'WARDROBE_AGENT_ID_REQUIRED' }]);

  const invalidInterval = spawnSync(
    process.execPath,
    [
      'tools/coordination/watch-assignments.mjs',
      '--agent',
      'agent-fixture',
      '--interval',
      'nope',
      '--once',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env },
    },
  );
  assert.equal(invalidInterval.status, 1);
  assert.equal(invalidInterval.stdout, '');
  const intervalError = JSON.parse(invalidInterval.stderr.trim());
  assert.equal(intervalError.ok, false);
  assert.deepEqual(intervalError.errors, [{
    code: 'WATCH_ARGUMENT_INVALID',
    message: '--interval must be an integer from 5 to 3600',
  }]);
});

test('ordinary pull-request CI enforces trusted scope before candidate execution', () => {
  const workflow = readFileSync(
    path.join(ROOT, '.github/workflows/agent-regression.yml'),
    'utf8',
  );
  const scopeGate = workflow.indexOf('trusted/tools/coordination/assert-pr-scope.mjs');
  const candidateInstall = workflow.indexOf('Install candidate test dependencies');
  assert.ok(scopeGate >= 0);
  assert.ok(candidateInstall > scopeGate);
  assert.match(
    workflow,
    /candidate-regression:\n\s+needs: \[classify, task-acceptance\]/u,
  );
  assert.match(
    workflow,
    /trusted-test-compatibility:\n\s+needs: \[classify, task-acceptance\]/u,
  );
  assert.equal(
    [...workflow.matchAll(/run: npm ci(?! --ignore-scripts)/gu)].length,
    0,
  );
});

function boardFixture(task) {
  return {
    schema_version: '1.0.0',
    integration_branch: 'integration/wardrobe-20260726',
    orchestrator: 'codex-main',
    updated_at: '2026-07-26T20:00:00.000Z',
    tasks: [task],
  };
}

function taskFixture(overrides = {}) {
  return {
    id: 'WARD-100',
    title: 'Fixture task',
    priority: 'P1',
    state: 'IN_PROGRESS',
    owner: 'agent-fixture',
    branch: 'lane/WARD-100/agent-fixture',
    base_sha: BASE_SHA,
    lease: {
      generation: 1,
      issued_at: '2026-07-26T19:00:00.000Z',
      expires_at: '2026-07-27T19:00:00.000Z',
    },
    lock_groups: ['scene-core'],
    allowed_paths: [
      'src/fixture/**',
      '.agents/handoffs/WARD-100.json',
    ],
    forbidden_paths: ['secrets/**'],
    required_context: [],
    depends_on: [],
    acceptance: [acceptanceFixture()],
    stop_conditions: [],
    ...overrides,
  };
}

function acceptanceFixture(overrides = {}) {
  return {
    check_id: 'fixture-check',
    execution_class: 'ci',
    command: ['node', '--test', 'test/fixture/fixture-check.test.js'],
    expected_exit_codes: [0],
    expected: 'PASS',
    ...overrides,
  };
}
