#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {
  isProductPath,
  taskForBranch,
  validateBoardDocument,
  validateHandoffDocument,
  validateOrchestratorQueueScope,
  validateTaskScope,
} from './control-plane.mjs';
import {
  collectIntroducedHistoryPaths,
  verifyActiveContextPins,
} from './repository-policy.mjs';

const args = parseArgs(process.argv.slice(2));
for (const required of ['base', 'head', 'branch']) {
  if (!args[required]) throw new Error(`--${required} is required`);
}

const root = path.resolve(args.root ?? process.cwd());
let board;
try {
  board = JSON.parse(execFileSync(
    'git',
    ['show', `${args.base}:TASKS.json`],
    { cwd: root, encoding: 'utf8' },
  ));
} catch (error) {
  fail('BASE_TASK_BOARD_UNREADABLE', { base: args.base, message: error.message });
}
const isOrchestratorQueueUpdate = args.branch === `control/${board.orchestrator}`;
const boardErrors = validateBoardDocument(
  board,
  isOrchestratorQueueUpdate
    ? { now: new Date(board.updated_at) }
    : undefined,
);
if (boardErrors.length > 0) fail('TASK_BOARD_INVALID', boardErrors);

const mergeBase = execFileSync(
  'git',
  ['merge-base', args.base, args.head],
  { cwd: root, encoding: 'utf8' },
).trim();
if (isOrchestratorQueueUpdate && mergeBase !== args.base) {
  fail('ORCHESTRATOR_QUEUE_STALE_BASE', {
    expected_base: args.base,
    merge_base: mergeBase,
  });
}
const changedPaths = execFileSync(
  'git',
  ['diff', '--name-only', '--no-renames', `${mergeBase}...${args.head}`, '--'],
  { cwd: root, encoding: 'utf8' },
).split('\n').filter(Boolean);
const historyRows = execFileSync(
  'git',
  ['rev-list', '--reverse', '--topo-order', '--parents', `${mergeBase}..${args.head}`],
  { cwd: root, encoding: 'utf8' },
);
const historyScope = collectIntroducedHistoryPaths(historyRows, (parent, commit) =>
  execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--no-renames', parent, commit, '--'],
    { cwd: root, encoding: 'buffer' },
  ).toString('utf8').split('\0').filter(Boolean));
if (historyScope.errors.length > 0) {
  fail('PR_HISTORY_INVALID', historyScope.errors);
}

if (isOrchestratorQueueUpdate) {
  const queueScopeErrors = [
    ...validateOrchestratorQueueScope(historyScope.paths),
    ...validateOrchestratorQueueScope(changedPaths),
  ];
  if (queueScopeErrors.length > 0) {
    fail('ORCHESTRATOR_QUEUE_SCOPE_INVALID', queueScopeErrors);
  }
  let candidateBoard;
  try {
    candidateBoard = JSON.parse(execFileSync(
      'git',
      ['show', `${args.head}:TASKS.json`],
      { cwd: root, encoding: 'utf8' },
    ));
  } catch (error) {
    fail('CANDIDATE_TASK_BOARD_UNREADABLE', { message: error.message });
  }
  if (candidateBoard.schema_version !== board.schema_version
    || candidateBoard.integration_branch !== board.integration_branch
    || candidateBoard.orchestrator !== board.orchestrator) {
    fail('ORCHESTRATOR_QUEUE_IDENTITY_CHANGED', {
      expected: {
        schema_version: board.schema_version,
        integration_branch: board.integration_branch,
        orchestrator: board.orchestrator,
      },
    });
  }
  const candidateErrors = validateBoardDocument(candidateBoard);
  candidateErrors.push(
    ...verifyActiveContextPins(candidateBoard, root, new Set([
      'ASSIGNED',
      'IN_PROGRESS',
      'REVIEW',
    ])),
  );
  if (candidateErrors.length > 0) {
    fail('CANDIDATE_TASK_BOARD_INVALID', candidateErrors);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    route: 'orchestrator-queue',
    owner: board.orchestrator,
    changed_paths: changedPaths,
  })}\n`);
  process.exit(0);
}

const task = taskForBranch(board, args.branch);
if (!task) fail('BRANCH_HAS_NO_TASK', { branch: args.branch });
if (!['IN_PROGRESS', 'REVIEW'].includes(task.state)) {
  fail('TASK_NOT_OPEN_FOR_PR', { task_id: task.id, state: task.state });
}

try {
  execFileSync('git', ['merge-base', '--is-ancestor', task.base_sha, mergeBase], {
    cwd: root,
    stdio: 'ignore',
  });
} catch {
  fail('TASK_BASE_NOT_ANCESTOR', { task_base_sha: task.base_sha, merge_base: mergeBase });
}
const controlOnlyDelta = execFileSync(
  'git',
  ['diff', '--name-only', '--no-renames', `${task.base_sha}..${mergeBase}`, '--'],
  { cwd: root, encoding: 'utf8' },
).split('\n').filter(Boolean);
const nonControlDelta = controlOnlyDelta.filter(isProductPath);
if (nonControlDelta.length > 0) {
  fail('TASK_BASE_PRODUCT_DRIFT', {
    task_base_sha: task.base_sha,
    merge_base: mergeBase,
    product_paths: nonControlDelta,
  });
}

const errors = validateTaskScope(task, changedPaths, { orchestrator: board.orchestrator });
if (errors.length > 0) fail('PR_SCOPE_INVALID', errors);

const historyScopeErrors = validateTaskScope(
  task,
  historyScope.paths,
  { orchestrator: board.orchestrator },
);
if (historyScopeErrors.length > 0) {
  fail('PR_HISTORY_SCOPE_INVALID', historyScopeErrors);
}

const handoff = `.agents/handoffs/${task.id}.json`;
if (!changedPaths.includes(handoff)) {
  fail('HANDOFF_MISSING', { expected: handoff });
}
{
  let handoffDocument;
  try {
    handoffDocument = JSON.parse(execFileSync(
      'git',
      ['show', `${args.head}:${handoff}`],
      { cwd: root, encoding: 'utf8' },
    ));
  } catch (error) {
    fail('HANDOFF_UNREADABLE', { expected: handoff, message: error.message });
  }
  const handoffErrors = validateHandoffDocument(handoffDocument, task, changedPaths);
  if (handoffErrors.length > 0) fail('HANDOFF_INVALID', handoffErrors);
  const headParent = execFileSync(
    'git',
    ['rev-parse', `${args.head}^`],
    { cwd: root, encoding: 'utf8' },
  ).trim();
  if (handoffDocument.tested_code_sha !== headParent) {
    fail('HANDOFF_NOT_BOUND_TO_HEAD_PARENT', {
      tested_code_sha: handoffDocument.tested_code_sha,
      head_parent: headParent,
    });
  }
  const finalCommitPaths = execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', `${headParent}..${args.head}`, '--'],
    { cwd: root, encoding: 'utf8' },
  ).split('\n').filter(Boolean);
  if (finalCommitPaths.length !== 1 || finalCommitPaths[0] !== handoff) {
    fail('HANDOFF_COMMIT_NOT_ISOLATED', { expected: [handoff], observed: finalCommitPaths });
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  task_id: task.id,
  owner: task.owner,
  changed_paths: changedPaths,
})}\n`);

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];
    if (!current.startsWith('--')) throw new Error(`Unexpected argument: ${current}`);
    parsed[current.slice(2)] = values[index + 1];
    index += 1;
  }
  return parsed;
}

function fail(code, details) {
  process.stderr.write(`${JSON.stringify({ ok: false, code, details }, null, 2)}\n`);
  process.exit(1);
}
