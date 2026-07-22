#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_root="${script_dir:h}"
deploy_root="${ZEELY_DEPLOY_ROOT:-/Users/$(id -un)/.local/share/madeforthisjob/app}"
target_dir="${ZEELY_PRIVATE_DIR:-${deploy_root}/runtime/private}"
input_file="${project_root}/secrets/zeely-runtime-private.tar.gz.enc"
keychain_service="com.madeforthisjob.zeely.secret-backup"
keychain_account="$(id -un)"
force="${1:-}"

if [[ ! -s "${input_file}" ]]; then
  print -u2 "Encrypted backup is missing: ${input_file}"
  exit 1
fi

if [[ "${force}" != "--force" ]] && { [[ -e "${target_dir}/demo-pin" ]] || [[ -e "${target_dir}/session-secret" ]]; }; then
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

[[ -s "${restore_tmp}/demo-pin" && -s "${restore_tmp}/session-secret" ]] || {
  print -u2 "Backup decrypted but required files are invalid."
  exit 1
}

mkdir -p "${target_dir}"
chmod 700 "${target_dir}"
install -m 600 "${restore_tmp}/demo-pin" "${target_dir}/demo-pin"
install -m 600 "${restore_tmp}/session-secret" "${target_dir}/session-secret"

print "Project secrets restored to ${target_dir}. Restart com.madeforthisjob.zeely to apply them."
