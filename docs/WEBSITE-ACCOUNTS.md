# Website and accounts

Scope: website/download center and optional campaign library. Forums, analytics, owner publishing and add-on marketplaces remain deferred. Existing routes, guest modes, shared-room protocols, offline storage and Android signing remain intact.

Public routes: `/welcome`, `/downloads`, `/updates`, `/help`; original app stays at `/`. `/account` provides email/password signup/sign-in, recovery, memberships, explicit cloud backups and reusable character profiles. No custom domain is configured yet; choosing/registering one is a separate owner decision. Keep the original origin for local-save migration.

## Authentication and deployment
The old Grok-broker scaffold remains disabled. Real Lootsplit identity uses the installed Better Auth 1.6 package against Cloudflare D1, through the request-scoped Worker `/api/account/*` handler. It never trusts the scaffold's development identity. Set `ACCOUNT_SECRET` as a durable Worker secret and `ACCOUNT_ORIGIN` to the website's exact origin; absence fails closed for accounts, without breaking guest play. Migration `0003_accounts.sql` adds tables without changing or deleting room data. Do not rotate the secret during ordinary deployment.

Web sessions use HttpOnly cookies. The packaged client's new account code uses signed bearer sessions to the existing API origin; it does not depend on third-party cookies. Android 1.3.1 is still the published APK and has no account UI. Web accounts ship first; a future signed APK must increment its release version and go through existing Android gates. No Windows/macOS binary is advertised; PC installation uses the browser's web-app feature when offered.

Email addresses are login identifiers, not verified identities. No email-based invitations or automatic account linking exist. Email reset is not enabled. Recovery keys are 256-bit random values, stored only as hashes; resetting rotates the key and atomically revokes all account sessions. A fresh sign-in is required to replace a recovery key. Rate limits and origin checks cover custom mutations as well as Better Auth's own protections.

## Campaign preservation
Linking requires a current room token, binds the actual seat, and rejects linking an already-owned seat to another account. Resume rechecks that same token against current room data every time. Revoked/deleted memberships do not regain access. Credentials are only returned to their authenticated owner. A resumed campaign uses a separate per-account/per-room device database, preserving previous device campaigns and roles; pending actions block switching. Account sign-out removes account-resumed room credentials from that device without deleting campaign data. Original guest connections remain guest capabilities.

Cloud backups are explicit immutable versions. No automatic upload, overwrite, expiry, or merging. PDFs, extracted articles, reference lexicon and PDF-origin catalog entries are omitted; structured campaign data stays in the backup. Protected saves still use the existing encrypted device backup flow. Each request is capped at 4 MB with an explicit error, never silent truncation. Restoring validates the existing Quire schema and creates a new device campaign. Shared campaign state is still authoritative in campaign_rooms; account backups are point-in-time copies, not live synchronization.

Profiles contain only name, portrait and notes. They carry no money, equipment or campaign permissions. Adding a profile creates a new empty local character and requires a local DM context.

## Verification
Run `npm test`, typecheck, Cloudflare/mobile builds and Wrangler dry-run. The added API tests exercise cross-account isolation, revoked seats, hostile origins, private PDF rejection, recovery-key rotation, session revocation and replay rejection. CI runs existing browser preservation checks and new mobile/desktop signup, profile, cross-device library, backup-restore and recovery checks against dev and the built Worker with disposable local databases. No real campaigns or rooms may be used for destructive testing.

Development account/room APIs share a local SQLite D1-compatible adapter; its state and secret are ignored by git. Production never uses this adapter. GitHub Actions uses actual local Wrangler D1 for the compiled Worker check.
