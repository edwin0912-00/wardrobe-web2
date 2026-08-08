# New-agent and lost-work recovery

Use this when a chat, subscription, agent session or local checkout disappears.
It restores facts before making changes and protects uncommitted work.

## 1. Identify the repository without changing it

```bash
git -C /known/workspace rev-parse --show-toplevel
git -C /known/workspace status --short --branch
git -C /known/workspace remote -v
git -C /known/workspace rev-parse HEAD
git -C /known/workspace diff --stat
git -C /known/workspace diff --cached --stat
git -C /known/workspace ls-files --others --exclude-standard
```

Do not reset, clean, checkout or stash an unknown workspace. Uncommitted files
belong to the previous agent/user until inventoried.

## 2. Preserve local-only work

Create a sibling recovery clone/worktree, not a destructive rewrite of the
original directory. Record:

- absolute workspace path;
- branch and HEAD;
- modified, staged and untracked paths;
- `git diff --binary` and `git diff --cached --binary` patches in a private local
  recovery directory;
- hashes for untracked binary assets that may matter.

Never add runtime photos, credentials, cookies, `.env` values or provider auth
stores to Git.

## 3. Fetch canonical truth

Engine:

```bash
git clone --branch beta \
  https://github.com/edwin0912-00/zeely-ai-engineering-test.git \
  zeely-ai-engineering-test
```

Cinematic frontend:

```bash
git clone --branch main \
  https://github.com/edwin0912-00/wardrobe-web2.git \
  wardrobe-web2
```

Authentication uses the operator's GitHub credential manager, `gh auth login`,
or an approved short-lived token outside command history. Never embed a token in
a repository URL, handoff file or shell script.

## 4. Read canonical context

```bash
cd zeely-ai-engineering-test
sed -n '1,220p' docs/final-context/README.md
sed -n '1,260p' docs/final-context/STATUS_AND_GAPS.md
jq . docs/final-context/project-canon.json >/dev/null
```

Then read `OWNERS.md`, `STATE.md`, `LOG.md` and any current coordination board
before reserving paths.

## 5. Verify exact live state

```bash
curl -fsS https://beta.madeforthisjob.com/api/health | jq .
curl -fsS https://www.madeforthisjob.com/api/health | jq .
git fetch origin --prune
git rev-parse origin/beta
```

Do not infer deployment from Git. Compare the health `release_sha` with the
candidate commit and release receipt.

## 6. Resume work safely

1. Create a clean dedicated worktree/branch from the current source authority.
2. Reserve only the paths owned by the task.
3. Reproduce one defect or establish one acceptance check.
4. Add a behavior-level regression that fails before the fix.
5. Implement the smallest correction.
6. Run focused tests and an adversarial `weakened_checks` review.
7. Commit code and evidence together.
8. Integrate through the release owner; never push directly over a shared dirty
   checkout.
9. Deploy exact SHA and run the real public journey before claiming E2E PASS.

## 7. Fast orientation statement

A newly attached agent should be able to report, without editing anything:

```text
repository + branch + HEAD
dirty paths
source authority SHA
deployed release SHA
assigned pipeline block
last verified Code / Deployed / E2E evidence
next single atom
```

If any of these is unknown, the agent is not ready to deploy.
