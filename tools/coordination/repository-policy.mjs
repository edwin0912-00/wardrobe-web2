import { execFileSync } from 'node:child_process';

export const CANONICAL_INTEGRATION_BRANCH = 'integration/wardrobe-20260726';

export const CANONICAL_ORIGIN_URLS = Object.freeze([
  'https://github.com/edwin0912-00/zeely-ai-engineering-test',
  'https://github.com/edwin0912-00/zeely-ai-engineering-test.git',
  'git@github.com:edwin0912-00/zeely-ai-engineering-test',
  'git@github.com:edwin0912-00/zeely-ai-engineering-test.git',
  'ssh://git@github.com/edwin0912-00/zeely-ai-engineering-test.git',
]);

const CANONICAL_ORIGIN_SET = new Set(CANONICAL_ORIGIN_URLS);

export function isCanonicalOriginUrl(value) {
  return typeof value === 'string' && CANONICAL_ORIGIN_SET.has(value.trim());
}

export function collectIntroducedHistoryPaths(historyRows, pathsForEdge) {
  const paths = new Set();
  const errors = [];
  for (const row of historyRows.split('\n').filter(Boolean)) {
    const [commit, ...parents] = row.trim().split(/\s+/u);
    if (parents.length !== 1) {
      errors.push({ code: 'PR_HISTORY_NOT_LINEAR', commit });
      continue;
    }
    for (const changedPath of pathsForEdge(parents[0], commit)) {
      if (changedPath) paths.add(changedPath);
    }
  }
  return { paths: [...paths].sort(), errors };
}

export function verifyActiveContextPins(board, repositoryRoot, activeStates) {
  const errors = [];
  for (const task of board.tasks.filter((candidate) => activeStates.has(candidate.state))) {
    try {
      execFileSync('git', ['cat-file', '-e', `${task.base_sha}^{commit}`], {
        cwd: repositoryRoot,
        stdio: 'ignore',
      });
    } catch {
      errors.push({ code: 'TASK_BASE_COMMIT_MISSING', task_id: task.id });
      continue;
    }
    for (const context of task.required_context) {
      try {
        const observed = execFileSync(
          'git',
          ['rev-parse', `${task.base_sha}:${context.path}`],
          { cwd: repositoryRoot, encoding: 'utf8' },
        ).trim();
        if (observed !== context.git_blob_sha) {
          errors.push({
            code: 'TASK_CONTEXT_BLOB_MISMATCH',
            task_id: task.id,
            path: context.path,
          });
        }
      } catch {
        errors.push({
          code: 'TASK_CONTEXT_MISSING_AT_BASE',
          task_id: task.id,
          path: context.path,
        });
      }
    }
  }
  return errors;
}
