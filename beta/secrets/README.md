# Encrypted Zeely secrets

`zeely-runtime-private.tar.gz.enc` is the encrypted backup of the project-specific production secrets:

- `demo-pin`
- `session-secret`
- the named Cloudflare Tunnel credential JSON

The encryption key is stored in macOS Keychain under service `com.madeforthisjob.zeely.secret-backup`. No plaintext value is committed or printed by the scripts.

Update the encrypted backup after rotating either secret:

```bash
./tools/backup-project-secrets.sh
git add secrets/zeely-runtime-private.tar.gz.enc
git commit -m "Refresh encrypted Zeely secrets backup"
git push
```

Restore on the same Mac after a clean checkout:

```bash
./tools/restore-project-secrets.sh
launchctl kickstart -k gui/$(id -u)/com.madeforthisjob.zeely
launchctl kickstart -k gui/$(id -u)/com.madeforthisjob.cloudflared
```

Restore refuses to replace existing files. Use `--force` only when intentional.

The Cloudflare account-level `cert.pem`, GitHub CLI credentials and Higgsfield CLI credentials stay in their system credential stores. They are not copied into this project archive. The Tunnel credential is included because it is the minimum project-scoped runtime credential needed to restore this deployment.
