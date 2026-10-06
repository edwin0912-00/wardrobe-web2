# Wardrobe alpha operator setup

The repository contains the complete cinematic site and Studio/engine. On a
fresh host, `./setup` collects private local settings, and `./setup run`
delegates the install, locked media retrieval, browser checks, and two-process
startup to the existing `./verify --run` contract.

## Local setup

Requirements remain Git, Python 3.10+, and Node.js 22+ with npm. Run the
questionnaire from the repository checkout:

```sh
./setup
```

It records a host label, optional HTTPS origin, private runtime directory,
dedicated `CODEX_HOME`, optional private video-reference directory, ports, and
FAL/OpenRouter keys. Secret entry uses masked terminal input. Pressing Enter
keeps a saved key; the questionnaire never displays its value. The JSON config
is stored outside the checkout with mode `0600` under a mode `0700` directory.
It writes through a temporary file and atomic rename. Editing the questionnaire
does not replace an existing config until the operator confirms.

The private runtime directory stores logs, engine state, jobs, and outputs.
The config stays at the platform's stable WardrobeAlpha state path so that
`./setup run` can find it if the runtime directory changes. Defaults are
`~/Library/Application Support/WardrobeAlpha` on macOS and
`$XDG_STATE_HOME/wardrobe-alpha` (or `~/.local/state/wardrobe-alpha`) elsewhere.
To choose another private config file, pass an absolute path in a dedicated
directory outside the checkout with `--config /absolute/private-dir/operator-config.json`
to each `./setup` command.
The dedicated Codex profile defaults to `~/.codex-wardrobe-alpha`; setup does
not copy an existing Codex login into it or perform OAuth.

Then inspect the local configuration and start the full product:

```sh
./setup --check
./setup run
```

`--check` makes no provider or network calls. It validates config and private
file permissions, reports whether the configured Codex `auth.json` exists,
and reports key presence without showing key values. Presence does not prove
that a key, Codex account, model permission, DNS record, TLS certificate, or
video-reference manifest works. Missing credentials do not block startup; the
product can serve its local UI in its truthful degraded state. Features that
need a missing provider remain unavailable.

`./setup run` opens the questionnaire if no config exists, then loads the saved
config and passes it to `./verify --run` through the child process environment.
Declining to save aborts the run; an existing config runs without reopening the
questionnaire. Secrets never appear in command arguments or shell source. The
runner clears inherited values managed by this questionnaire, explicitly uses
the approved `codex-primary` image route, and leaves the logical look route at
the product's `quality` default. An OpenRouter key selects the existing
`ZEELY_VLM_PROVIDER=openrouter` QA route. Empty port fields retain the
launcher's free-port selection, starting from its existing defaults.

Before Codex-backed generation, authenticate the dedicated profile from the
same host and shell with:

```sh
CODEX_HOME="$HOME/.codex-wardrobe-alpha" codex login
```

If the questionnaire selected a different path, substitute that path. The
login creates local authorization; `./setup --check` only checks for the
resulting `auth.json` and does not validate the account or model capability.
Keep provider keys and the Codex profile on the operator’s private machine.

## Fresh SSH server

Setup runs on the machine where it is invoked. A host label is descriptive; an
HTTPS origin is configuration for the engine’s existing legacy asset bridge.
Neither value provisions a server, connects over SSH, changes DNS, creates a
TLS certificate, opens a firewall, or installs a service manager.

On a newly provisioned SSH host, clone the public `alpha` source and run the
same commands on that host:

```sh
git clone --filter=blob:none --single-branch --branch alpha https://github.com/edwin0912-00/wardrobe-web2.git
cd wardrobe-web2
./setup
./setup --check
./setup run
```

Complete DNS, TLS, firewall, persistent-service, and external authentication
work through the operator’s existing infrastructure process. The setup command
does not claim that those steps completed. Keep the terminal open to supervise
the local processes; stop them with `Ctrl+C`.

When serving the product through HTTPS ingress, enable secure session cookies:

```sh
ZEELY_COOKIE_SECURE=true ./setup run
```

The local launcher defaults to `false` for loopback HTTP. It honors an explicit
setting and checks the profile cookie returned through the main-site gateway.
This check creates one anonymous profile, makes no provider call, and does not
print the cookie value. Enabling the flag does not configure HTTPS itself.
