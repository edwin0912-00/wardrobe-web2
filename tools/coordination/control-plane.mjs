import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  validateBoardShape,
  validateHandoffShape,
} from './schema-validation.mjs';
import {
  CONTROL_FILES,
  CONTROL_PATTERNS,
  isProductPath,
  matchOwnedPath,
  normalizeRepoPath,
} from './path-policy.mjs';

export {
  CONTROL_FILES,
  CONTROL_PATTERNS,
  isProductPath,
  matchOwnedPath,
} from './path-policy.mjs';

export const ACTIVE_STATES = new Set(['ASSIGNED', 'IN_PROGRESS', 'REVIEW']);
export const TERMINAL_STATES = new Set(['DONE', 'CANCELLED']);
export const ORCHESTRATOR_QUEUE_PATHS = Object.freeze([
  'OWNERS.md',
  'LOG.md',
  'STATE.md',
  'TASKS.json',
]);
export const TASK_STATES = new Set([
  'BLOCKED',
  'READY',
  'ASSIGNED',
  'IN_PROGRESS',
  'REVIEW',
  'DONE',
  'CANCELLED',
]);
const ACCEPTANCE_EXECUTABLES = new Set([
  'git',
  'manual',
  'node',
  'paid',
  'rg',
]);
const ACCEPTANCE_PLACEHOLDERS = new Set([
  '$TASK_BASE_SHA',
  '$TESTED_CODE_SHA',
]);
const CI_EXECUTABLES = new Set(['git', 'node', 'rg']);
const ORCHESTRATOR_LOCAL_EXECUTABLES = new Set(['node']);
const CI_NODE_DIRECT_COMMANDS = new Set([
  JSON.stringify(['tools/coordination/validate-board.mjs', '--board-only']),
]);
const ORCHESTRATOR_NODE_COMMANDS = new Set([
  JSON.stringify([
    'tools/coordination/check-test-baseline.mjs',
    '--base',
    '$TASK_BASE_SHA',
  ]),
  JSON.stringify(['tools/deploy-add-items-release.mjs']),
]);
const TEST_FILE_PATTERN = /^test\/[A-Za-z0-9._/-]+\.test\.(?:js|mjs)$/u;
export async function loadBoard(root) {
  return JSON.parse(await readFile(path.join(root, 'TASKS.json'), 'utf8'));
}

export function validateBoardDocument(board, {
  now = new Date(),
} = {}) {
  const errors = validateBoardShape(board);
  if (errors.length > 0) return errors;

  const ids = new Set();
  const branches = new Set();
  const taskById = new Map();
  for (const [index, task] of board.tasks.entries()) {
    errors.push(...validateTask(task, index, board.orchestrator, now));
    if (!isPlainObject(task)) continue;
    if (ids.has(task.id)) errors.push({ code: 'DUPLICATE_TASK_ID', task_id: task.id });
    if (branches.has(task.branch)) {
      errors.push({ code: 'DUPLICATE_TASK_BRANCH', branch: task.branch });
    }
    ids.add(task.id);
    branches.add(task.branch);
    taskById.set(task.id, task);
  }

  for (const task of board.tasks.filter(isPlainObject)) {
    for (const dependency of task.depends_on ?? []) {
      if (!taskById.has(dependency)) {
        errors.push({
          code: 'UNKNOWN_TASK_DEPENDENCY',
          task_id: task.id,
          dependency,
        });
      }
    }
    if (ACTIVE_STATES.has(task.state)) {
      for (const dependency of task.depends_on ?? []) {
        const dependencyTask = taskById.get(dependency);
        if (dependencyTask && dependencyTask.state !== 'DONE') {
          errors.push({
            code: 'ACTIVE_TASK_DEPENDENCY_NOT_DONE',
            task_id: task.id,
            dependency,
            dependency_state: dependencyTask.state,
          });
        }
      }
    }
  }
  errors.push(...dependencyCycleErrors(taskById));

  const active = board.tasks.filter((task) => ACTIVE_STATES.has(task?.state));
  for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < active.length; rightIndex += 1) {
      const left = active[leftIndex];
      const right = active[rightIndex];
      if (left.owner === right.owner) {
        errors.push({
          code: 'AGENT_HAS_MULTIPLE_ACTIVE_TASKS',
          owner: left.owner,
          task_ids: [left.id, right.id],
        });
      }
      const sharedLocks = (left.lock_groups ?? []).filter((lock) =>
        (right.lock_groups ?? []).includes(lock));
      if (sharedLocks.length > 0) {
        errors.push({
          code: 'ACTIVE_LOCK_GROUP_OVERLAP',
          task_ids: [left.id, right.id],
          lock_groups: sharedLocks,
        });
      }
      const overlappingPaths = [];
      for (const leftPath of left.allowed_paths ?? []) {
        for (const rightPath of right.allowed_paths ?? []) {
          if (ownedPatternsOverlap(leftPath, rightPath)) {
            overlappingPaths.push([leftPath, rightPath]);
          }
        }
      }
      if (overlappingPaths.length > 0) {
        errors.push({
          code: 'ACTIVE_SCOPE_OVERLAP',
          task_ids: [left.id, right.id],
          paths: overlappingPaths,
        });
      }
    }
  }
  return errors;
}

export function validateTaskScope(task, changedPaths, {
  orchestrator = 'codex-main',
} = {}) {
  const allowed = task.allowed_paths ?? [];
  const errors = [];
  for (const changedPath of changedPaths) {
    const normalized = normalizeRepoPath(changedPath);
    if (task.owner !== orchestrator
      && CONTROL_PATTERNS.some((pattern) => matchOwnedPath(normalized, pattern))) {
      errors.push({ code: 'ORCHESTRATOR_CONTROL_PATH_CHANGED', path: normalized });
      continue;
    }
    if ((task.forbidden_paths ?? []).some((pattern) => matchOwnedPath(normalized, pattern))) {
      errors.push({ code: 'FORBIDDEN_PATH_CHANGED', path: normalized });
      continue;
    }
    if (!allowed.some((pattern) => matchOwnedPath(normalized, pattern))) {
      errors.push({ code: 'PATH_OUTSIDE_TASK_SCOPE', path: normalized });
    }
  }
  return errors;
}

export function validateOrchestratorQueueScope(changedPaths) {
  const observed = new Set(changedPaths.map(normalizeRepoPath));
  const errors = [...observed]
    .filter((changedPath) => !ORCHESTRATOR_QUEUE_PATHS.includes(changedPath))
    .map((changedPath) => ({
      code: 'ORCHESTRATOR_QUEUE_PATH_FORBIDDEN',
      path: changedPath,
    }));
  for (const requiredPath of ['LOG.md', 'STATE.md', 'TASKS.json']) {
    if (!observed.has(requiredPath)) {
      errors.push({
        code: 'ORCHESTRATOR_QUEUE_LEDGER_REQUIRED',
        path: requiredPath,
      });
    }
  }
  return errors;
}

export function validateHandoffDocument(handoff, task, changedPaths) {
  const errors = validateHandoffShape(handoff);
  if (errors.length > 0) return errors;
  if (handoff.task_id !== task.id) errors.push({ code: 'HANDOFF_TASK_MISMATCH' });
  if (handoff.agent_id !== task.owner) errors.push({ code: 'HANDOFF_AGENT_MISMATCH' });
  if (handoff.branch !== task.branch) errors.push({ code: 'HANDOFF_BRANCH_MISMATCH' });
  if (handoff.base_sha !== task.base_sha) errors.push({ code: 'HANDOFF_BASE_MISMATCH' });
  if (handoff.lease_generation !== task.lease.generation) {
    errors.push({ code: 'HANDOFF_LEASE_GENERATION_MISMATCH' });
  }
  if (handoff.status !== 'READY_FOR_REVIEW') errors.push({ code: 'HANDOFF_NOT_READY' });
  const declared = [...new Set(handoff.changed_paths)].sort();
  const observed = [...new Set(changedPaths)].sort();
  if (JSON.stringify(declared) !== JSON.stringify(observed)) {
    errors.push({ code: 'HANDOFF_CHANGED_PATHS_MISMATCH', declared, observed });
  }
  const acceptanceById = new Map(task.acceptance.map((check) => [check.check_id, check]));
  const expectedCheckIds = [...acceptanceById.keys()].sort();
  const postCheckIds = [...new Set(handoff.post_change_proof.map((proof) => proof.check_id))].sort();
  if (JSON.stringify(expectedCheckIds) !== JSON.stringify(postCheckIds)) {
    errors.push({
      code: 'HANDOFF_ACCEPTANCE_COVERAGE_MISMATCH',
      expected: expectedCheckIds,
      observed: postCheckIds,
    });
  }
  for (const proof of [...handoff.pre_change_proof, ...handoff.post_change_proof]) {
    const check = acceptanceById.get(proof.check_id);
    if (!check || JSON.stringify(proof.command) !== JSON.stringify(check.command)) {
      errors.push({ code: 'HANDOFF_PROOF_NOT_BOUND_TO_ACCEPTANCE', check_id: proof.check_id });
    }
  }
  if (!handoff.pre_change_proof.some((proof) =>
    proof.result === 'FAIL' && acceptanceById.has(proof.check_id))) {
    errors.push({ code: 'HANDOFF_PRE_CHANGE_FAILURE_REQUIRED' });
  }
  if (handoff.post_change_proof.some((proof) => proof.result !== 'PASS')) {
    errors.push({ code: 'HANDOFF_POST_CHANGE_PROOF_NOT_GREEN' });
  }
  if (handoff.weakened_checks.length > 0) {
    errors.push({
      code: 'WEAKENED_CHECKS_BLOCK_MERGE',
      weakened_checks: handoff.weakened_checks,
    });
  }
  if (handoff.adversarial_review.reviewer_id === handoff.agent_id) {
    errors.push({ code: 'HANDOFF_REVIEWER_NOT_INDEPENDENT' });
  }
  if (handoff.adversarial_review.result !== 'PASS') {
    errors.push({
      code: 'HANDOFF_ADVERSARIAL_REVIEW_NOT_GREEN',
      result: handoff.adversarial_review.result,
    });
  }
  if (handoff.adversarial_review.reviewed_code_sha !== handoff.tested_code_sha) {
    errors.push({ code: 'HANDOFF_REVIEW_SHA_MISMATCH' });
  }
  const blockingRisks = handoff.open_risks
    .filter((risk) => risk.severity === 'BLOCKING')
    .map((risk) => risk.code);
  if (blockingRisks.length > 0) {
    errors.push({
      code: 'HANDOFF_BLOCKING_RISKS_PRESENT',
      risks: blockingRisks,
    });
  }
  return errors;
}

export function taskForBranch(board, branch) {
  return board.tasks.find((task) => task.branch === branch) ?? null;
}

function validateTask(task, index, orchestrator, now) {
  const errors = [];
  const at = { index, task_id: task?.id ?? null };
  if (task.branch !== `lane/${task.id}/${task.owner}`) {
    errors.push({ code: 'TASK_BRANCH_OWNER_MISMATCH', ...at });
  }
  if (Date.parse(task.lease.expires_at) <= Date.parse(task.lease.issued_at)) {
    errors.push({ code: 'TASK_LEASE_INVALID', ...at });
  }
  if (ACTIVE_STATES.has(task.state) && task.owner === 'unassigned') {
    errors.push({ code: 'ACTIVE_TASK_UNASSIGNED', ...at });
  }
  if (ACTIVE_STATES.has(task.state)
    && Date.parse(task.lease.expires_at) <= now.valueOf()) {
    errors.push({ code: 'ACTIVE_TASK_LEASE_EXPIRED', ...at });
  }
  const acceptanceIds = new Set();
  const expectedStatusPath = `.agents/status/${task.id}.json`;
  const hasExpectedStatusPath = (task.allowed_paths ?? [])
    .includes(expectedStatusPath);
  for (const allowedPath of task.allowed_paths ?? []) {
    if (allowedPath.startsWith('.agents/status/') && allowedPath !== expectedStatusPath) {
      errors.push({
        code: 'TASK_STATUS_PATH_NOT_EXACT',
        path: allowedPath,
        expected: expectedStatusPath,
        ...at,
      });
    }
  }
  if (ACTIVE_STATES.has(task.state) && !hasExpectedStatusPath) {
    errors.push({
      code: 'ACTIVE_TASK_STATUS_PATH_REQUIRED',
      expected: expectedStatusPath,
      ...at,
    });
  }
  for (const check of task.acceptance) {
    if (acceptanceIds.has(check.check_id)) {
      errors.push({
        code: 'DUPLICATE_ACCEPTANCE_CHECK_ID',
        check_id: check.check_id,
        ...at,
      });
    }
    acceptanceIds.add(check.check_id);
    errors.push(...acceptanceCommandErrors(check, at));
  }
  if (!task.acceptance.some((check) =>
    check.execution_class === 'ci'
    && check.command[0] === 'node'
    && check.command[1] === '--test')) {
    errors.push({ code: 'TASK_TEST_FIRST_ACCEPTANCE_REQUIRED', ...at });
  }
  if (task.owner !== orchestrator) {
    for (const allowedPattern of task.allowed_paths ?? []) {
      for (const controlledPattern of CONTROL_PATTERNS) {
        if (ownedPatternsOverlap(allowedPattern, controlledPattern)) {
          errors.push({
            code: 'AGENT_SCOPE_OVERLAPS_CONTROL_PLANE',
            path: allowedPattern,
            controlled_path: controlledPattern,
            ...at,
          });
        }
      }
    }
  }
  return errors;
}

function acceptanceCommandErrors(check, at) {
  const errors = [];
  const [executable, ...args] = check.command;
  if (!ACCEPTANCE_EXECUTABLES.has(executable)) {
    errors.push({
      code: 'ACCEPTANCE_EXECUTABLE_NOT_ALLOWED',
      check_id: check.check_id,
      executable,
      ...at,
    });
  }
  const expectedExitCodesValid = executable === 'rg'
    ? check.expected_exit_codes.length === 1
      && [0, 1].includes(check.expected_exit_codes[0])
    : JSON.stringify(check.expected_exit_codes) === JSON.stringify([0]);
  if (!expectedExitCodesValid) {
    errors.push({
      code: 'ACCEPTANCE_EXIT_POLICY_INVALID',
      check_id: check.check_id,
      ...at,
    });
  }
  if (check.execution_class === 'ci' && !CI_EXECUTABLES.has(executable)) {
    errors.push({
      code: 'CI_ACCEPTANCE_EXECUTABLE_MISMATCH',
      check_id: check.check_id,
      ...at,
    });
  }
  if (check.execution_class === 'orchestrator_local'
    && !ORCHESTRATOR_LOCAL_EXECUTABLES.has(executable)) {
    errors.push({
      code: 'ORCHESTRATOR_ACCEPTANCE_EXECUTABLE_MISMATCH',
      check_id: check.check_id,
      ...at,
    });
  }
  if ((check.execution_class === 'manual') !== (executable === 'manual')) {
    errors.push({
      code: 'MANUAL_ACCEPTANCE_COMMAND_MISMATCH',
      check_id: check.check_id,
      ...at,
    });
  }
  if ((check.execution_class === 'paid') !== (executable === 'paid')) {
    errors.push({
      code: 'PAID_ACCEPTANCE_COMMAND_MISMATCH',
      check_id: check.check_id,
      ...at,
    });
  }
  if (executable === 'node'
    && check.execution_class === 'ci'
    && !isAllowedCiNodeCommand(args)) {
    errors.push({
      code: 'UNSAFE_NODE_ACCEPTANCE_COMMAND',
      check_id: check.check_id,
      ...at,
    });
  }
  if (executable === 'node'
    && check.execution_class === 'orchestrator_local'
    && !ORCHESTRATOR_NODE_COMMANDS.has(JSON.stringify(args))) {
    errors.push({
      code: 'UNSAFE_ORCHESTRATOR_NODE_COMMAND',
      check_id: check.check_id,
      ...at,
    });
  }
  if (executable === 'git'
    && JSON.stringify(args) !== JSON.stringify([
      'diff',
      '--check',
      '$TASK_BASE_SHA...$TESTED_CODE_SHA',
    ])) {
    errors.push({
      code: 'UNSAFE_GIT_ACCEPTANCE_COMMAND',
      check_id: check.check_id,
      ...at,
    });
  }
  if (executable === 'rg' && !isAllowedRipgrepCommand(args)) {
    errors.push({
      code: 'UNSAFE_RG_ACCEPTANCE_COMMAND',
      check_id: check.check_id,
      ...at,
    });
  }
  for (const arg of args) {
    if (/[\0\r\n]/u.test(arg)) {
      errors.push({
        code: 'ACCEPTANCE_ARGUMENT_CONTROL_CHARACTER',
        check_id: check.check_id,
        ...at,
      });
    }
    const placeholders = arg.match(/\$[A-Z][A-Z0-9_]*/gu) ?? [];
    for (const placeholder of placeholders) {
      if (!ACCEPTANCE_PLACEHOLDERS.has(placeholder)) {
        errors.push({
          code: 'UNKNOWN_ACCEPTANCE_PLACEHOLDER',
          check_id: check.check_id,
          placeholder,
          ...at,
        });
      }
    }
  }
  return errors;
}

function isAllowedCiNodeCommand(args) {
  if (CI_NODE_DIRECT_COMMANDS.has(JSON.stringify(args))) return true;
  return args.length >= 2
    && args[0] === '--test'
    && args.slice(1).every(isSafeTestFilePath);
}

function isSafeTestFilePath(argument) {
  try {
    const normalized = normalizeRepoPath(argument);
    const segments = normalized.split('/');
    return normalized === argument
      && TEST_FILE_PATTERN.test(normalized)
      && segments.every((segment) => segment !== '' && segment !== '.');
  } catch {
    return false;
  }
}

function isAllowedRipgrepCommand(args) {
  if (args.length < 3 || args[0] !== '-n' || args[1].startsWith('-')) return false;
  let sawPath = false;
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--glob') {
      if (args[index + 1] !== '!node_modules/**') return false;
      index += 1;
      continue;
    }
    if (argument.startsWith('-')
      || !/^(?:\.|[A-Za-z0-9._/-]+)$/u.test(argument)
      || argument.includes('..')) {
      return false;
    }
    sawPath = true;
  }
  return sawPath;
}

function dependencyCycleErrors(taskById) {
  const errors = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = (taskId, trail = []) => {
    if (visiting.has(taskId)) {
      errors.push({ code: 'TASK_DEPENDENCY_CYCLE', task_ids: [...trail, taskId] });
      return;
    }
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    const task = taskById.get(taskId);
    for (const dependency of task?.depends_on ?? []) {
      if (taskById.has(dependency)) visit(dependency, [...trail, taskId]);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  };
  for (const taskId of taskById.keys()) visit(taskId);
  return errors;
}

function ownedPatternsOverlap(left, right) {
  const leftHasWildcard = /[*?]/u.test(left);
  const rightHasWildcard = /[*?]/u.test(right);
  if (!leftHasWildcard) return matchOwnedPath(left, right);
  if (!rightHasWildcard) return matchOwnedPath(right, left);
  const leftPrefix = literalPrefix(left);
  const rightPrefix = literalPrefix(right);
  if (leftPrefix === rightPrefix) return true;
  if (!leftPrefix || !rightPrefix) return true;
  return leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix);
}

function literalPrefix(pattern) {
  const normalized = normalizeRepoPath(pattern);
  const wildcard = normalized.search(/[*?]/u);
  return (wildcard === -1 ? normalized : normalized.slice(0, wildcard))
    .replace(/\/+$/u, '');
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
