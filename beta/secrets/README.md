# Runtime secrets are intentionally absent

This directory is documentation only. Evaluator-facing and installable Git
branches must not contain runtime credentials or credential backups, including
encrypted archives.

Provider authorization, session secrets and Cloudflare credentials remain in
the operating system credential stores of the deployment host. A clean clone
starts the complete UI/API stack without them and reports provider generation
as unavailable until the host is explicitly authorized.
