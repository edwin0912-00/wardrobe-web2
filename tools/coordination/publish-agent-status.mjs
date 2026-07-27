#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  ACTIVE_STATES,
  taskForBranch,
  validateBoardDocument,
} from './control-plane.mjs';
import {
  createAgentStatus,
  statusPathForTask,
  taskMayPublishStatus,
  validateAgentStatusDocument,
} from './agent-status.mjs';
import {
  CANONICAL_INTEGRATION_BRANCH,
  isCanonicalOriginUrl,
  verifyActiveContextPins,
} from './repository-policy.mjs';

class PublicError extends Error {
  constructor(code, details = null) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

const root = process.cwd();
let args;
try {
  args = parseArgs(process.argv.slice(2));
  const agent = process.env.WARDROBE_AGENT_ID;
  if (!agent) throw new PublicError('WARDROBE_AGENT_ID_REQUIRED');
  const state = requiredArg(args, 'state');
  const taskId = requiredArg(args, 'task');
  const summaryCode = requiredArg(args, 'summary-code');
  const nextActionCode = requiredArg(args, 'next-action-code');
  const task = loadRemoteAssignedTask({ root, agent, taskId });
  const blockerCode = parseBlockerCode({ args, state });
  const status = createAgentStatus({
    task,
    state,
    observedAt: new Date().toISOString(),
    observedHeadSha: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    summaryCode,
    nextActionCode,
    blockerCode,
  });
  const errors = validateAgentStatusDocument(status, task);
  if (errors.length > 0) throw new PublicError('STATUS_INVALID', { errors });
  const target = path.join(root, statusPathForTask(task));
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    task_id: task.id,
    state: status.state,
    status_path: statusPathForTask(task),
  })}\n`);
} catch (error) {
  const payload = error instanceof PublicError
    ? { ok: false, code: error.code, ...(error.details ? { details: error.details } : {}) }
    : { ok: false, code: 'STATUS_PUBLISH_FAILED' };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
}

function loadRemoteAssignedTask({ root: repositoryRoot, agent, taskId }) {
  const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  if (!isCanonicalOriginUrl(remoteUrl)) throw new PublicError('CANONICAL_REMOTE_MISMATCH');
  execFileSync('git', ['fetch', '--quiet', 'origin', CANONICAL_INTEGRATION_BRANCH], {
    cwd: repositoryRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 15_000,
    killSignal: 'SIGTERM',
  });
  let board;
  try {
    board = JSON.parse(execFileSync('git', ['show', 'FETCH_HEAD:TASKS.json'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }));
  } catch {
    throw new PublicError('REMOTE_BOARD_UNREADABLE');
  }
  const boardErrors = validateBoardDocument(board);
  boardErrors.push(...verifyActiveContextPins(board, repositoryRoot, ACTIVE_STATES));
  if (boardErrors.length > 0) throw new PublicError('REMOTE_BOARD_INVALID');
  const task = board.tasks.find((candidate) => candidate.id === taskId);
  if (!task || task.owner !== agent || !ACTIVE_STATES.has(task.state)) {
    throw new PublicError('NO_ACTIVE_REMOTE_ASSIGNMENT');
  }
  const branch = execFileSync('git', ['branch', '--show-current'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  if (branch !== task.branch || taskForBranch(board, branch)?.id !== task.id) {
    throw new PublicError('STATUS_BRANCH_NOT_ASSIGNED');
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', task.base_sha, 'HEAD'], {
      cwd: repositoryRoot,
      stdio: 'ignore',
    });
  } catch {
    throw new PublicError('TASK_BASE_NOT_IN_LOCAL_BRANCH');
  }
  if (!taskMayPublishStatus(task)) throw new PublicError('STATUS_PATH_NOT_LEASED');
  return task;
}

function parseBlockerCode({ args: values, state }) {
  const code = values['blocker-code'];
  if (state === 'BLOCKED') {
    if (!code) throw new PublicError('BLOCKER_REQUIRED');
    return code;
  }
  if (code) throw new PublicError('BLOCKER_FORBIDDEN_FOR_STATE');
  return null;
}

function parseArgs(values) {
  const allowed = new Set([
    'task',
    'state',
    'summary-code',
    'next-action-code',
    'blocker-code',
  ]);
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];
    if (!current.startsWith('--')) throw new PublicError('STATUS_ARGUMENT_INVALID');
    const key = current.slice(2);
    if (!allowed.has(key)) throw new PublicError('STATUS_ARGUMENT_INVALID');
    const value = values[index + 1];
    if (!value || value.startsWith('--') || Object.hasOwn(parsed, key)) {
      throw new PublicError('STATUS_ARGUMENT_INVALID');
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function requiredArg(values, name) {
  if (!values[name]) throw new PublicError('STATUS_ARGUMENT_REQUIRED');
  return values[name];
}
