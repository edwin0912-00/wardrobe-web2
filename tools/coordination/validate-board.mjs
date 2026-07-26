#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { access } from 'node:fs/promises';
import {
  ACTIVE_STATES,
  CONTROL_FILES,
  loadBoard,
  taskForBranch,
  validateBoardDocument,
} from './control-plane.mjs';
import {
  CANONICAL_INTEGRATION_BRANCH,
  isCanonicalOriginUrl,
  verifyActiveContextPins,
} from './repository-policy.mjs';

const BOARD_ONLY = process.argv.slice(2).includes('--board-only');
const root = path.resolve(process.cwd());
const missing = [];
for (const file of ['AGENTS.md', ...CONTROL_FILES]) {
  try {
    await access(path.join(root, file));
  } catch {
    missing.push({ code: 'CANONICAL_FILE_MISSING', path: file });
  }
}

let boardErrors = [];
let board;
try {
  board = await loadBoard(root);
  boardErrors = validateBoardDocument(board);
  if (boardErrors.length === 0) {
    boardErrors.push(...verifyActiveContextPins(board, root, ACTIVE_STATES));
  }
} catch (error) {
  boardErrors = [{ code: 'TASK_BOARD_UNREADABLE', message: error.message }];
}

const errors = [...missing, ...boardErrors];
if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({ ok: false, errors }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  if (!BOARD_ONLY) {
    const agent = process.env.WARDROBE_AGENT_ID;
    if (!agent) {
      process.stderr.write(`${JSON.stringify({
        ok: false,
        errors: [{ code: 'WARDROBE_AGENT_ID_REQUIRED' }],
      }, null, 2)}\n`);
      process.exit(1);
    }
    verifyRemoteAssignment({ agent, root });
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: BOARD_ONLY ? 'board-only' : 'agent',
    control_files: ['AGENTS.md', ...CONTROL_FILES],
  })}\n`);
}

function verifyRemoteAssignment({ agent, root: repositoryRoot }) {
  const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  if (!isCanonicalOriginUrl(remoteUrl)) {
    fail([{ code: 'CANONICAL_REMOTE_MISMATCH' }]);
  }
  execFileSync('git', ['fetch', '--quiet', 'origin', CANONICAL_INTEGRATION_BRANCH], {
    cwd: repositoryRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const remoteBoard = JSON.parse(execFileSync(
    'git',
    ['show', 'FETCH_HEAD:TASKS.json'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  ));
  const remoteErrors = validateBoardDocument(remoteBoard);
  if (remoteErrors.length === 0) {
    remoteErrors.push(
      ...verifyActiveContextPins(remoteBoard, repositoryRoot, ACTIVE_STATES),
    );
  }
  if (remoteErrors.length > 0) fail(remoteErrors);
  const branch = execFileSync('git', ['branch', '--show-current'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  const task = taskForBranch(remoteBoard, branch);
  if (!task
    || task.owner !== agent
    || !ACTIVE_STATES.has(task.state)) {
    fail([{ code: 'NO_ACTIVE_REMOTE_ASSIGNMENT', agent, branch }]);
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', task.base_sha, 'HEAD'], {
      cwd: repositoryRoot,
      stdio: 'ignore',
    });
  } catch {
    fail([{ code: 'TASK_BASE_NOT_IN_LOCAL_BRANCH', task_id: task.id }]);
  }
}

function fail(failures) {
  process.stderr.write(`${JSON.stringify({ ok: false, errors: failures }, null, 2)}\n`);
  process.exit(1);
}
