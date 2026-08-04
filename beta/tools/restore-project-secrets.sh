#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_root="${script_dir:h}"
deploy_root="${ZEELY_DEPLOY_ROOT:-/Users/$(id -un)/.local/share/madeforthisjob/app}"
target_dir="${ZEELY_PRIVATE_DIR:-${deploy_root}/runtime/private}"
cloudflared_dir="${ZEELY_CLOUDFLARED_DIR:-/Users/$(id -un)/.cloudflared}"
tunnel_id="6611610c-7f16-46fc-9ddf-00d4406080aa"
tunnel_credential="${cloudflared_dir}/${tunnel_id}.json"
input_file="${project_root}/secrets/zeely-runtime-private.tar.gz.enc"
keychain_service="com.madeforthisjob.zeely.secret-backup"
keychain_account="$(id -un)"
force="${1:-}"

if [[ ! -s "${input_file}" ]]; then
  print -u2 "Encrypted backup is missing: ${input_file}"
  exit 1
fi

if [[ "${force}" != "--force" ]] && { [[ -e "${target_dir}/demo-pin" ]] || [[ -e "${target_dir}/session-secret" ]] || [[ -e "${tunnel_credential}" ]]; }; then
  print -u2 "Target already contains secrets. Use --force only when replacement is intentional."
  exit 1
fi

zeely_backup_key="$(security find-generic-password -a "${keychain_account}" -s "${keychain_service}" -w)"
export ZEELY_SECRET_BACKUP_KEY="${zeely_backup_key}"
restore_tmp="$(mktemp -d)"
trap 'find "${restore_tmp}" -depth -delete 2>/dev/null || true; unset ZEELY_SECRET_BACKUP_KEY zeely_backup_key' EXIT

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
  -pass env:ZEELY_SECRET_BACKUP_KEY \
  -in "${input_file}" \
  | tar -xzf - -C "${restore_tmp}"

[[ -s "${restore_tmp}/runtime/private/demo-pin" && -s "${restore_tmp}/runtime/private/session-secret" && -s "${restore_tmp}/cloudflared/${tunnel_id}.json" ]] || {
  print -u2 "Backup decrypted but required files are invalid."
  exit 1
}

mkdir -p "${target_dir}"
chmod 700 "${target_dir}"
mkdir -p "${cloudflared_dir}"
chmod 700 "${cloudflared_dir}"
install -m 600 "${restore_tmp}/runtime/private/demo-pin" "${target_dir}/demo-pin"
install -m 600 "${restore_tmp}/runtime/private/session-secret" "${target_dir}/session-secret"
install -m 600 "${restore_tmp}/cloudflared/${tunnel_id}.json" "${tunnel_credential}"

print "Project and Tunnel runtime secrets restored. Restart both madeforthisjob LaunchAgents to apply them."
