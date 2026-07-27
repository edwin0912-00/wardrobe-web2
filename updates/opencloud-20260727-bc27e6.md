Agent ID: opencloud-20260727-bc27e6
Task ID: ONBOARDING
Commit tested: 4e665ba
Rationale/decision: joined beta; no product task starts before board assignment.
Result: ONLINE
Evidence command: tools/bootstrap-beta-agent.sh
Help request: NONE
Next action: monitoring UPDATE.md for an assigned task.

Protocol ACK: 036b20a

---

## BETA-HEALTH-SEMANTICS-001 · STARTED

Task ID: BETA-HEALTH-SEMANTICS-001
Pipeline step: GENERATION_TRANSPORT (Health розрізняє configured і available)
Status: IN_PROGRESS
Started at: 2026-07-27
Reserved paths: `src/web/app.js`; `test/web/**`; `updates/opencloud-20260727-bc27e6.md`

### Reproduction (non-billable, code-read + focused unit test)

The finding from `claude-code-20260727-a3f1c8` is real and reproducible by
reading `src/web/app.js` together with the runtime probe contract:

1. `src/web/app.js:37` computes `generationAvailable` exactly once, from the
   static `health` argument captured at `createWebApp` construction time:
   `const generationAvailable = health.status !== 'degraded';`
2. `currentHealth()` (lines 38–47) DOES query the runtime `healthProvider`
   and lowers the resolved `status` to `'degraded'` when the runtime probe
   is not `'ready'`. So `/api/health`'s top-level `status` field can already
   say `degraded`.
3. But the `generation` field at lines 210, 212, 237, 243 still reads the
   frozen `generationAvailable` boolean. So when a runtime probe returns
   `degraded` (e.g. Higgsfield HTTP 521, worker `failure`, `closed`/`starting`
   per `codex-app-server-client.js:366`), `/api/health` returns:
   `{ status: 'degraded', generation: 'available' }` — a contradiction.
   An HTTP 521 from the upstream provider is invisible in `generation`.
4. The same stale boolean gates paid generation at line 72: the first
   POST that arrives after runtime degradation but before process restart
   still passes the gate and reaches the provider. The gate only becomes
   correct after a restart that re-runs preflight, which is exactly the
   "boolean of construction time" symptom `a3f1c8` reported.

`healthProvider` is wired in `src/web/start.js:88` as
`generation.healthStatus`, whose implementations
(`codex-imagegen-provider.js:252`, `codex-app-server-client.js:366`) return
`status: 'degraded'|'ready'|'closed'|'starting'` from live worker state, so
the runtime signal exists — `app.js` just does not consume it for the
`generation` field or the 503 gate.

No provider request, credential, deployment, or unrelated UI change is
involved. The reproduction is a focused unit test that builds the app with
`health: { status: 'ready' }` and a `healthProvider` that returns
`{ status: 'degraded' }`, then asserts `/api/health` reports generation as
`unavailable` (it currently reports `available`).

### Next action

Implement the narrow separation: derive the `generation` field and the 503
gate from the resolved runtime health, not from the construction-time
boolean. Add `generation_configured` only if it does not widen the public
contract consumed by `tools/deploy-add-items-release.mjs:363` and
`src/monitor/start.js:40`. Focused test must fail on the pinned pre-change
code and pass after the fix.

