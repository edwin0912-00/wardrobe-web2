import { createHash } from 'node:crypto';
import { agentStatusLabels } from './agent-status-labels.mjs';

export function makeReportWatchReadyEvent({ observedAt, intervalSeconds }) {
  return {
    ok: true,
    event: 'REPORT_WATCH_READY',
    observed_at: observedAt,
    interval_seconds: intervalSeconds,
  };
}

export function makeStatusReport(task, status) {
  return {
    task_id: task.id,
    agent_id: task.owner,
    branch: task.branch,
    state: status.state,
    observed_at: status.observed_at,
    observed_head_sha: status.observed_head_sha,
    summary_code: status.summary_code,
    next_action_code: status.next_action_code,
    blocker_code: status.blocker_code,
    labels: agentStatusLabels(status),
  };
}

export function digestReportEvent(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function sanitizedWatchError(code, task = null) {
  return task ? { code, task_id: task.id, agent_id: task.owner } : { code };
}
