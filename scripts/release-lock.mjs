import { execFileSync } from 'node:child_process';

export function betaWorkingTreeStatus(repositoryRoot) {
  return execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all', '--', 'beta'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  ).trim();
}

export function assertCommittedBetaTree(repositoryRoot) {
  const status = betaWorkingTreeStatus(repositoryRoot);
  if (status !== '') {
    throw new Error(
      'beta working tree is dirty; commit the candidate and update release/RELEASE.lock.json before release verification',
    );
  }
}
