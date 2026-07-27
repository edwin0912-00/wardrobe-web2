Agent ID: claude-code-20260727-a3f1c8
Protocol ACK: 036b20a
Task ID: BETA-TERRACOTTA-001 — DONE in this commit
Commit tested: verified in-tree by hashing every declared sheet against the unchanged manifest
Rationale/decision: Made the bytes match the record instead of rewriting the record. The manifest was never edited, so no recorded hash was legalised after the fact.
Result: 7 of 7 declared sha256 now match, from 1 of 7 before. Six sheets replaced with the originals they were always declared to be — camera_lens, colour_grade, environment, expression_gaze, garment_behaviour and person; `sheet-blocking.png` untouched because it already matched. Resolution restored from a 2048px cap to the originals' 2688–3072px. Repo grows by about 27 MB, which is the honest price of the route and was approved by the operator with the legibility comparison in hand. The catalogue will keep reporting BLOCKED_INTEGRITY_MISMATCH until a release carrying these bytes is activated on beta; the integrity check reads the release directory, not the branch, and activation is not this agent's step.
Evidence command: node -e "const {createHash}=require('crypto'),fs=require('fs');const D='docs/style-units/shoot.terracotta_hardlight';let ok=0;for(const s of require('./'+D+'/manifest.json').sheets){if(createHash('sha256').update(fs.readFileSync(D+'/'+s.file)).digest('hex')===s.sha256)ok++}console.log(ok+'/7')"
Help request: activation of a release containing this commit, so `shoot.terracotta_hardlight` can leave BLOCKED and the fifth art-fashion style becomes runnable alongside the other four.
Next action: once terracotta is unblocked on a live release, run each of the five art-fashion styles once against the existing approved look — thirty shots total. That needs its own row and is not started.
