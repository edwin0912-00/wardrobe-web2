import { matchOwnedPath } from './path-policy.mjs';
import { validateStatusShape } from './schema-validation.mjs';

export const AGENT_STATUS_STATES = Object.freeze([
  'STARTED',
  'HEARTBEAT',
  'BLOCKED',
  'READY_FOR_REVIEW',
]);

export const STATUS_HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;
export const STATUS_HEARTBEAT_TTL_MS = 15 * 60 * 1000;
export const STATUS_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const LIVE_REPORT_STATES = new Set(['STARTED', 'HEARTBEAT']);

export function statusPathForTask(task) {
  if (!task || typeof task.id !== 'string' || task.id.length === 0) {
    throw new Error('A task id is required to resolve its status path');
  }
  return `.agents/status/${task.id}.json`;
}

export function taskMayPublishStatus(task) {
  const expected = statusPathForTask(task);
  return Array.isArray(task?.allowed_paths)
    && task.allowed_paths.some((candidate) => candidate === expected);
}

export function createAgentStatus({
  task,
  state,
  observedAt,
  observedHeadSha,
  summaryCode,
  nextActionCode,
  blockerCode = null,
}) {
  return {
    schema_version: '1.0.0',
    task_id: task.id,
    agent_id: task.owner,
    branch: task.branch,
    base_sha: task.base_sha,
    lease_generation: task.lease.generation,
    state,
    observed_at: observedAt,
    observed_head_sha: observedHeadSha,
    summary_code: summaryCode,
    next_action_code: nextActionCode,
    blocker_code: blockerCode,
  };
}

export function validateAgentStatusDocument(status, task, {
  now = new Date(),
} = {}) {
  const errors = validateStatusShape(status);
  if (errors.length > 0) return errors;

  if (!taskMayPublishStatus(task)) {
    errors.push({ code: 'STATUS_PATH_NOT_LEASED', path: statusPathForTask(task) });
  }
  if (status.task_id !== task.id) errors.push({ code: 'STATUS_TASK_MISMATCH' });
  if (status.agent_id !== task.owner) errors.push({ code: 'STATUS_AGENT_MISMATCH' });
  if (status.branch !== task.branch) errors.push({ code: 'STATUS_BRANCH_MISMATCH' });
  if (status.base_sha !== task.base_sha) errors.push({ code: 'STATUS_BASE_MISMATCH' });
  if (status.lease_generation !== task.lease.generation) {
    errors.push({ code: 'STATUS_LEASE_GENERATION_MISMATCH' });
  }
  if (status.state === 'BLOCKED' && status.blocker_code === null) {
    errors.push({ code: 'STATUS_BLOCKER_REQUIRED' });
  }
  if (status.state !== 'BLOCKED' && status.blocker_code !== null) {
    errors.push({ code: 'STATUS_BLOCKER_STATE_MISMATCH' });
  }
  const observedAt = Date.parse(status.observed_at);
  const nowAt = now.valueOf();
  if (Number.isFinite(observedAt) && observedAt > nowAt + STATUS_MAX_CLOCK_SKEW_MS) {
    errors.push({ code: 'STATUS_OBSERVED_AT_FUTURE' });
  }
  if (Number.isFinite(observedAt)
    && LIVE_REPORT_STATES.has(status.state)
    && observedAt < nowAt - STATUS_HEARTBEAT_TTL_MS) {
    errors.push({ code: 'STATUS_STALE' });
  }
  return errors;
}

export function statusPathIsExactForTask(task, candidatePath) {
  return candidatePath === statusPathForTask(task)
    && matchOwnedPath(candidatePath, statusPathForTask(task));
}
