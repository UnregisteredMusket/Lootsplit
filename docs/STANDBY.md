# Free standby and offsite recovery

Cloudflare Workers/D1 remains the primary. Render Free runs the **same verified Worker and client files**, with a Node HTTP transport and D1-compatible Turso/libSQL adapter. GitHub publishes a portable release only after the full verification workflow passes on main. Render downloads that specific release; it does not rebuild the app. Automatic Render deploys are off.

The standby starts **locked**. `/healthz` returns its mode and release commit; application requests return 503. It needs no database credentials while locked. A green health check proves the process is available, not that recovery is complete.

## Costs and limits

- Select Render **Free**, a free workspace, and Turso **Free** with a **libSQL** database. Do not add a paid Render database, disk, worker, cron, autoscaling or paid overages. Confirm account spending settings before enabling backups.
- Render Free sleeps after 15 idle minutes and takes about a minute to wake. Its local files are disposable. Store account/campaign data in Turso, never local SQLite on Render. Do not add keep-awake pings.
- Free plans have usage limits and no availability guarantee. Services can be suspended at limits. GitHub artifact storage also consumes its allowance; monitor usage and failed backup runs. This is best-effort recovery, not an uptime SLA.
- Render uses Cloudflare for inbound traffic. Hosting and database are separate, but this is **not complete independence from Cloudflare's network**.
- Daily snapshots recover to the last successful backup, potentially losing newer server changes. Failed jobs produce no new recovery point. Preserve device exports too.

References: [Render Free](https://render.com/docs/free), [Render edge network](https://render.com/articles/how-render-handles-ddos-attacks), [Turso pricing](https://turso.tech/pricing), [libSQL client](https://docs.turso.tech/sdk/ts/reference).

## Initial setup

1. Wait for `Verify preserved functionality` and `Publish verified standby` on main. The GitHub prerelease `standby-<full commit SHA>` contains public application files only. It does not replace the Android release or download link.
2. Create the Render Blueprint from `render.yaml`. Supply that full SHA as `STANDBY_RELEASE_SHA`. Confirm **Free** before creation. Build: `node scripts/install-standby.mjs`. Start: `node dist/standby-release/runtime/server.mjs`. Health: `/healthz`. Keep `STANDBY_MODE=locked`.
3. Record the assigned HTTPS Render address. Verify `/healthz` reports the selected SHA and `locked`, and `/` returns 503. The generated `ACCOUNT_SECRET` is a separate standby signing key. Do not copy the production signing key into chat or source.
4. Create a Turso Free account and libSQL group. Rehearse a **synthetic** import into a new disposable database using a database-scoped token. Verify the remote adapter before declaring recovery ready. Never activate both hosts or test on real campaigns. A fresh database is created from the latest restore during recovery.
5. Enable encrypted backups below. Keep the decryption key securely outside GitHub/Cloudflare too. Without it, backups cannot be recovered.

## Encrypted daily backups

Generate 32 random bytes as 64 hexadecimal characters in a password manager or trusted local tool. Save it as GitHub **production environment secret** `BACKUP_ENCRYPTION_KEY`, retaining a separate secure copy. Never paste it into an issue, source file, command argument, screenshot or chat.

Existing production secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are used for export. Verify that token can export D1. If denied, stop and adjust only the minimum D1 permission needed; do not grant unrelated services. No backup step issues a production SQL mutation.

After checking credentials and quotas, set repository variable `STANDBY_BACKUPS_ENABLED=true`. Run **Encrypted offsite database backup** manually and verify success. It then runs at 09:17 UTC daily (05:17 New York in daylight saving, 04:17 in winter); GitHub may delay schedules. It serializes with website deployment, obtains a consistent D1 export, checks integrity/foreign keys/migrations, and encrypts in memory using AES-256-GCM before writing anything. Plaintext SQL and temporary signed download URLs are never logged/uploaded. D1 briefly pauses queries during export.

Only `recovery/encrypted/*.enc` is uploaded as Actions artifacts, retained for **30 days**. Never upload the entire recovery directory. Privately retain older encrypted copies if needed. Keep earlier keys after rotating the key. Backups contain accounts, password hashes, sessions, room credentials, private libraries and campaigns; protect the key and decrypted files accordingly.

Rehearse decryption before relying on this setup. In a trusted checkout with matching migration files, securely set `BACKUP_ENCRYPTION_KEY` in the environment, place a downloaded encrypted artifact under ignored `recovery/`, and run:

```sh
npm ci
node scripts/standby-backup.mjs restore recovery/snapshot.enc recovery/restored.db
```

The new mode-0600 SQLite file contains every original table plus recovery metadata. Restore refuses existing files and invalid checksums, schemas, integrity or foreign keys. It never connects to a live database. Keep plaintext off shared folders and remove it after use. The reader caps decompressed snapshots at 512 MiB; review this before larger backups are needed.

## Deliberate switchover

Only one host may accept writes. Do not activate Render or switch DNS merely because the primary appears unreachable.

1. Announce maintenance through your usual channel. Set a new random Worker secret `RECOVERY_FENCE` on `lootsplit`. All application reads/writes then return 503. Check `https://lootsplit.oliverstorie2017.workers.dev/.well-known/lootsplit-recovery` returns `mode: fenced` and record its public SHA-256 `fenceId`. Wait at least 60 seconds for in-flight requests to drain. Keep the fence set throughout recovery and subsequent releases.
2. Set `STANDBY_BACKUPS_ENABLED=false` while serving from standby. If D1 is accessible, take one final encrypted snapshot using the local `export` command after draining. Otherwise select the latest **successful** saved snapshot and explicitly accept its timestamp and missing newer changes. If Cloudflare is unreachable and fencing cannot be verified, keep standby locked. Safe automatic failover during a total control-plane outage is not provided.
3. Restore to a new local file. Check its reported timestamp/source release. Set `PRIMARY_FENCE_ID` to the verified public ID and run:

   ```sh
   node scripts/standby-backup.mjs authorize recovery/restored.db
   turso db create lootsplit-recovery-UNIQUE_NAME --from-file recovery/restored.db
   ```

   Authorization verifies the real primary endpoint and stamps only the local restore. Use a **new database name every time**, an authenticated official Turso CLI, and a libSQL group. Never overwrite an active database. Obtain that database's URL and scoped read/write token from Turso. See [file import](https://docs.turso.tech/cli/db/create).
4. Set Render runtime environment values:

   | Variable | Value |
   | --- | --- |
   | `STANDBY_RELEASE_SHA` | Verified compatible release SHA |
   | `ACCOUNT_ORIGIN` | Exact HTTPS Render origin without a path |
   | `ACCOUNT_SECRET` | Existing separate generated standby key |
   | `TURSO_DATABASE_URL` | Newly restored libSQL database URL |
   | `TURSO_AUTH_TOKEN` | Database-scoped read/write token |
   | `STANDBY_SNAPSHOT_ID` | ID printed by restore/authorize |
   | `PRIMARY_FENCE_ID` | Verified public fence ID |
   | `STANDBY_MODE` | `active` |

5. Deploy manually. Startup refuses mismatched snapshot/fence IDs or migration identity. Check health, title screen and an authorized account/library operation; confirm primary still returns 503. Share the recovery website address and record snapshot time, database and release. Never include credentials in builds, archives or source.

Changing origin requires a new browser login. Browser-local campaigns and PDFs remain on their original device/origin: explicitly export/import campaigns. Server snapshots do not contain private device PDFs. Existing Android builds retain the primary API address and local/manual functionality; use the standby **website** for online recovery. Changing Android's endpoint requires a separately verified signed update. Browser push permissions are origin-specific and may require re-enabling.

The Node transport strips caller-supplied IP/forwarding headers and uses the nearest appended Render proxy hop for rate limits. Some proxies may conservatively share a rate limit; verify real routing before changing trust. Normal account authorization, room credentials, revisions and transactional award guards are retained.

## Returning to the primary

Do **not** simply remove `RECOVERY_FENCE`: D1 is now older. First lock standby, drain requests, privately export Turso, and verify a reconciliation/restore plan preserving all recovery-period changes. Back up both sides and rehearse in isolation. Replacing production data requires a separately reviewed recovery operation; nothing here automatically overwrites D1. Remove the fence only after the reconciled primary is verified and standby is locked, then resume primary backups.

## Verification

- `npm test` covers libSQL transaction rollback/award guards, account isolation/CSRF, encryption tampering, non-overwriting restore, fencing and activation.
- `node scripts/standby-artifact-audit.mjs` checks the packaged locked process, then existing desktop/mobile account/library/recovery browser checks against the identical Worker under Node and disposable libSQL.
- All prior app, mobile, Worker and browser gates remain. Both audited artifacts are hash-verified before upload.
- Local tests do not replace a real Turso import/remote-transport rehearsal. Until that passes, this is **prepared**, not a verified recovery service.
