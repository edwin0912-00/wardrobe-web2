# Professional reference set and decision

Primary sources reviewed on 2026-08-10:

- GitHub Actions workflows and workflow artifacts:
  https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows
  https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts
- GitHub Actions job summaries:
  https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands
- Playwright CI and trace guidance:
  https://playwright.dev/docs/ci
  https://playwright.dev/docs/best-practices
- Dev Container specification:
  https://containers.dev/overview
- Docker Compose readiness:
  https://docs.docker.com/compose/how-tos/startup-order/
- Dagger local/CI automation:
  https://github.com/dagger/dagger
- Task runner:
  https://github.com/go-task/task

Decision for this repository:

1. Keep Node, Python and Playwright; they are already product dependencies.
2. Add GitHub Actions, persisted receipts/logs and a concise job summary.
3. Use one root `./verify` executable locally, from README and from CI.
4. Keep deployment parity read-only and separate from clean-clone acceptance.
5. Do not add Dagger, Task, Docker Compose or a Dev Container to the required
   path. Each adds an evaluator prerequisite without proving more behavior than
   the existing real-browser and two-process harness. A Dev Container can be an
   optional future convenience, not the only way to grade the repository.
6. Do not use source-string tests as proof of product behavior. Static wiring
   checks are allowed only for wiring that cannot execute by itself, and must
   be paired with the executable gate they point to.
