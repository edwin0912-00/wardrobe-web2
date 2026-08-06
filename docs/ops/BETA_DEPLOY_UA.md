# Beta deploy

`beta.madeforthisjob.com` uses `com.madeforthisjob.beta` and
`run-beta-daemon.sh`. It is not controlled by the generic `app` deployment
topology. Never edit a release directory directly.

Build and verify a candidate first, then use:

```bash
node tools/deploy-beta-release.mjs --apply \
  --release /absolute/candidate \
  --runner /Users/jarvis1/.local/share/madeforthisjob-beta-launcher/run-beta-daemon.sh \
  --beta-plist /Users/jarvis1/Library/LaunchAgents/com.madeforthisjob.beta.plist
```

The runner path above is the path registered by the current LaunchAgent. Do
not substitute the historical `madeforthisjob/run-beta-daemon.sh` path: the
deploy command will correctly reject a runner not launched by that plist.

The tool verifies the release, stages it, changes only the runner's `app_root`,
restarts the beta LaunchAgent, checks local and public health, and restores the
previous runner pointer if health fails. `deploy-add-items-release.mjs` is not
a beta deployment tool.
