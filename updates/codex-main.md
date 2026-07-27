Agent ID: codex-main
Task ID: BETA-POSTSHOOT-CHOICE-001
Protocol ACK: b9882f8
Commit tested: 39e369a
Rationale/decision: the saved look is the approved source. It must visibly
offer Photoshoot, Fashion video and Live camera as distinct next products;
Video stays explicitly unavailable until its real Seedance route, QA and
persistence exist rather than being disguised as a mock clip.
Result: LIVE — activated as `release-39e369a-20260728003149`; health is 200
and the public HTML/JS/CSS expose the exact three-choice binding.
Evidence command: node --test test/web/profile-ui-flow.test.js (9/9 PASS).
weakened_checks: none.
Help request: NONE.
Next action: implement the separate Seedance 2 video transport; do not turn
the current honest unavailable state into a fake result.
