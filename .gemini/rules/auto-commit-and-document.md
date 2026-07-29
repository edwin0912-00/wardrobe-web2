# Wardrobe Project — Auto-commit & Documentation Rule

## When this rule applies
This rule applies whenever you are working in the `wardrobe-antigravity-*` or `zeely-ai-engineering-test` repository.

## After completing ANY work, ALWAYS do ALL of the following:

### 1. Run tests before commit
```bash
node --test test/video/*.test.js  # or relevant test suite
```

### 2. Update LIVE_STATUS.md
Add a new entry at the top of `handoff/LIVE_STATUS.md` (after `<!-- entries -->`) with:
- Timestamp in format `YYYY-MM-DD HH:MM`
- Agent id: `antigravity-20260727-fb7a90` (or current)
- Status: `INTENT` (starting), `PROGRESS` (mid-work), `DONE` (finished), `BLOCKED` (stuck), `DEPLOYED` (pushed)
- What was done — specific files, test counts, commit SHAs
- `HEAD: <sha>`

### 3. Update UPDATE.md
Update the relevant row in the `Active queue` table:
- Change `State` to reflect current status
- Update `One concrete outcome` with what was actually delivered

### 4. Git commit with agent prefix
```bash
git add <changed files> handoff/LIVE_STATUS.md UPDATE.md
git commit -m '[agent:antigravity-20260727-fb7a90] <type>(<scope>): <description>'
```
The commit subject MUST start with `[agent:<agent-id>]`.

### 5. Git push
```bash
git push origin beta
```

### 6. If sandbox is broken
Use a subagent (TypeName: "self") to execute commands. The subagent's sandbox may work even when the parent's doesn't. Use `BypassSandbox: true` for git push (needs network).

## Commit message format
- `feat(video):` — new feature
- `fix(video):` — bugfix
- `docs:` — documentation only
- `test:` — test changes

## NEVER skip documentation
Even for 1-line fixes — always record in LIVE_STATUS.md and push.
