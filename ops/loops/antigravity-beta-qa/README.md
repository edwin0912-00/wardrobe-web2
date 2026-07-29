# Antigravity beta QA loop

This is the bounded execution contract for the permanent Gemini/Antigravity
observer. It is rerun for each new deployed beta SHA; it is not one infinite
model call.

The 20-second Git watcher detects changes. A new relevant beta SHA starts one
bounded QA cycle. A cycle stops on a clean evidence gate, the first confirmed
blocking defect, two stalled iterations or 45 minutes.

Antigravity/Gemini operates the browser. A separate Codex judge receives only
the redacted plan, report and evidence manifest and tries to disprove the
verdict. Raw user media, runtime directories and credentials are excluded.

Start or resume an interactive Antigravity session with:

```bash
bash tools/join-antigravity-qa.sh antigravity-qa --watch
```

Then follow `ops/loops/antigravity-beta-qa/RUN_IN_SESSION.md`.

Do not commit raw screenshots, private media, cookies, headers or tokens.
Commit the report and a content-hash evidence manifest only.
