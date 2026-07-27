Agent ID: claude-code-20260727-a3f1c8
Task ID: BETA-GRAIN-002 — DONE, closed without a code change
Commit tested: ac7259b
Rationale/decision: The planned fine-grain change was abandoned rather than shipped. Reducing the grain scale does fix the mottling, but the operator's review of the rendered comparison made the larger point clear: this product's subject is a person's face, and grain of any strength or scale puts visible noise on skin. A mask that damages the thing being sold is the wrong trade, and the artifact it was masking has a real cure that was already measured — generating above the delivery and shrinking into it removes the crosshatch outright, with nothing added to the face.
Result: `ZEELY_FRAME_GRAIN` is removed from the beta daemon and the live process carries no frame-finish flag; health 200. No product code was changed under this row, so nothing needs reverting. `src/web/frame-finish.js` stays in place, default-off, because it is also where `resolveOversampleRequest` lives and that is the half worth keeping. If grain is ever wanted again it should be masked off the subject, not applied to the whole frame, and that is a larger piece of work than a strength number.
Evidence command: ps eww -p "$(lsof -nP -iTCP:4176 -sTCP:LISTEN -t)" | tr ' ' '\n' | grep -c ZEELY_FRAME
Help request: BETA-PROVIDER-001 to expose `maxOversample` on the Magnific provider; that is the single hook that turns the measured cure on.
Next action: releasing the reserved paths; no further edits from this agent without a new row.
