# Controlled Codex QA cutover

Goal: restore semantic QA with the existing Codex account after OpenRouter credit exhaustion. Owner approved this provider change on 2026-10-07.

Architecture: reuse ZEELY_VLM_PROVIDER=codex and the existing gpt-5.6-terra evaluator. Keep image Slow/Fast routing and all QA gates. Expose the existing scene recovery boolean through ZEELY_SCENE_AUTO_RECOVER_QA_FAILURES; accept only true/false, default true for compatibility, deploy false to prevent historical-job fan-out. No dependencies or new routing layer.

- [x] Add a regression: with the environment set to false, runtime dependencies disable recovery; true/default retain recovery; invalid values reject startup. Run existing SceneService regressions from the beta working directory.
- [x] Implement the validated environment setting in beta/src/web/scene-runtime.js and document the owner decision in provider docs, AGENTS, DECISIONS and CHANGELOG.
- [ ] Run focused Node tests, canonical ./verify and release integrity gates. Commit the candidate, bind the release lock to its source/beta tree, then commit/push alpha.
- [ ] Verify no active paid work. Build an immutable engine release; preserve runner/config for rollback, set QA provider codex and recovery false, deploy matching site/engine artifacts and verify both public surfaces.
- [ ] Verify exact live process QA provider/profile plus a bounded request using existing inputs. Record transport, semantic result and costs separately. Do not re-run all old failures or weaken failed gates.

Paid checks remain under the existing $20 total cap and no-top-up instruction. Prior $11.558616 validation spend leaves at most $8.441384 for authorized paid validation. Unknown submitted image outcomes must never be resubmitted.
