#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ACTIVE_STATES,
  validateBoardDocument,
} from './control-plane.mjs';
import {
  CANONICAL_INTEGRATION_BRANCH,
  isCanonicalOriginUrl,
  verifyActiveContextPins,
} from './repository-policy.mjs';

const remote = 'origin';
let args;
let intervalSeconds;
try {
  args = parseArgs(process.argv.slice(2));
  intervalSeconds = integerArg(args.interval ?? '20', '--interval', 5, 3600);
} catch (error) {
  emitError([{ code: 'WATCH_ARGUMENT_INVALID', message: error.message }]);
  process.exit(1);
}
const agent = args.agent ?? process.env.WARDROBE_AGENT_ID;
const once = args.once === 'true';

if (!agent) {
  emitError([{ code: 'WARDROBE_AGENT_ID_REQUIRED' }]);
  process.exit(1);
}
let remoteUrl;
try {
  remoteUrl = execFileSync('git', ['remote', 'get-url', remote], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
} catch {
  emitError([{ code: 'CANONICAL_REMOTE_UNREADABLE' }]);
  process.exit(1);
}
if (!isCanonicalOriginUrl(remoteUrl)) {
  emitError([{ code: 'CANONICAL_REMOTE_MISMATCH' }]);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  event: 'ASSIGNMENT_WATCH_READY',
  observed_at: new Date().toISOString(),
  integration_branch: CANONICAL_INTEGRATION_BRANCH,
  agent,
  interval_seconds: intervalSeconds,
})}\n`);

let previousDigest = null;
do {
  try {
    execFileSync('git', ['fetch', '--quiet', remote, CANONICAL_INTEGRATION_BRANCH], {
      cwd: process.cwd(),
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 15_000,
      killSignal: 'SIGTERM',
    });
    const raw = execFileSync('git', ['show', 'FETCH_HEAD:TASKS.json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const board = JSON.parse(raw);
    const errors = validateBoardDocument(board);
    if (errors.length === 0) {
      errors.push(...verifyActiveContextPins(board, process.cwd(), ACTIVE_STATES));
    }
    if (errors.length > 0) throw new Error(`Invalid board: ${JSON.stringify(errors)}`);
    const digest = createHash('sha256').update(raw).digest('hex');
    if (digest !== previousDigest) {
      const assignments = board.tasks.filter((task) =>
        task.owner === agent && ['ASSIGNED', 'IN_PROGRESS', 'REVIEW'].includes(task.state));
      process.stdout.write(`${JSON.stringify({
        observed_at: new Date().toISOString(),
        board_sha256: digest,
        integration_branch: CANONICAL_INTEGRATION_BRANCH,
        agent,
        assignments,
      }, null, 2)}\n`);
      previousDigest = digest;
    }
  } catch (error) {
    emitError([{ code: 'ASSIGNMENT_WATCH_FAILED' }]);
    if (once) process.exitCode = 1;
  }
  if (!once) await delay(intervalSeconds * 1000);
} while (!once);

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];
    if (!current.startsWith('--')) throw new Error(`Unexpected argument: ${current}`);
    const key = current.slice(2);
    if (key === 'once') {
      parsed.once = 'true';
      continue;
    }
    parsed[key] = values[index + 1];
    index += 1;
  }
  return parsed;
}

function integerArg(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function emitError(errors) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    observed_at: new Date().toISOString(),
    errors,
  })}\n`);
}
