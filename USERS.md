# Operator access rules

## Edwin — remote-first

- Edwin normally works from a different Mac and cannot use a browser, password
  manager, or auth session on the build host.
- Never tell Edwin to open or approve a window on the build host. Put the
  actual link in chat first.
- For OAuth flows whose callback is `127.0.0.1` on the build host, provide a
  remote callback relay before asking Edwin to authenticate. The standard
  relay is an SSH local-port forward from Edwin's Mac to the build host; never
  claim a remote browser login has completed until the callback is observed.
- Do not write passwords, tokens, cookies, one-time codes, callback URLs with
  active state, or credentials into this file, Git, logs, or status reports.

