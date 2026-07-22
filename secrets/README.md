# Encrypted Zeely secrets

`zeely-runtime-private.tar.gz.enc` is the encrypted backup of the two project-specific production secrets:

- `demo-pin`
- `session-secret`

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
```

Restore refuses to replace existing files. Use `--force` only when intentional.

GitHub CLI and Higgsfield CLI credentials are maintained by their own system credential stores. They are not copied into this archive because they are revocable account tokens rather than project configuration.
