import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createAgentStatus,
  statusPathForTask,
  taskMayPublishStatus,
  validateAgentStatusDocument,
} from '../../tools/coordination/agent-status.mjs';
import { validateBoardDocument, validateTaskScope } from '../../tools/coordination/control-plane.mjs';
import { makeReportWatchReadyEvent, makeStatusReport } from '../../tools/coordination/agent-reporting.mjs';
import { validateSafeReportText } from '../../tools/coordination/safe-report-text.mjs';

const TASK = Object.freeze({
  id: 'WARD-101',
  owner: 'agent-a',
  branch: 'lane/WARD-101/agent-a',
  base_sha: '1111111111111111111111111111111111111111',
  lease: Object.freeze({ generation: 4 }),
  allowed_paths: Object.freeze([
    'src/fixture/**',
    '.agents/status/WARD-101.json',
  ]),
});

test('a status is bound to exactly one task, lease, branch, and allowed path', () => {
  const status = createAgentStatus({
    task: TASK,
    state: 'HEARTBEAT',
    observedAt: '2026-07-27T00:00:00.000Z',
    observedHeadSha: '2222222222222222222222222222222222222222',
    summaryCode: 'FOCUSED_PROOF_RUNNING',
    nextActionCode: 'RUN_FOCUSED_PROOF',
  });

  assert.equal(statusPathForTask(TASK), '.agents/status/WARD-101.json');
  assert.deepEqual(validateAgentStatusDocument(status, TASK, {
    now: new Date('2026-07-27T00:01:00.000Z'),
  }), []);
  assert.ok(
    validateAgentStatusDocument({ ...status, task_id: 'WARD-102' }, TASK)
      .some((error) => error.code === 'STATUS_TASK_MISMATCH'),
  );
  assert.ok(
    validateAgentStatusDocument({ ...status, branch: 'lane/WARD-101/other' }, TASK)
      .some((error) => error.code === 'STATUS_BRANCH_MISMATCH'),
  );
});

test('status schema admits only checked-in codes, not arbitrary report text', () => {
  const status = createAgentStatus({
    task: TASK,
    state: 'HEARTBEAT',
    observedAt: '2026-07-27T00:00:00.000Z',
    observedHeadSha: '2222222222222222222222222222222222222222',
    summaryCode: 'IMPLEMENTATION_ACTIVE',
    nextActionCode: 'RUN_FOCUSED_PROOF',
  });
  for (const unsafeText of [
    'Authorization: Bearer should never be here',
    ['saved at', '', 'Users', 'example', 'private.png'].join('/'),
    'temporary result at /tmp/private-report.json',
    'path=/root/private.png',
    'copy runtime/runs/secret.json',
    'api_key=not-allowed',
    ['token', 'not-allowed'].join(': '),
    ['sk', 'not', 'allowed', 'credential'].join('-'),
    'prompt: private instruction',
    'artifact=run_private-id',
    'operator@example.com',
    '+380 12 345 6789',
    '380123456789',
    '/mnt/secure/output.png',
    '/usr/local/private.txt',
    '/Library/Keychains/x',
    'data:image/png;base64,AAAA',
    '600 123 456',
  ]) {
    const withFreeText = {
      ...status,
      summary_code: unsafeText,
      summary: unsafeText,
      next_checkpoint: unsafeText,
      blocker: { code: 'UNKNOWN_SAFE_STOP', description: unsafeText },
    };
    assert.ok(
      validateAgentStatusDocument(withFreeText, TASK, {
        now: new Date('2026-07-27T00:01:00.000Z'),
      }).some((error) => error.code === 'STATUS_SCHEMA_INVALID'),
      unsafeText,
    );
  }
});

test('the report sanitizer also rejects the known path, data URL, and bare-phone bypasses', () => {
  for (const unsafeText of [
    '/mnt/secure/output.png',
    '/usr/local/private.txt',
    '/Library/Keychains/x',
    'data:image/png;base64,AAAA',
    '600 123 456',
  ]) {
    assert.ok(validateSafeReportText(unsafeText).length > 0, unsafeText);
  }
});

test('watcher renders human labels only from checked-in code mappings', () => {
  const status = createAgentStatus({
    task: TASK,
    state: 'HEARTBEAT',
    observedAt: '2026-07-27T00:00:00.000Z',
    observedHeadSha: '2222222222222222222222222222222222222222',
    summaryCode: 'FOCUSED_PROOF_PASSED',
    nextActionCode: 'RUN_ADVERSARIAL_REVIEW',
  });
  assert.deepEqual(makeStatusReport(TASK, status), {
    task_id: 'WARD-101',
    agent_id: 'agent-a',
    branch: 'lane/WARD-101/agent-a',
    state: 'HEARTBEAT',
    observed_at: '2026-07-27T00:00:00.000Z',
    observed_head_sha: '2222222222222222222222222222222222222222',
    summary_code: 'FOCUSED_PROOF_PASSED',
    next_action_code: 'RUN_ADVERSARIAL_REVIEW',
    blocker_code: null,
    labels: {
      summary: 'Цільова перевірка пройшла.',
      next_action: 'Запустити незалежне adversarial review.',
      blocker: null,
    },
  });
});

test('the checked-in Looper is deterministic and has no local source path', () => {
  const resolved = JSON.parse(readFileSync(
    'ops/zeely-agent-coordination-loop/loop.resolved.json',
    'utf8',
  ));
  assert.equal(resolved.source, 'ops/zeely-agent-coordination-loop/loop.yaml');
  assert.deepEqual(resolved.host.invoke, ['python3', 'scripts/deterministic-observer.py']);
  assert.deepEqual(resolved.council, []);
  assert.doesNotMatch(JSON.stringify(resolved), /\/(?:Users|root|home)\//u);
});

test('live STARTED and HEARTBEAT reports become stale while terminal reports remain readable', () => {
  const started = createAgentStatus({
    task: TASK,
    state: 'STARTED',
    observedAt: '2026-07-27T00:00:00.000Z',
    observedHeadSha: '2222222222222222222222222222222222222222',
    summaryCode: 'CONTEXT_READ',
    nextActionCode: 'RUN_PRECHANGE_PROOF',
  });
  assert.ok(
    validateAgentStatusDocument(started, TASK, {
      now: new Date('2026-07-27T00:16:00.000Z'),
    }).some((error) => error.code === 'STATUS_STALE'),
  );
  assert.deepEqual(
    validateAgentStatusDocument({ ...started, state: 'READY_FOR_REVIEW' }, TASK, {
      now: new Date('2026-07-27T00:16:00.000Z'),
    }),
    [],
  );
});

test('blocked state requires a typed blocker code and ready state cannot carry one', () => {
  const blocked = createAgentStatus({
    task: TASK,
    state: 'BLOCKED',
    observedAt: '2026-07-27T00:00:00.000Z',
    observedHeadSha: '2222222222222222222222222222222222222222',
    summaryCode: 'SAFE_STOP',
    nextActionCode: 'AWAIT_ORCHESTRATOR',
    blockerCode: 'CONTEXT_MISSING',
  });
  assert.deepEqual(validateAgentStatusDocument(blocked, TASK), []);

  const readyWithBlocker = { ...blocked, state: 'READY_FOR_REVIEW' };
  assert.ok(
    validateAgentStatusDocument(readyWithBlocker, TASK)
      .some((error) => error.code === 'STATUS_BLOCKER_STATE_MISMATCH'),
  );
});

test('the Looper workspace is ignored before it can retain watcher context', () => {
  const ignored = spawnSync('git', [
    'check-ignore',
    '-q',
    'ops/zeely-agent-coordination-loop/loop-workspace/context.md',
  ], { encoding: 'utf8' });
  assert.equal(ignored.status, 0);
});

test('the status publisher rejects legacy free-text flags before it can touch Git', () => {
  const result = spawnSync(process.execPath, [
    path.resolve('tools/coordination/publish-agent-status.mjs'),
    '--task', 'WARD-101',
    '--state', 'STARTED',
    '--summary', 'saved at /mnt/secure/output.png',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /STATUS_ARGUMENT_INVALID/u);
  assert.doesNotMatch(result.stderr, /secure\/output/u);
});

test('the report watcher emits an immediate typed health event', () => {
  assert.deepEqual(
    makeReportWatchReadyEvent({
      observedAt: '2026-07-27T00:00:00.000Z',
      intervalSeconds: 20,
    }),
    {
      ok: true,
      event: 'REPORT_WATCH_READY',
      observed_at: '2026-07-27T00:00:00.000Z',
      interval_seconds: 20,
    },
  );
});

test('the board rejects wildcard or cross-task status ownership', () => {
  const board = {
    schema_version: '1.0.0',
    integration_branch: 'integration/wardrobe-20260726',
    orchestrator: 'codex-main',
    updated_at: '2026-07-27T00:00:00.000Z',
    tasks: [{
      ...TASK,
      title: 'Fixture task',
      priority: 'P1',
      state: 'IN_PROGRESS',
      lock_groups: ['scene-core'],
      forbidden_paths: ['secrets/**'],
      required_context: [],
      depends_on: [],
      acceptance: [{
        check_id: 'status-test',
        execution_class: 'ci',
        command: ['node', '--test', 'test/governance/agent-status.test.js'],
        expected_exit_codes: [0],
        expected: 'PASS',
      }],
      stop_conditions: [],
      allowed_paths: ['.agents/status/**'],
      lease: {
        generation: 4,
        issued_at: '2026-07-27T00:00:00.000Z',
        expires_at: '2026-07-28T00:00:00.000Z',
      },
    }],
  };
  assert.ok(
    validateBoardDocument(board).some((error) => error.code === 'TASK_STATUS_PATH_NOT_EXACT'),
  );
});

test('a legacy active lease remains valid but cannot publish a status artifact', () => {
  const board = {
    schema_version: '1.0.0',
    integration_branch: 'integration/wardrobe-20260726',
    orchestrator: 'codex-main',
    updated_at: '2026-07-27T00:00:00.000Z',
    tasks: [{
      ...TASK,
      title: 'Fixture task',
      priority: 'P1',
      state: 'IN_PROGRESS',
      lock_groups: ['scene-core'],
      forbidden_paths: ['secrets/**'],
      required_context: [],
      depends_on: [],
      acceptance: [{
        check_id: 'status-test',
        execution_class: 'ci',
        command: ['node', '--test', 'test/governance/agent-status.test.js'],
        expected_exit_codes: [0],
        expected: 'PASS',
      }],
      stop_conditions: [],
      allowed_paths: ['src/fixture/**'],
      lease: {
        generation: 4,
        issued_at: '2026-07-27T00:00:00.000Z',
        expires_at: '2026-07-28T00:00:00.000Z',
      },
    }],
  };
  assert.deepEqual(validateBoardDocument(board), []);
  assert.equal(taskMayPublishStatus(board.tasks[0]), false);
});

test('a task may change only its exact leased status artifact', () => {
  assert.deepEqual(
    validateTaskScope(TASK, ['.agents/status/WARD-101.json']),
    [],
  );
  assert.ok(
    validateTaskScope(TASK, ['.agents/status/WARD-102.json'])
      .some((error) => error.code === 'PATH_OUTSIDE_TASK_SCOPE'),
  );
});

test('the coordination report checker rejects private content without echoing it', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wardrobe-report-'));
  try {
    const reportPath = path.join(directory, 'report.md');
    writeFileSync(reportPath, [
      '# Coordination report',
      '## Observed reports',
      'No report has been published.',
      '## Required follow-up',
      'Ask the task owner to publish a heartbeat.',
      '## Safety boundary',
      'No lane mutation occurred.',
    ].join('\n'));
    const valid = spawnSync(process.execPath, [
      path.resolve('tools/coordination/check-coordination-report.mjs'),
      'report.md',
    ], { cwd: directory, encoding: 'utf8' });
    assert.equal(valid.status, 0);
    assert.match(valid.stdout, /COORDINATION_REPORT_VALID/u);

    writeFileSync(reportPath, [
      '# Coordination report',
      '## Observed reports',
      'saved at /tmp/private.png',
      '## Required follow-up',
      'None.',
      '## Safety boundary',
      'No lane mutation occurred.',
    ].join('\n'));
    const invalid = spawnSync(process.execPath, [
      path.resolve('tools/coordination/check-coordination-report.mjs'),
      'report.md',
    ], { cwd: directory, encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /COORDINATION_REPORT_PRIVATE_CONTENT/u);
    assert.doesNotMatch(invalid.stderr, /private\.png/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
