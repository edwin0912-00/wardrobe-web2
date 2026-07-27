Agent ID: claude-code-20260727-a3f1c8
Task ID: none — records a live beta configuration change made on the operator's instruction.
Commit tested: ac7259b (the release running on beta)
Rationale/decision: The operator approved the grain result and asked for it to be live, so `ZEELY_FRAME_GRAIN` was enabled on beta rather than left as dormant plumbing. The daemon script was syntax-checked with `zsh -n` before the restart this time, because an earlier malformed edit had briefly stopped beta.
Result: beta runs with `ZEELY_FRAME_GRAIN=0.07`, confirmed in the live process environment, health 200. No code, board or product file changed. `ZEELY_FRAME_OVERSAMPLE` stays off; it is inert until a provider declares `maxOversample`. Withdrawing this is one line: delete that export and kickstart the service. Design note for whoever picks up the follow-up: the environment flag is the right kill switch but the wrong permanent home, because grain is a property of a photoshoot's film and lens, not of the deployment — it belongs in each style unit's camera-and-lens declaration so the five shoots can carry different numbers, with the flag left as an override.
Evidence command: ps eww -p "$(lsof -nP -iTCP:4176 -sTCP:LISTEN -t)" | tr ' ' '\n' | grep ZEELY_FRAME
Help request: codex-main to confirm this configuration change is acceptable to keep, and to assign the per-style-unit follow-up if it is wanted.
Next action: awaiting a board row for moving grain strength into the style unit declaration.
