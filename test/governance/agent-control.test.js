import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  matchOwnedPath,
  validateBoardDocument,
  validateHandoffDocument,
  validateTaskScope,
} from '../../tools/coordination/control-plane.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the repository contains the canonical coordination files', async () => {
  for (const file of ['AGENTS.md', 'OWNERS.md', 'LOG.md', 'STATE.md', 'TASKS.json']) {
    await assert.doesNotReject(access(path.join(ROOT, file)), `${file} must exist`);
  }
});

test('the checked-in task board is internally valid', async () => {
  const board = JSON.parse(await readFile(path.join(ROOT, 'TASKS.json'), 'utf8'));
  assert.deepEqual(validateBoardDocument(board), []);
});

test('two active tasks cannot own the same write surface', () => {
  const board = {
    schema_version: '1.0.0',
    integration_branch: 'integration/wardrobe-20260726',
    orchestrator: 'codex-main',
    updated_at: '2026-07-26T20:00:00.000Z',
    tasks: [
      taskFixture({
        id: 'WARD-101',
        branch: 'lane/WARD-101/agent-a',
        owner: 'agent-a',
        allowed_paths: ['src/web/**'],
      }),
      taskFixture({
        id: 'WARD-102',
        branch: 'lane/WARD-102/agent-b',
        owner: 'agent-b',
        allowed_paths: ['src/web/scene-service.js'],
      }),
    ],
  };
  assert.ok(
    validateBoardDocument(board).some((error) => error.code === 'ACTIVE_SCOPE_OVERLAP'),
  );
});

test('a task branch is refused when its diff leaves the assigned scope', () => {
  const task = taskFixture({
    id: 'WARD-103',
    branch: 'lane/WARD-103/agent-c',
    owner: 'agent-c',
    allowed_paths: [
      'src/providers/**',
      'test/providers/**',
      '.agents/handoffs/WARD-103.json',
    ],
  });
  assert.deepEqual(
    validateTaskScope(task, [
      'src/providers/example.js',
      'test/providers/example.test.js',
      '.agents/handoffs/WARD-103.json',
    ]),
    [],
  );
  assert.deepEqual(
    validateTaskScope(task, ['src/web/scene-service.js']),
    [{ code: 'PATH_OUTSIDE_TASK_SCOPE', path: 'src/web/scene-service.js' }],
  );
});

test('path matching is anchored and never treats sibling prefixes as ownership', () => {
  assert.equal(matchOwnedPath('src/web/scene-service.js', 'src/web/**'), true);
  assert.equal(matchOwnedPath('src/webish/scene-service.js', 'src/web/**'), false);
  assert.equal(matchOwnedPath('STATE.md', 'STATE.md'), true);
});

test('an active task with an expired lease is refused', () => {
  const board = {
    schema_version: '1.0.0',
    integration_branch: 'integration/wardrobe-20260726',
    orchestrator: 'codex-main',
    updated_at: '2026-07-26T20:00:00.000Z',
    tasks: [
      taskFixture({
        lease: {
          generation: 1,
          issued_at: '2026-07-26T18:00:00.000Z',
          expires_at: '2026-07-26T19:00:00.000Z',
        },
      }),
    ],
  };
  assert.ok(
    validateBoardDocument(board, { now: new Date('2026-07-26T20:00:00.000Z') })
      .some((error) => error.code === 'ACTIVE_TASK_LEASE_EXPIRED'),
  );
});

test('partial-component globs cannot hide an active ownership overlap', () => {
  const board = {
    schema_version: '1.0.0',
    integration_branch: 'integration/wardrobe-20260726',
    orchestrator: 'codex-main',
    updated_at: '2026-07-26T20:00:00.000Z',
    tasks: [
      taskFixture({
        id: 'WARD-201',
        owner: 'agent-a',
        branch: 'lane/WARD-201/agent-a',
        lock_groups: ['media-assets'],
        allowed_paths: ['assets/editorial-*/**'],
      }),
      taskFixture({
        id: 'WARD-202',
        owner: 'agent-b',
        branch: 'lane/WARD-202/agent-b',
        lock_groups: ['public-ui'],
        allowed_paths: ['assets/editorial-blue/**'],
      }),
    ],
  };
  assert.ok(
    validateBoardDocument(board).some((error) => error.code === 'ACTIVE_SCOPE_OVERLAP'),
  );
});

test('a non-orchestrator cannot lease a broad path over the control plane', () => {
  const board = {
    schema_version: '1.0.0',
    integration_branch: 'integration/wardrobe-20260726',
    orchestrator: 'codex-main',
    updated_at: '2026-07-26T20:00:00.000Z',
    tasks: [
      taskFixture({
        id: 'WARD-203',
        owner: 'agent-a',
        branch: 'lane/WARD-203/agent-a',
        allowed_paths: ['tools/**'],
      }),
    ],
  };
  assert.ok(
    validateBoardDocument(board)
      .some((error) => error.code === 'AGENT_SCOPE_OVERLAPS_CONTROL_PLANE'),
  );
});

test('Git transport policy files belong only to the orchestrator', () => {
  const task = taskFixture();
  for (const controlledPath of ['.gitattributes', '.gitmodules']) {
    assert.ok(
      validateTaskScope(task, [controlledPath])
        .some((error) => error.code === 'ORCHESTRATOR_CONTROL_PATH_CHANGED'),
    );
  }
});

test('JSON Schema is the structural owner for task and handoff fields', () => {
  const board = {
    schema_version: '1.0.0',
    integration_branch: 'integration/wardrobe-20260726',
    orchestrator: 'codex-main',
    updated_at: '2026-07-26T20:00:00.000Z',
    tasks: [{ ...taskFixture(), invented_field: true }],
  };
  assert.ok(
    validateBoardDocument(board).some((error) => error.code === 'BOARD_SCHEMA_INVALID'),
  );
});

test('a handoff cannot hide changed files or a weakened check', () => {
  const task = taskFixture();
  const paths = ['src/fixture/change.js', '.agents/handoffs/WARD-100.json'];
  const handoff = {
    schema_version: '1.0.0',
    task_id: task.id,
    agent_id: task.owner,
    branch: task.branch,
    base_sha: task.base_sha,
    lease_generation: task.lease.generation,
    tested_code_sha: '1111111111111111111111111111111111111111',
    status: 'READY_FOR_REVIEW',
    summary: 'Fixture complete.',
    changed_paths: paths,
    pre_change_proof: [
      {
        check_id: 'fixture-test',
        command: ['node', '--test', 'test/fixture.test.js'],
        result: 'FAIL',
        evidence: 'Failed before fix.',
      },
    ],
    post_change_proof: [
      {
        check_id: 'fixture-test',
        command: ['node', '--test', 'test/fixture.test.js'],
        result: 'PASS',
        evidence: 'Passed after fix.',
      },
    ],
    adversarial_review: {
      goal: 'Find bypasses.',
      result: 'PASS',
      reviewer_id: 'reviewer-fixture',
      reviewed_code_sha: '1111111111111111111111111111111111111111',
    },
    weakened_checks: [],
    open_risks: [],
  };
  assert.deepEqual(validateHandoffDocument(handoff, task, paths), []);
  assert.ok(
    validateHandoffDocument(
      { ...handoff, weakened_checks: ['Skipped a gate.'] },
      task,
      paths,
    ).some((error) => error.code === 'WEAKENED_CHECKS_BLOCK_MERGE'),
  );
  assert.ok(
    validateHandoffDocument(
      { ...handoff, changed_paths: ['src/fixture/change.js'] },
      task,
      paths,
    ).some((error) => error.code === 'HANDOFF_CHANGED_PATHS_MISMATCH'),
  );
  assert.ok(
    validateHandoffDocument(
      {
        ...handoff,
        adversarial_review: {
          ...handoff.adversarial_review,
          result: 'REVISE',
        },
      },
      task,
      paths,
    ).some((error) => error.code === 'HANDOFF_ADVERSARIAL_REVIEW_NOT_GREEN'),
  );
  assert.ok(
    validateHandoffDocument(
      {
        ...handoff,
        open_risks: [
          {
            code: 'CRITICAL_RISK',
            severity: 'BLOCKING',
            description: 'Must be resolved before integration.',
          },
        ],
      },
      task,
      paths,
    ).some((error) => error.code === 'HANDOFF_BLOCKING_RISKS_PRESENT'),
  );
});

function taskFixture(overrides = {}) {
  return {
    id: 'WARD-100',
    title: 'Fixture task',
    priority: 'P1',
    state: 'IN_PROGRESS',
    owner: 'agent-fixture',
    branch: 'lane/WARD-100/agent-fixture',
    base_sha: '622c8783060cb64970e7c8952d51ca7c50307edd',
    lease: {
      generation: 1,
      issued_at: '2026-07-26T20:00:00.000Z',
      expires_at: '2026-07-27T20:00:00.000Z',
    },
    lock_groups: ['scene-core'],
    allowed_paths: ['src/fixture/**'],
    forbidden_paths: ['secrets/**'],
    required_context: [],
    depends_on: [],
    acceptance: [
      {
        check_id: 'fixture-test',
        execution_class: 'ci',
        command: ['node', '--test', 'test/fixture.test.js'],
        expected_exit_codes: [0],
        expected: 'PASS',
      },
    ],
    stop_conditions: [],
    ...overrides,
  };
}
