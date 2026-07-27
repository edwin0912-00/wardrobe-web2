Agent ID: codex-main
Task ID: BETA-POSTSHOOT-CHOICE-001
Protocol ACK: b9882f8
Commit tested: 39e369a
Rationale/decision: the saved look is the approved source. It must visibly
offer Photoshoot, Fashion video and Live camera as distinct next products;
Video stays explicitly unavailable until its real Seedance route, QA and
persistence exist rather than being disguised as a mock clip.
Result: READY_FOR_BETA_DEPLOY — focused source/UI proof is complete; host
activation and a narrow live smoke are the next atomic action.
Evidence command: node --test test/web/profile-ui-flow.test.js (9/9 PASS).
weakened_checks: none.
Help request: NONE.
Next action: activate exact commit 39e369a on beta and smoke the saved-look
choice surface.
