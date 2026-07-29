#!/bin/zsh
# Zeely local restart guard. It is intentionally read-only for providers and
# tunnels: no generation, no credential output, and no duplicate tunnel start.

set -u
export PATH='/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'

guard_root='/Users/jarvis1/.local/share/madeforthisjob'
runtime_root="$guard_root/.zeely-beta-runtime"
log_file="$runtime_root/restart-guard.log"
beta_runner="$guard_root/run-beta-daemon.sh"
beta_label='com.madeforthisjob.beta'
tunnel_label='com.madeforthisjob.cloudflared'
lock_dir='/tmp/zeely-restart-guard.lock'

mkdir -p "$runtime_root"
if ! mkdir "$lock_dir" 2>/dev/null; then exit 0; fi
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT

stamp() { /bin/date '+%Y-%m-%dT%H:%M:%S%z'; }
write() { print -r -- "$(stamp) $*" >> "$log_file"; }
ok=0
warn=0

check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    write "OK $label"
    (( ok += 1 ))
  else
    write "WARN $label"
    (( warn += 1 ))
    return 1
  fi
}

check 'beta.launch-agent.loaded' /bin/launchctl print "gui/$UID/$beta_label" || true
check 'tunnel.launch-agent.loaded' /bin/launchctl print "gui/$UID/$tunnel_label" || true
check 'beta.runner.present' /bin/test -r "$beta_runner" || true

beta_root=''
if [[ -r "$beta_runner" ]]; then
  beta_root=$( /usr/bin/sed -n 's/^app_root="\(.*\)"$/\1/p' "$beta_runner" | /usr/bin/head -1 )
fi
if [[ -n "$beta_root" && -d "$beta_root" ]]; then
  write "OK beta.release-root.present"
  (( ok += 1 ))
else
  write "WARN beta.release-root.missing"
  (( warn += 1 ))
fi

local_health() {
  /usr/bin/curl --silent --show-error --fail --max-time 8 http://127.0.0.1:4176/api/health \
    | /usr/bin/grep -q '"status":"ready"'
}
public_health() {
  /usr/bin/curl --silent --show-error --fail --max-time 12 https://beta.madeforthisjob.com/api/health \
    | /usr/bin/grep -q '"status":"ready"'
}

if ! check 'beta.local-health' local_health; then
  write 'RECOVERY beta.kickstart'
  /bin/launchctl kickstart -k "gui/$UID/$beta_label" >/dev/null 2>&1 || true
  /bin/sleep 3
  check 'beta.local-health.after-restart' local_health || true
fi
check 'beta.public-health' public_health || true

if [[ -x /opt/homebrew/bin/higgsfield ]]; then
  # `account status` uses the existing authenticated CLI state only. The output
  # can identify an account, so it is discarded rather than written to the log.
  if /usr/bin/perl -e 'alarm 15; exec @ARGV' /opt/homebrew/bin/higgsfield account status --json >/dev/null 2>&1; then
    write 'OK higgsfield.authenticated-cli'
    (( ok += 1 ))
  else
    write 'WARN higgsfield.authenticated-cli'
    (( warn += 1 ))
  fi
else
  write 'WARN higgsfield.cli.missing'
  (( warn += 1 ))
fi

free_kb=$( /bin/df -k / | /usr/bin/awk 'NR == 2 { print $4 }' )
if [[ "$free_kb" =~ '^[0-9]+$' && "$free_kb" -ge 524288 ]]; then
  write "OK disk.free-kb=$free_kb"
  (( ok += 1 ))
else
  write "WARN disk.low-free-kb=${free_kb:-unknown}"
  (( warn += 1 ))
fi

write "SUMMARY ok=$ok warn=$warn"
exit 0
