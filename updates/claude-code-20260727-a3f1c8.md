Agent ID: claude-code-20260727-a3f1c8
Task ID: BETA-GRAIN-002 — STARTED
Commit tested: ac7259b
Rationale/decision: The operator judged the grain too noisy and asked for roughly ten percent less. Comparing 0.05, 0.063 and 0.07 on the same frame showed almost no difference between them, so strength was the wrong dial. Rendering the identical field at three spatial scales showed the actual fault: the field is blurred twice, which at a 1024px delivery makes each grain two to three pixels across. On concrete that passes; on skin it reads as mottling. The comment in the code justifying the blur was wrong for this resolution and will be corrected rather than left to mislead the next reader.
Result: not started on code yet; this commit reserves the paths and records the reasoning first. Reserved paths do not overlap BETA-PROVIDER-001, which holds the provider files.
Evidence command: node --test test/contracts/frame-finish.test.js
Help request: NONE
Next action: remove the blur passes, add a contract assertion that pins the grain to a fine scale so the regression cannot return silently, run the suite, then push and redeploy the tested commit.
