#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ACTIVE_STATES,
  validateBoardDocument,
} from './control-plane.mjs';
import {
  taskMayPublishStatus,
  statusPathForTask,
  validateAgentStatusDocument,
} from './agent-status.mjs';
import {
  digestReportEvent,
  makeReportWatchReadyEvent,
  makeStatusReport,
  sanitizedWatchError,
} from './agent-reporting.mjs';
import {
  CANONICAL_INTEGRATION_BRANCH,
  isCanonicalOriginUrl,
  verifyActiveContextPins,
} from './repository-policy.mjs';

const remote = 'origin';
const root = process.cwd();
let args;
let intervalSeconds;
try {
  args = parseArgs(process.argv.slice(2));
  intervalSeconds = integerArg(args.interval ?? '20', '--interval', 5, 3600);
  assertCanonicalRemote();
} catch (error) {
  emitFailure(error);
  process.exit(1);
}

const once = args.once === 'true';
const requestedTask = args.task ?? null;
process.stdout.write(`${JSON.stringify(makeReportWatchReadyEvent({
  observedAt: new Date().toISOString(),
  intervalSeconds,
}))}\n`);

let previousDigest = null;
do {
  const observedAt = new Date().toISOString();
  let event;
  try {
    event = readReportSnapshot({ observedAt, requestedTask });
  } catch (error) {
    event = {
      ok: false,
      event: 'REPORT_WATCH_ERROR',
      observed_at: observedAt,
      errors: [sanitizedWatchError(error?.code ?? 'REPORT_WATCH_FAILED')],
    };
  }
  const digest = digestReportEvent(event);
  if (digest !== previousDigest) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
    previousDigest = digest;
  }
  if (!once) await delay(intervalSeconds * 1000);
} while (!once);

function readReportSnapshot({ observedAt, requestedTask: taskFilter }) {
  runGit(['fetch', '--quiet', remote, CANONICAL_INTEGRATION_BRANCH]);
  const board = readJsonFromGit('FETCH_HEAD:TASKS.json');
  const boardErrors = validateBoardDocument(board);
  boardErrors.push(...verifyActiveContextPins(board, root, ACTIVE_STATES));
  if (boardErrors.length > 0) throw publicError('REMOTE_BOARD_INVALID');
  const activeTasks = board.tasks
    .filter((task) => ACTIVE_STATES.has(task.state) && taskMayPublishStatus(task))
    .filter((task) => taskFilter === null || task.id === taskFilter);
  if (taskFilter !== null && activeTasks.length === 0) throw publicError('REPORT_TASK_NOT_ACTIVE');

  const reports = [];
  const issues = [];
  for (const task of activeTasks) {
    const result = readTaskReport(task, observedAt);
    if (result.report) reports.push(result.report);
    if (result.issue) issues.push(result.issue);
  }
  return {
    ok: true,
    event: 'AGENT_REPORTS',
    observed_at: observedAt,
    integration_branch: CANONICAL_INTEGRATION_BRANCH,
    reports,
    issues,
  };
}

function readTaskReport(task, observedAt) {
  try {
    runGit(['fetch', '--quiet', remote, task.branch]);
  } catch {
    return { issue: sanitizedWatchError('AGENT_BRANCH_UNAVAILABLE', task) };
  }
  let status;
  try {
    status = readJsonFromGit(`FETCH_HEAD:${statusPathForTask(task)}`);
  } catch {
    return { issue: sanitizedWatchError('STATUS_NOT_PUBLISHED', task) };
  }
  const errors = validateAgentStatusDocument(status, task, { now: new Date(observedAt) });
  if (errors.length > 0) {
    const code = errors.some((error) => error.code === 'STATUS_STALE')
      ? 'STATUS_STALE'
      : 'STATUS_INVALID';
    return { issue: sanitizedWatchError(code, task) };
  }
  try {
    runGit(['merge-base', '--is-ancestor', status.observed_head_sha, 'FETCH_HEAD']);
  } catch {
    return { issue: sanitizedWatchError('STATUS_HEAD_NOT_IN_LANE', task) };
  }
  return { report: makeStatusReport(task, status) };
}

function assertCanonicalRemote() {
  let remoteUrl;
  try {
    remoteUrl = runGit(['remote', 'get-url', remote], { encoding: 'utf8' }).trim();
  } catch {
    throw publicError('CANONICAL_REMOTE_UNREADABLE');
  }
  if (!isCanonicalOriginUrl(remoteUrl)) throw publicError('CANONICAL_REMOTE_MISMATCH');
}

function readJsonFromGit(revisionPath) {
  try {
    return JSON.parse(runGit(['show', revisionPath], { encoding: 'utf8' }));
  } catch {
    throw publicError('REMOTE_ARTIFACT_UNREADABLE');
  }
}

function runGit(argv, options = {}) {
  return execFileSync('git', argv, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
    killSignal: 'SIGTERM',
    ...options,
  });
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];
    if (!current.startsWith('--')) throw publicError('WATCH_ARGUMENT_INVALID');
    const key = current.slice(2);
    if (key === 'once') {
      if (Object.hasOwn(parsed, key)) throw publicError('WATCH_ARGUMENT_INVALID');
      parsed.once = 'true';
      continue;
    }
    const value = values[index + 1];
    if (!value || value.startsWith('--') || Object.hasOwn(parsed, key)) {
      throw publicError('WATCH_ARGUMENT_INVALID');
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function integerArg(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw publicError('WATCH_ARGUMENT_INVALID');
  }
  return parsed;
}

function publicError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function emitFailure(error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    event: 'REPORT_WATCH_ERROR',
    errors: [sanitizedWatchError(error?.code ?? 'REPORT_WATCH_FAILED')],
  })}\n`);
}
