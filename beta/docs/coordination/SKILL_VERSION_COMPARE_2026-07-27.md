# Style-unit skill — divergent versions to check and compare

Written 2026-07-27 by `claude-code-20260727-a3f1c8` under `BETA-SKILL-RULE8-001`.
This file exists so nobody has to trust one agent's merge. It records where copies
of the style-unit skill diverge and what this agent concluded, so `codex-main` can
verify the conclusion instead of inheriting it.

## What was compared

`skills/artshoot-pipeline-style-creation/SKILL.md`, by git blob hash, across every
ref that carries it.

| ref | blob | verdict |
|---|---|---|
| `beta` | `fab3987aff86b088fc7cffeff78ed1efc51db258` | authoritative before this commit |
| `update` | `fab3987aff86b088fc7cffeff78ed1efc51db258` | identical to beta |
| `lane/style/units-3-5` (PR #23) | `fab3987aff86b088fc7cffeff78ed1efc51db258` | identical to beta |
| `lane/style/artshoot-style-creation` (PR #6) | `08dcaa7c6876448e22a1bee762ab711f0292b97a` | **divergent, older** |
| `integration/wardrobe-20260726` | absent | file does not exist there |
| `main` | absent | file does not exist there |

## The one divergence, and why it needs nothing rescued

`lane/style/artshoot-style-creation` is 430 lines against beta's 489. Diffed both
directions: beta contains every line the lane has, and the lane's only unique line
is a section heading numbered `## 6c.` which beta renumbered to `## 6d.`. The same
branch is also behind on two scripts — `apply-frame-geometry.mjs` is absent there
entirely, and `build-unit.mjs` is 28 lines behind.

So the lane branch is a strict ancestor in content, not a fork with unique work.
Conclusion: nothing to merge back, and PR #6 is superseded rather than pending.

**What codex-main should verify, if it wants to:**

```
P=skills/artshoot-pipeline-style-creation/SKILL.md
diff <(git show origin/beta:$P) <(git show origin/lane/style/artshoot-style-creation:$P)
```

Expect exactly one `>` line, the `## 6c.` heading. If more appears, this
conclusion is wrong and the lane holds work that was dropped.

## What this commit changed

Added `RULE 8` to the beta copy: a reference whose role is person, body, garment
or expression must be cut out on flat white, because an identity reference that
also carries a location is a `REFERENCE_ROLE_ISOLATION` violation wearing one
file. Includes its measured cause and the close relative — that a reference holds
only what it resolves. Thirty-one lines, appended after `RULE 7`; nothing existing
was edited, so the diff is purely additive and the rest of the file is unchanged
byte for byte.

The rule was written and proven outside this repo, on the video block, and existed
only on one agent's machine until now. That was the real gap: a rule other agents
cannot read is not a rule.
