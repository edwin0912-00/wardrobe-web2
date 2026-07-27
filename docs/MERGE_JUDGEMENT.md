# Deciding which version is final

Earned on 2026-07-26, when two agents fixed the same three problems independently and the repo had no
rule for what to do about it. This is the rule.

## The situation this covers

Two lanes both changed the same file, and neither is wrong. It is not a race and the later commit is
not the winner. Both sides were solving a real problem with real evidence, and one of them saw
something the other did not.

## The rule

**You may not overwrite one version with another on the grounds of priority, recency, authorship or
who happens to be merging.** Every conflicting hunk gets a decision, and the decision gets a reason
recorded next to it.

### 1. Assume combine, not choose

Measured on the first real reconciliation here: eight conflicts, and **six of them needed both
sides**. We had each fixed half of the same defect from opposite ends.

A worked example. Two versions of the same function signature:

- one took `(payload, delivery)` because the audit measures the candidate's own crop against the frame
- the other took `(payload, waiverPolicy)` because the policy is per-preset

Neither is redundant. The resolution was `(payload, { delivery, waiverPolicy })`. Anyone picking a
side would have silently deleted a working feature and had green tests to prove it was fine.

If you find yourself deleting one side wholesale, stop and re-read why it was written.

### 2. Judge on evidence, and say what the evidence is

Rank the reasons in this order:

1. **A live measurement.** "Attempt 3 failed framing and light together, so a geometric repair there
   would have been spent on a frame that was going to fail anyway" beats any argument from taste.
2. **A test that fails against the other version.** Not a test that passes — that proves nothing.
3. **A documented incident.** "This gating is why it never fired on the observed failure mode" is a
   reason. "This looks cleaner" is not.
4. **Strictness, when nothing above separates them.** The narrower rule is the safer default, because
   a rule that is too tight fails loudly and a rule that is too loose fails silently.

### 3. Write down which side won and why

Per conflict, in the merge commit or a companion file: which side, what evidence, and what the losing
side was trying to protect. The next person to touch that line needs to know a decision was made
there, or they will re-litigate it from scratch — or worse, restore the other half by accident.

### 4. The one who merges is not the one who accepts

Whoever resolved the conflicts cannot also certify the result. Two versions of one fix combine into a
chimera very easily, and it passes tests, because both sides' tests still run. A second agent reviews
with one explicit question: **was a check suppressed to make this merge green?**

### 5. Reconcile early, while it is small

The fork that produced this rule was one day old: six commits against thirteen, eight files. It was
already a day's work to resolve. The board now warns when more than one branch is ahead of `main`,
because that warning is the cheapest moment to act.

## What to hand over when you are not the one merging

The side that does not merge writes the reasoning, not the resolution. For each conflict: what my half
does, which incident it came from, what breaks if it is dropped, and where I would defer. Say
explicitly where you want to be argued with — a reason held so tightly that nobody can challenge it
is how a wrong pick survives.

## Where this does not apply

Trivial conflicts — an import list, a version bump, whitespace — take the union or the newer and move
on. Reserve the ceremony for hunks where both sides changed behaviour.
