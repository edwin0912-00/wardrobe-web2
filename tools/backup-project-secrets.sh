#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_root="${script_dir:h}"
deploy_root="${ZEELY_DEPLOY_ROOT:-/Users/$(id -un)/.local/share/madeforthisjob/app}"
private_dir="${ZEELY_PRIVATE_DIR:-${deploy_root}/runtime/private}"
output_file="${project_root}/secrets/zeely-runtime-private.tar.gz.enc"
keychain_service="com.madeforthisjob.zeely.secret-backup"
keychain_account="$(id -un)"

for required in demo-pin session-secret; do
  if [[ ! -s "${private_dir}/${required}" ]]; then
    print -u2 "Missing required secret: ${private_dir}/${required}"
    exit 1
  fi
done

mkdir -p "${project_root}/secrets"
chmod 700 "${project_root}/secrets"

if ! zeely_backup_key="$(security find-generic-password -a "${keychain_account}" -s "${keychain_service}" -w 2>/dev/null)"; then
  zeely_backup_key="$(openssl rand -hex 32)"
  security add-generic-password \
    -a "${keychain_account}" \
    -s "${keychain_service}" \
    -w "${zeely_backup_key}" \
    -U >/dev/null
fi

export ZEELY_SECRET_BACKUP_KEY="${zeely_backup_key}"
tar -czf - -C "${private_dir}" demo-pin session-secret \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -md sha256 \
      -pass env:ZEELY_SECRET_BACKUP_KEY \
      -out "${output_file}"
unset ZEELY_SECRET_BACKUP_KEY zeely_backup_key
chmod 600 "${output_file}"

print "Encrypted project-secret backup updated: secrets/${output_file:t}"
