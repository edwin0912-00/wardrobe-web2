#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  taskForBranch,
  validateBoardDocument,
  validateHandoffDocument,
} from './control-plane.mjs';

const args = parseArgs(process.argv.slice(2));
for (const required of ['base', 'head', 'branch']) {
  if (!args[required]) throw new Error(`--${required} is required`);
}
const root = path.resolve(args.root ?? process.cwd());
const board = JSON.parse(git(['show', `${args.base}:TASKS.json`]));
const boardErrors = validateBoardDocument(board);
if (boardErrors.length > 0) fail('TASK_BOARD_INVALID', boardErrors);

const task = taskForBranch(board, args.branch);
if (!task) fail('BRANCH_HAS_NO_TASK', { branch: args.branch });
const mergeBase = git(['merge-base', args.base, args.head]).trim();
const changedPaths = git([
  'diff',
  '--name-only',
  '--no-renames',
  `${mergeBase}...${args.head}`,
  '--',
]).split('\n').filter(Boolean);
const handoffPath = `.agents/handoffs/${task.id}.json`;
let handoff;
try {
  handoff = JSON.parse(git(['show', `${args.head}:${handoffPath}`]));
} catch {
  fail('HANDOFF_UNREADABLE', { path: handoffPath });
}
const handoffErrors = validateHandoffDocument(handoff, task, changedPaths);
if (handoffErrors.length > 0) fail('HANDOFF_INVALID', handoffErrors);
const headParent = git(['rev-parse', `${args.head}^`]).trim();
if (headParent !== handoff.tested_code_sha) {
  fail('HANDOFF_NOT_BOUND_TO_HEAD_PARENT', {
    tested_code_sha: handoff.tested_code_sha,
    head_parent: headParent,
  });
}

const replacements = new Map([
  ['$TASK_BASE_SHA', task.base_sha],
  ['$TESTED_CODE_SHA', handoff.tested_code_sha],
]);
const preChangeChecks = verifyPreChangeFailures({
  task,
  handoff,
  root,
  replacements,
});
const results = [];
for (const check of task.acceptance.filter((candidate) =>
  candidate.execution_class === 'ci')) {
  const command = check.command.map((argument) =>
    expandArgument(argument, replacements));
  const result = runCommand(command, root);
  const exitCode = result.status;
  results.push({
    check_id: check.check_id,
    exit_code: exitCode,
    signal: result.signal ?? null,
    stdout_sha256: digest(result.stdout),
    stderr_sha256: digest(result.stderr),
  });
  if (result.error || !check.expected_exit_codes.includes(exitCode)) {
    fail('ACCEPTANCE_CHECK_FAILED', {
      check_id: check.check_id,
      exit_code: exitCode,
      signal: result.signal ?? null,
      expected_exit_codes: check.expected_exit_codes,
      stdout_sha256: digest(result.stdout),
      stderr_sha256: digest(result.stderr),
    });
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  task_id: task.id,
  tested_code_sha: handoff.tested_code_sha,
  pre_change_checks: preChangeChecks,
  checks: results,
})}\n`);

function verifyPreChangeFailures({
  task: taskDocument,
  handoff: handoffDocument,
  root: repositoryRoot,
  replacements: placeholderValues,
}) {
  const acceptanceById = new Map(
    taskDocument.acceptance.map((check) => [check.check_id, check]),
  );
  const proofs = handoffDocument.pre_change_proof
    .filter((proof) =>
      proof.result === 'FAIL'
      && acceptanceById.get(proof.check_id)?.execution_class === 'ci');
  if (proofs.length === 0) {
    fail('MACHINE_VERIFIABLE_PRECHANGE_PROOF_REQUIRED', {
      task_id: taskDocument.id,
    });
  }
  const changedTests = git([
    'diff',
    '--name-only',
    '--no-renames',
    `${taskDocument.base_sha}...${handoffDocument.tested_code_sha}`,
    '--',
    'test',
  ]).split('\n').filter((candidate) => /\.test\.(?:js|mjs)$/u.test(candidate));
  if (changedTests.length === 0) {
    fail('PRECHANGE_TEST_CHANGE_REQUIRED', { task_id: taskDocument.id });
  }
  for (const proof of proofs) {
    const check = acceptanceById.get(proof.check_id);
    if (!check.command.some((argument) => changedTests.includes(argument))) {
      fail('PRECHANGE_CHECK_NOT_FOCUSED_ON_CHANGED_TEST', {
        check_id: check.check_id,
        changed_tests: changedTests,
      });
    }
  }

  const worktree = mkdtempSync(path.join(tmpdir(), 'wardrobe-prechange-'));
  try {
    execFileSync(
      'git',
      ['worktree', 'add', '--detach', worktree, taskDocument.base_sha],
      {
        cwd: repositoryRoot,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    const dependencyRoot = path.join(repositoryRoot, 'node_modules');
    if (existsSync(dependencyRoot)) {
      symlinkSync(dependencyRoot, path.join(worktree, 'node_modules'), 'dir');
    }
    const patch = execFileSync(
      'git',
      [
        'diff',
        '--binary',
        '--no-renames',
        taskDocument.base_sha,
        handoffDocument.tested_code_sha,
        '--',
        'test',
      ],
      { cwd: repositoryRoot, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
    );
    const applyResult = spawnSync('git', ['apply', '--binary', '-'], {
      cwd: worktree,
      input: patch,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (applyResult.status !== 0) {
      fail('PRECHANGE_TEST_PATCH_FAILED', {
        stderr_sha256: digest(applyResult.stderr),
      });
    }
    return proofs.map((proof) => {
      const check = acceptanceById.get(proof.check_id);
      const command = check.command.map((argument) =>
        expandArgument(argument, placeholderValues));
      const result = runCommand(command, worktree);
      if (result.error || check.expected_exit_codes.includes(result.status)) {
        fail('PRECHANGE_CHECK_DID_NOT_FAIL', {
          check_id: check.check_id,
          exit_code: result.status,
          signal: result.signal ?? null,
          stdout_sha256: digest(result.stdout),
          stderr_sha256: digest(result.stderr),
        });
      }
      return {
        check_id: check.check_id,
        exit_code: result.status,
        signal: result.signal ?? null,
        stdout_sha256: digest(result.stdout),
        stderr_sha256: digest(result.stderr),
      };
    });
  } finally {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', worktree], {
        cwd: repositoryRoot,
        stdio: 'ignore',
      });
    } catch {
      if (existsSync(worktree)) rmSync(worktree, { recursive: true, force: true });
    }
  }
}

function expandArgument(argument, values) {
  let expanded = argument;
  for (const [placeholder, value] of values) {
    expanded = expanded.replaceAll(placeholder, value);
  }
  if (/\$[A-Z][A-Z0-9_]*/u.test(expanded)) {
    fail('UNRESOLVED_ACCEPTANCE_PLACEHOLDER', { argument });
  }
  return expanded;
}

function safeEnvironment() {
  return Object.fromEntries([
    ['CI', 'true'],
    ['LANG', process.env.LANG ?? 'C.UTF-8'],
    ['LC_ALL', process.env.LC_ALL ?? 'C.UTF-8'],
    ['NODE_ENV', 'test'],
    ['NO_UPDATE_NOTIFIER', '1'],
    ['PATH', process.env.PATH ?? ''],
    ['TMPDIR', process.env.TMPDIR ?? '/tmp'],
  ]);
}

function runCommand(command, cwd) {
  return spawnSync(command[0], command.slice(1), {
    cwd,
    env: safeEnvironment(),
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
    shell: false,
  });
}

function digest(value) {
  return createHash('sha256').update(value ?? Buffer.alloc(0)).digest('hex');
}

function git(gitArgs) {
  return execFileSync('git', gitArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith('--') || values[index + 1] == null) {
      throw new Error(`Invalid argument: ${key}`);
    }
    parsed[key.slice(2)] = values[index + 1];
  }
  return parsed;
}

function fail(code, details) {
  process.stderr.write(`${JSON.stringify({ ok: false, code, details })}\n`);
  process.exit(1);
}
