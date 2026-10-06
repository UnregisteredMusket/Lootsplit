# Custom-domain preparation and security

Related backlog: https://github.com/UnregisteredMusket/Lootsplit/issues/48

No domain has been selected or activated. Keep the current Cloudflare Worker, D1 database, Android signing identity and legacy API endpoint. Domain registration, DNS changes, account-security settings and cutover require the owner's decisions/authorization.

## Implemented preparation in the roadmap branch

- `src/lib/deployment/origins.mjs` defines public website, native API and legacy-address roles. Native API changes are independent of marketing URLs.
- Exact origin validation rejects credentials, paths, queries, fragments, wildcards and insecure public HTTP. Explicit loopback development origins remain supported.
- Account routing accepts only the configured `ACCOUNT_ORIGIN` and optional comma-separated `ACCOUNT_LEGACY_ORIGINS`. The actual request URL selects its approved auth base; forwarded host headers do not. Each browser origin signs in independently with host-only secure cookies. Cross-origin browser mutations are rejected. Existing native signed-bearer/CORS rules remain.
- Both session-wide and character-specific invitation controls share a URL builder and preserve session/character identifiers. Old session validation remains server-authoritative.
- Monitoring/recovery/failure-report/backup scripts read the shared website origin. `npm run migration:check` rejects mismatches between source, Wrangler and production audit destinations. This is a configuration check, not proof of live readiness.
- Settings includes a read-only readiness guide showing pending sync work and private document count. It reuses Device backups/account campaigns; it never submits a turn or transfers credentials/documents automatically.
- Existing backup import validates a file and stores a separate backup before Load is requested; Load explicitly confirms replacement of the selected campaign. For migration, select/create a separate destination campaign first. No second backup format is introduced.

## Security evidence and limits

Focused API tests exercise two explicitly configured HTTPS origins against one disposable database, separate sign-ins, secure host-only cookies, attacker/suffix/HTTP origins, unapproved request hosts, invalid callbacks and legacy native access. Existing account/governance suites cover ownership, expired invitations, recovery and campaign permissions. These checks do not establish a complete penetration test or confirm registrar/Cloudflare MFA, DNSSEC, WAF settings, physical APK behavior or live TLS issuance.

Keep authoritative server permissions, client validation, rate limiting, CSRF protections, recovery receipts, audit records and encrypted backups. They are intentional safeguards. Never solve migration by wildcard CORS, disabling origin checks, copying cookies into links or accepting arbitrary Host headers.

## Activation order, when authorized

1. Select/approve domain, renewal cost and registrar. Verify MFA, recovery access and registrar lock; review DNSSEC with the actual provider.
2. Record current live commit, immutable artifact, Worker/database identities and a verified encrypted backup. Preserve old migration files/source for old database backups.
3. Configure the new domain on the same Worker. Retain workers.dev and old API paths. Verify DNS/TLS; do not blanket-redirect authenticated APIs or the old recovery UI.
4. Update reviewed source origins, Wrangler ACCOUNT_ORIGIN, optional explicit ACCOUNT_LEGACY_ORIGINS, and both live-audit workflow targets together. Run migration:check. Verify preflight binding values against the intended addresses and existing database identity.
5. Run full preservation gates and a disposable two-host browser rehearsal: sign-in/recovery/sign-out, invitations, end/reopen, each campaign ID, pending turns, uploads, encrypted backup import/load, interrupted saves, native bearer access and rollback. The focused API test alone does not replace this rehearsal.
6. Publish through the existing main-only verified-artifact workflow. Run read-only identity/asset-hash and desktop/mobile audits on BOTH approved addresses, not just the primary. Test a supported old APK.
7. Give users the readiness guide. New-origin sign-in is expected; origin-scoped local storage does not follow automatically. Retain old-origin recovery access until users can export local-only data.

Rollback triggers: wrong identity/assets, broken sign-in/invitations, server errors, failed backup validation or inaccessible legacy clients. Restore the previous verified application/configuration through the gated release workflow; keep the shared database and old host available. Do not restore an older database over newer transactions just to undo a domain binding. Reverify both endpoints after rollback.

Owner-only pending items: domain/cost selection, registrar/Cloudflare security review, DNS/TLS binding, approved coexistence duration, actual cutover and eventual legacy retirement. Full two-host browser/physical-device rehearsal remains a pre-activation gate.

Official references checked October 6, 2026: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ ; https://developers.cloudflare.com/workers/configuration/routing/workers-dev/ ; https://better-auth.com/docs/concepts/cookies ; https://better-auth.com/docs/1.6/reference/security .
