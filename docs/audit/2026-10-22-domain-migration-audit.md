# Custom-domain migration audit — October 22, 2026

This is a read-only audit of `main` at `ca29406` (Android 1.9.3), for moving Lootsplit to its own domain. The plan in `docs/plans/DOMAIN-READINESS.md` keeps the same Worker and D1, and keeps `lootsplit.oliverstorie2017.workers.dev` as a legacy origin.

- **What was touched:** nothing in the repository, Cloudflare or the live site was changed.
- **Live checks:** anonymous read-only GET/HEAD requests to the public site.
- **Production D1:** read with SELECT queries only.
- **Research:** every price and policy was checked on 2026-10-22, with sources linked.

Confidence labels:
- **high:** the code path was read end to end, or the behavior was observed live.
- **med:** the code was read, but the behavior depends on a library or runtime that wasn't executed.
- **low:** inference only.

## Owner decisions (2026-10-22)

- **Name:** the app is renamed **Lootsplitter**. lootsplit.com was registered on 2026-08-28 and is parked for aftermarket sale, so owning the matching name avoids confusion and look-alike sites. No US trademark was found for "Lootsplitter". A federal filing ($350 per class) stays optional.
- **Domain:** **lootsplitter.com**, registered by the owner on Cloudflare Registrar ($10.46 a year at cost, with renewal at the same price). lootsplitter.app was also free on 2026-10-22 ($8.20 the first year, then $14.20) and is an optional redirect.
- **Price:** Lootsplitter stays free, and the Donate page stays. See `docs/plans/MONETIZATION-AND-MARKETING.md`.
- **Still pending owner decisions:**
  - registering the domain;
  - the coexistence period for the old host;
  - the cutover date;
  - each sign-off point in the checklist below.

## Summary

The migration is feasible on the existing design: host-only cookies, exact-origin CSRF, native CORS to `localhost` origins only, no email or OAuth callbacks, VAPID keys in D1, and a CSP with no host names.

Seven P1 items must land before cutover. Three of them would otherwise break every installed Android app, both widgets and old invitation links on the day of the move:
1. **`workers_dev = true` is missing.** Adding a custom domain to `wrangler.toml` would turn workers.dev off on the next deploy.
2. **`ACCOUNT_LEGACY_ORIGINS` is missing** from the config and from the checks. Without it, every account API call to workers.dev returns 403.
3. **Release preflight would reject the cutover release itself.**

Two P1 bugs affect users today, independent of the domain. The Android "Copy fresh invitation" link and the activity-report link are built from `https://localhost`.

---

## Prioritized findings (P1 before cutover, P2 at cutover, P3 later)

| ID | Pri | Area | file:line | Finding | Impact | Fix | Size | Conf |
|---|---|---|---|---|---|---|---|---|
| P1-1 | P1 | Hosting | wrangler.toml:1-71 (no `workers_dev`) | Adding `routes`/custom domain in config infers `workers_dev=false` on next deploy | All old APKs, widgets, telemetry, old invitations and old-host users break | Add `workers_dev = true`; assert it in domain-readiness and the artifact config check | S | high (docs quoted) |
| P1-2 | P1 | Release | scripts/production-preflight.mjs:46-47; website-release.yml:74-75 | Preflight compares live bindings with new source before deploy | The cutover release cannot pass without manual dashboard var edits | Accept a reviewed old→new transition; unit-test it | S | high |
| P1-3 | P1 | Accounts | wrangler.toml:61; scripts/domain-readiness.mjs:6; cloudflare/accounts.mjs:226-230 | `ACCOUNT_LEGACY_ORIGINS` not in config or check | Missing it means 403 on every workers.dev `/api/account/*` (old APKs, widgets, old-host web) | Add to `[vars]`; assert it equals `legacy − website` | S | high |
| P1-4 | P1 | Invitations | src/components/cloud-table.tsx:661 | Fresh invitation uses `location.origin`, bypassing `invitationUrl` | Broken `https://localhost` links on Android today; wrong host on web | Use `invitationUrl({native})` | S | high |
| P1-5 | P1 | Links | src/components/manual-chat.tsx:260; src/lib/quire/table.ts:367 | Activity-report link uses `window.location.origin` | Same on Android | Use the website origin when native | S | med |
| P1-6 | P1 | Audits | website-release.yml:91; verify-live.yml:26; domain-readiness.mjs:7-10 | Single `AUDIT_ORIGIN`; the plan requires both hosts | A legacy-host regression goes undetected | Add legacy audit origin(s) and loop the audits | M | high |
| P1-7 | P1 | Accounts | src/lib/quire/member-access.server.ts:28-31 | serverFn session lookup uses primary origin, not request host | Possible missed identity for account-owned rooms on the legacy host (unverified) | Pass `accountRequestOrigin(env, getRequest().url)`; rehearse | S | med |
| P2-1 | P2 | Widgets | android/.../WidgetActions.java:49 | Website button hard-coded to workers.dev | After cutover it opens the old host | Next APK: use the website origin; add a test | S | high |
| P2-2 | P2 | Monitoring | cloudflare/monitor-model.mjs:48 | Evidence allowlist lacks the new host | New-domain evidence links rejected | Add the new host and keep the old | S | high |
| P2-3 | P2 | Headers/SEO | server/middleware/grok-pwa.ts:33-37,74,88,108 | Trusts `x-forwarded-host`/`host` for OG, manifest and install page (live-reflected) | Spoofable meta; conflicts with plan rule; OG follows host | Use `deploymentOrigins.website`; add `og:url` and canonical | S | high |
| P2-4 | P2 | Push | src/lib/quire/push.server.ts:116; public/notify-sw.js:11 | Per-origin subscriptions plus 4-device cap | Users re-enabling on the new host may hit the cap; duplicate notifications | Guide text; consider an unsubscribe-on-old-host prompt; clear guidance | S | high |
| P2-5 | P2 | Readiness | src/components/migration-readiness.tsx:13-20 | Missing notifications, local audio, prefs, map cameras, chat outbox, guest reconnect, PWA/bookmarks, recovery archives; pending count only for the active campaign | Users silently lose device-only data (audio library is not in any backup) | Extend the guide; iterate all campaigns | M | high |
| P2-6 | P2 | Help | src/lib/help/content.ts:557; player-content.ts | No address-change guidance | User confusion | Update both guides at cutover | S | high |
| P2-7 | P2 | Ops scripts | scripts/development-status.mjs:9,17; scripts/monitor-publish.mjs:45 | Hard-coded host and Origin | Depend on the legacy listing; drift | Read `origins.mjs` | S | high |
| P2-8 | P2 | Links | src/components/website/about.tsx:120 | "Open the website" uses `nativeApi` | Points at the API host after a split | Use `website` | S | high |
| P2-9 | P2 | SEO | (absent) | No canonical, sitemap or robots directives | Duplicate indexing across two hosts | Canonical → new domain on both hosts; sitemap on new; 301 marketing pages later | M | high |
| P3-1 | P3 | Push | src/lib/quire/push.server.ts:131 | VAPID `sub` hard-coded | Cosmetic contact URL | Read `website` (or mailto) | S | high |
| P3-2 | P3 | Standby | standby/server.mjs:16 | Rejects only workers.dev as standby origin | Could accept the new primary as standby | Use `deploymentOrigins` | S | med |
| P3-3 | P3 | Monitoring | cloudflare/monitor-telemetry.mjs:50; scripts/monitor-publish.mjs:25 | OIDC `aud` names the old host | None if kept (opaque) | Keep; document as an identifier; if changed, change all in one commit | S | high |
| P3-4 | P3 | Security | public/.well-known (absent) | No security.txt | Disclosure contact missing | Add security.txt | S | high |
| P3-5 | P3 | HSTS | cloudflare/release-assets.mjs:56 | 1y, no includeSubDomains or preload | Fine now | Revisit after the domain is final; no preload before then | S | med |
| P3-6 | P3 | Android | AndroidManifest.xml:23-26 | No App Links | Join links open the browser, not the app | Optional App Links + assetlinks.json for the new domain (owner decision) | M | high |
| P3-7 | P3 | PWA | scripts/grok-pwa-shared.mjs:160 | Manifest name "Grok App" | Wrong install name | Static Lootsplit manifest | S | high |
| P3-8 | P3 | Native API | src/lib/deployment/origins.mjs:4 | `nativeApi` stays workers.dev | workers.dev is a permanent dependency | Later APK can move it after coexistence (keep legacy) | M | high |

---

## Cloudflare setup for lootsplitter.com (section 8)

All checked 2026-10-22.

- **Use a Workers Custom Domain, not a Route.** It points every path of the hostname at the Worker, creates the DNS record and certificate automatically, and fits a Worker with no other origin. Source: [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
  - The zone must be active in the same account. The hostname can't already have a CNAME, and wildcards aren't supported.
  - Apex and `www` are separate hostnames. Add both, or redirect `www` to the apex.
- **Keep workers.dev explicitly on.** `workers_dev` "Defaults to `true` when the configuration has no `route` or `routes`, and `false` otherwise". See [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) and [workers.dev routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/). This is finding P1-1.
- **The zone can use the Free plan.** "Workers Paid plan is separate from any other Cloudflare plan". Nothing found requires a paid zone ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)). The Free zone includes:
  - Universal SSL;
  - the WAF Free Managed Ruleset and unmetered DDoS protection ([plans](https://www.cloudflare.com/plans/));
  - HSTS settings;
  - one IP-based rate-limiting rule;
  - 10 Cache Rules.
- **Zone settings to leave off:**
  - **Bot Fight Mode:** it "may challenge API or mobile app traffic" and can't be bypassed with rules ([docs](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/)). That would put the Android app and widgets at risk.
  - **Rocket Loader:** it rewrites scripts against the CSP.
  - **Automatic Web Analytics injection:** blocked by the current CSP anyway.
  - **Zone HSTS:** the Worker already sends HSTS, so enabling it would duplicate the header.
- **TLS, DNSSEC and locks:**
  - Universal SSL covers the apex and first-level subdomains, and Custom Domains get their own Advanced Certificate ([limits](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/)).
  - With Cloudflare Registrar, DNSSEC DS records are added automatically within 1–2 days ([DNSSEC](https://developers.cloudflare.com/dns/dnssec/)).
  - The registrar lock is on by default, and transfers are blocked for 60 days after registration ([transfer out](https://developers.cloudflare.com/registrar/account-options/transfer-out-from-cloudflare/)). Registrar domains must use Cloudflare nameservers ([FAQ](https://developers.cloudflare.com/registrar/faq/)).
- **Account security:**
  - security key plus authenticator app, with backup codes kept offline ([2FA](https://developers.cloudflare.com/fundamentals/user-profiles/2fa/));
  - auto-renew on and the lock kept on;
  - a minimal-scope API token for CI.

### Registrar pricing

Cloudflare Registrar charges registry cost with no markup ([registrar](https://www.cloudflare.com/products/registrar/)). Cloudflare doesn't publish a price list, so these figures come from third-party trackers.

| TLD | On Cloudflare | Register (year 1) | Renew / year | Source |
| --- | --- | --- | --- | --- |
| .com | Yes | $10.46 | $10.46 | [domainoffer.net](https://domainoffer.net/tld/com/cloudflare) |
| .app | Yes (HSTS-preloaded TLD) | $8.20 | $14.20 | [porkbun calculator](https://porkbun.com/about/domain-cost-calculator/app) |
| .games | Yes | $26.20 | $26.20 | [domainoffer.net](https://domainoffer.net/tld/games/cloudflare) |
| .io | Yes (ccTLD; Chagos sovereignty risk, [Domain Incite](https://domainincite.com/31642-io-safe-for-now-as-trump-puts-chagos-deal-on-ice)) | $32.00 | $50.00 | [domainoffer.net](https://domainoffer.net/tld/io/cloudflare) |
| .gg | No (Porkbun; manual 30-day registry review) | $51.80 | $51.80 | [domainoffer.net](https://domainoffer.net/tld/gg/porkbun), [Safenames](https://www.safenames.net/domain-names/domain-name-regulations/gg) |

TLD support source: [Cloudflare TLD policies](https://www.cloudflare.com/tld-policies/).

### Name availability

Checked by registry lookup (RDAP) and DNS on 2026-10-22. A "not found" result is strong evidence, not a guarantee; confirm at checkout.

| Name | Status | Evidence |
| --- | --- | --- |
| **lootsplitter.com** (chosen) | Likely available | Verisign RDAP 404; no DNS |
| lootsplitter.app | Likely available | Google Registry RDAP 404; no DNS |
| getlootsplitter.com | Likely available | Verisign RDAP 404; no DNS |
| lootsplitter.games, lootsplitter.io | Unknown | RDAP rate-limited (429); no DNS |
| lootsplit.com | **Registered** | Registered 2026-08-28 at GoDaddy, expires 2027-08-28; Afternic nameservers, so likely parked for resale |
| lootsplit.app, lootsplit.games, getlootsplit.com, playlootsplit.com | Likely available | RDAP 404 |

**Cost:** about $10.46 a year for lootsplitter.com, plus $14.20 a year if lootsplitter.app is added as a redirect. The Free zone costs nothing, and the existing Workers Paid plan ($5 a month) doesn't change.

---

## Rename checklist: Lootsplit → Lootsplitter

This is a separate branch from the domain work. Old saves and backups must stay readable, per the feature-preservation rule.

| Area | Change | Keep unchanged |
| --- | --- | --- |
| Android | `android/app/src/main/res/values/strings.xml` (`app_name`, `title_activity_main`), `capacitor.config.ts` `appName`, widget labels | `appId` / package `com.unregisteredmusket.lootsplit`, so installs keep updating; the signing key |
| Website and app text | About 70 files of user-visible strings: `src/components/website/*`, `src/routes/*` titles, `src/lib/og/site.json` and the PWA manifest name (it currently says "Grok App"; see P3-7) | Internal identifiers: storage keys (`quire.*`, `lootsplit.*`), cookie names (`__Secure-lootsplit.*`), D1 tables, backup format names |
| Help | `src/lib/help/content.ts`, `player-content.ts`, with a note about the new name and address | Help anchors that other screens link to |
| Credits and release | `resources.ts` wording, `changelog.json`, `docs/RELEASE-NOTES.md`, an Android release with `APP_VERSION` and versionCode bumped | Earlier changelog entries as written (history) |
| Docs | CLAUDE.md product line, `FEATURE-INVENTORY.md` entry, README | Repository name, unless the owner decides to rename it |
| Tests and audits | Browser audits that match visible "Lootsplit" text, `live-release-audit.mjs` identity checks | Test fixtures for old saves |

**Order:** rename first, so announcements go out under the final name. Then the domain cutover. Then the marketing launch.

---
## Headline findings (details below)

1. **Adding a custom domain via `routes`/`custom_domain` in wrangler.toml would switch off workers.dev on the next deploy.** That would break every installed APK, the widgets, telemetry and old invitations. `wrangler.toml` has no `workers_dev` key (wrangler.toml:1-71). Cloudflare docs say that when `routes` are added and `workers_dev` is unset, "the value of `workers_dev` will be inferred as `false` on the next deploy." **P1, high.**
2. **Preflight blocks the cutover release itself.** `scripts/production-preflight.mjs:46-47` compares the *currently live* `ACCOUNT_ORIGIN`/`ACCOUNT_LEGACY_ORIGINS` bindings with the *new* source values *before* `wrangler deploy` (website-release.yml:74-75). The release that changes origins therefore fails unless someone edits Worker vars by hand first, and the plan's no-manual-change rule forbids that. **P1, high.**
3. **`ACCOUNT_LEGACY_ORIGINS` is not in `wrangler.toml`, and `migration:check` does not check it.** If it is missing at cutover, every `/api/account/*` request to workers.dev returns 403 "Account request host is not approved" (accounts.mjs:226-230). That breaks all old APKs, which call accounts with a bearer token at the workers.dev host, plus the owner widgets and old-host browser sign-ins. **P1, high.**
4. **The "Create fresh invitation" button does not use the shared invitation builder.** At cloud-table.tsx:661 it builds `new URL("/share", location.origin)`. On Android, `location.origin` is `https://localhost`, so the copied link is unusable today, and on the web it is the host the DM happens to be on. The plan says "both invitation controls share a URL builder", which is not true for this third control. The activity-report link in manual-chat.tsx:260 has the same `window.location.origin` issue. **P1 (bug today), high.**
5. **The PWA head middleware trusts `X-Forwarded-Host`/`Host`.** See server/middleware/grok-pwa.ts:33-37, 74, 88, 108. Live check: sending `X-Forwarded-Host: evil.example` to `/welcome` returns `<meta property="og:image" content="https://evil.example/og.jpg">`. The impact is limited (HTML is `private, no-cache`), but it conflicts with the plan's "never trust forwarded headers" rule, and OG URLs will follow whichever host was requested. **P2, high (observed live).**
6. **Web Push has a 4-device cap per seat** (push.server.ts:116-117). Subscriptions are bound to the origin of the service worker. Users who re-enable notifications on the new host while the old subscription still exists can hit the cap. Separately, old subscriptions keep delivering to the old origin's service worker, which opens `old-host/share?chat=1`. The readiness guide does not mention notifications. **P2, high.**
7. **Several origin constants ignore the shared config:** WidgetActions.java:49, push.server.ts:131, monitor-telemetry.mjs:50 with monitor-publish.mjs:25,45, monitor-model.mjs:48, development-status.mjs:9,17, standby/server.mjs:16, and about.tsx:120, which uses the *native API* origin as the "website" link. Classification is in the table in section 1.
8. **The readiness guide** (src/components/migration-readiness.tsx) covers pending sync, private PDFs, backups and campaign IDs. It does not cover notifications, the local audio library, map cameras, preferences, shortcuts, unsent chat outboxes, guest reconnect, installed PWA or home-screen shortcuts, bookmarks, or recovery archives. Its pending count is for the *active* campaign only.
9. **Android itself is origin-independent for local data.** The WebView origin is always `https://localhost` (capacitor.config.ts:10-12, no `server.url`), so a domain move costs Android users no local data. The APK compiles `deploymentOrigins.nativeApi` in, so supported old APKs keep working only while workers.dev stays attached *and* listed in `ACCOUNT_LEGACY_ORIGINS`.

---

## 1. Hard-coded origins: complete inventory

Search: `grep -rn workers.dev` over the whole repo excluding `node_modules`, `.git` and `docs/`, and a second search for `oliverstorie2017` without `workers.dev` (no other hits). The CSP lists no hosts. `release.json` points only at GitHub. `capacitor.config.ts` has no host. `public/` has no Lootsplit absolute URLs: only `$schema` URLs in public/download/*.schema.json, and `og.jpg` is referenced relatively and made absolute at runtime from the Host header (see 7).

Classes: (a) reads the shared config `src/lib/deployment/origins.mjs`; (b) must change at cutover; (c) must keep the old origin for legacy clients; (d) a bug today or a bypass of the shared config.

| # | file:line | What | Class | Notes / confidence |
|---|---|---|---|---|
| 1 | src/lib/deployment/origins.mjs:3 | `website` | b | The source of truth. Set it to the new domain at cutover. high |
| 2 | src/lib/deployment/origins.mjs:4 | `nativeApi` | c (keep) | Compiled into the APK through src/lib/mobile/origin.ts:3. Recommend keeping it on workers.dev for at least the first post-cutover APK; switching is a separate, later Android release. high |
| 3 | src/lib/deployment/origins.mjs:5 | `legacy` list | c | Already lists workers.dev. After cutover, `legacy` minus `website` must equal the Worker's `ACCOUNT_LEGACY_ORIGINS` (production-preflight.mjs:47). high |
| 4 | wrangler.toml:61 | `ACCOUNT_ORIGIN` var | b | Checked against `website` by scripts/domain-readiness.mjs:6 and the live binding by production-preflight.mjs:46. **No `ACCOUNT_LEGACY_ORIGINS` and no `workers_dev = true` here** (findings 1 and 3). high |
| 5 | .github/workflows/website-release.yml:91 | `AUDIT_ORIGIN` | b | Checked by domain-readiness.mjs:7-10, but it is a single origin, and the plan requires audits on BOTH hosts. high |
| 6 | .github/workflows/verify-live.yml:26 | `AUDIT_ORIGIN` | b | Same as #5. high |
| 7 | android/.../WidgetClient.java:15 | widget `ENDPOINT` | a* / c | scripts/android-widget.test.mjs:7-16 enforces equality with `nativeApi` and allows only one URL. Old widgets in installed APKs keep calling workers.dev under `/api/account/owner/monitor`, which needs workers.dev in `ACCOUNT_LEGACY_ORIGINS`. high |
| 8 | android/.../WidgetActions.java:49 | "website" button opens workers.dev | d → b | No test ties it to `website`. Tapping it after cutover would land on the old host. Change it in the next APK; the old host must keep serving `/` (no redirect of `/`). high |
| 9 | src/lib/quire/push.server.ts:131 | VAPID JWT `sub` | d → b | A contact identifier (RFC 8292), not a routing value. Push services accept any https/mailto subject, so changing it is optional and low-risk. It should read `deploymentOrigins.website`. The test at room-store.test.ts:833 pins the literal. high |
| 10 | cloudflare/monitor-telemetry.mjs:50 | OIDC `aud` = `https://lootsplit.oliverstorie2017.workers.dev/monitoring` | c (keep as an identifier) | The `aud` claim is an opaque string that GitHub signs. It does not need to follow the domain. **Recommend not changing it.** If it is changed, monitor-publish.mjs:25 and the tests (monitor-runtime.test.mjs:45, monitor-telemetry.test.mjs:25,130) must change in the same commit, or all CI telemetry returns 401. high |
| 11 | scripts/monitor-publish.mjs:45 | telemetry POST target | d / c | Hard-coded. It keeps working through workers.dev because `/api/owner-telemetry` is outside `/api/account/` and has no host check (monitor-telemetry.mjs:116-120). It should read `deploymentOrigins.nativeApi` or `website`. high |
| 12 | scripts/monitor-publish.mjs:25 | OIDC audience request | c | Must stay equal to #10. high |
| 13 | scripts/development-status.mjs:9,17 | owner task POST URL plus `Origin` header | d | Hard-coded. After cutover it still works only if workers.dev is in `ACCOUNT_LEGACY_ORIGINS`, because the Origin must equal the request host (accounts.mjs:231-234). It should derive both values from `deploymentOrigins.website`. high |
| 14 | cloudflare/monitor-model.mjs:48 | evidence-link host allowlist | d → b | Evidence URLs on the new domain will be rejected ("Use a credential-free Lootsplit, GitHub or Cloudflare evidence URL"). Add the new host and keep the old one, because stored links stay valid. high |
| 15 | standby/server.mjs:16 | refuses the primary origin as standby origin | d | Hard-coded. After cutover it should also refuse the new primary domain, so it should use `deploymentOrigins.website` and `.legacy`. med |
| 16 | src/components/website/about.tsx:120 | "Open the website" uses `API_ORIGIN` (native API) | d | It should use `deploymentOrigins.website`. Today both values are equal, so nothing is visibly broken. high |
| 17 | src/components/cloud-table.tsx:661 | fresh-invitation link from `location.origin` | d | On Android this yields `https://localhost/share?...`. It should use `invitationUrl({native: VITE_MOBILE...})`. high (code read; not run on device) |
| 18 | src/components/manual-chat.tsx:260 via src/lib/quire/table.ts:367 | activity-report link `seatHref(..., window.location.origin)` | d | Same Android problem. On the web it is correct per host. med (did not confirm the control is reachable on native) |
| 19 | src/lib/quire/invitation-url.ts:3 | invitations | a | Native builds use `deploymentOrigins.website`, which is compiled in. **Old APKs keep issuing workers.dev invitation links**, so the legacy host must keep serving `/share`. high |
| 20 | src/lib/mobile/origin.ts:3, src/lib/account/client.ts:50, src/lib/mobile/boot.ts:14, src/components/website/release-identity.ts:11 | native API calls | a | All use `API_ORIGIN = nativeApi`. high |
| 21 | scripts/failure-report.mjs:103, recovery-status.mjs:27, standby-backup.mjs:13, production-preflight.mjs:46-47, domain-readiness.mjs | ops scripts | a | high |
| 22 | cloudflare/owner-monitor.mjs:345-346, cloudflare/monitoring.mjs:51-52 | `ASSETS.fetch(new URL(..., env.ACCOUNT_ORIGIN))` | a | The asset binding ignores the host. high |
| 23 | scripts/grok-pwa-shared.mjs:10 (`og.grok.me`) | OG placeholder service | n/a | Not used, because site.json sets `card: "custom"`. med |
| 24 | Test fixtures: origin.test.ts:15,19; cors.test.ts:6; development-feedback.test.mjs:29 (asserts production is refused); room-store.test.ts:833; monitor-*.test.mjs | tests | b (update with #9/#10) | high |
| 25 | ANDROID.md:3, CLOUDFLARE.md:6, CLAUDE.md:3 | docs | b | Docs only. |

---

## 2. Accounts, sessions, CSRF and native access

**Verified (code read):**
- **Origin selection.** `accountRequestOrigin(env, request.url)` (origins.mjs:20-28) validates `ACCOUNT_ORIGIN` and the comma-separated `ACCOUNT_LEGACY_ORIGINS` as exact HTTPS origins, rejecting wildcards, paths and credentials (origins.mjs:8-15). It then requires the *request URL's* origin to be one of them. Forwarded headers are never read. accounts.mjs:226-230 returns 403 otherwise. accounts.mjs:253 builds Better Auth per request with `ACCOUNT_ORIGIN: authOrigin`, so `baseURL` and `trustedOrigins` (accounts.mjs:79,83) are the host actually requested plus the native origins. high
- **CSRF on `/api/account/*`.** The `Origin` header must be absent, equal to `authOrigin`, or one of the native origins (accounts.mjs:231-234). POST requires `Origin` and `application/json` (accounts.mjs:255-258). A legacy-host page cannot mutate on the new host and vice versa; the test at domain-readiness.test.mjs:31-32 covers this. high
- **CSRF on `/_serverFn/*`.** src/start.ts:12-19 uses TanStack `createCsrfMiddleware`. Sec-Fetch-Site must be same-origin/none, or the Origin must be a native app origin or equal to `new URL(request.url).origin`. This works per host with no configuration. high
- **Cookies.** Better Auth 1.6.33 defaults (node_modules/better-auth/dist/cookies/index.mjs:15-40): with an https `baseURL` the name is `__Secure-lootsplit.session_token`, with `Secure; HttpOnly; SameSite=Lax; Path=/`, and no `Domain` because `crossSubDomainCookies` is not set (accounts.mjs:92). Cookies are therefore host-only, and each origin signs in separately. domain-readiness.test.mjs:25-30 asserts Secure and no Domain. high. One Better Auth session row is shared across hosts in D1, so sessions do not conflict.
- **Email and OAuth callbacks.** None exist. There is no `sendResetPassword`, `sendVerificationEmail` or `socialProviders` (grep of cloudflare/, src/, scripts/). Account recovery uses a recovery *key* (accounts.mjs:285-322), not an email link. The only outgoing mail is the owner failure report via Resend, which uses `deploymentOrigins.website` (scripts/failure-report.mjs:103). A `callbackURL` to a foreign origin is rejected (test at domain-readiness.test.mjs:34-35). high
- **Native bearer and CORS.** `nativeOrigins = https://localhost, http://localhost, capacitor://localhost` (accounts.mjs:46; src/lib/mobile/origin.ts:6). CORS headers are reflected *only* for those exact origins (accounts.mjs:240-248; server/middleware/mobile-cors.ts:24-25). `bearer({requireSignature: true})` (accounts.mjs:94). The client sends `credentials: "omit"` plus a bearer on native (client.ts:47-56). No wildcard CORS anywhere. high
- **Rate limits and IP.** Only `cf-connecting-ip` is used (accounts.mjs:92,157). Standby strips caller `cf-connecting-ip` and forwarded headers and pins the authority (standby/http.mjs:41-56). high

**Gaps:**
- **G2.1 (P1, high).** The host check runs *before* the native-origin check. Native apps therefore need their *request host* (workers.dev, compiled in) listed in `ACCOUNT_ORIGIN` or `ACCOUNT_LEGACY_ORIGINS`. This is correct behaviour, but it makes `ACCOUNT_LEGACY_ORIGINS` mandatory for every old APK and widget.
- **G2.2 (P1, med).** `currentAccountId()` (src/lib/quire/member-access.server.ts:26-31) calls `accountAuth(env)` with the *primary* `env.ACCOUNT_ORIGIN`, not the request origin, for server functions on the legacy host. `getSession` reads the cookie and verifies it with the secret, so it probably works across hosts, but I did not verify this. It must be covered in the two-host rehearsal: an account-owned DM using a room on the legacy host after cutover. The safer fix is to pass `accountRequestOrigin(env, getRequest().url)`.
- **G2.3 (P2).** `cloudflare/accounts.mjs` `trustedOrigins` (line 83) never contains the *other* host, which is intended. Do not "fix" this by adding both.
- **Confirmed:** nothing requires wildcard CORS, disabled origin checks or trusting Host or forwarded headers. The one place that does trust them is the PWA middleware (finding 5 / P2-3), and its fix is to *stop* trusting them.

---

## 3. Origin-scoped data users lose when moving origins (web only)

All of the following live in the browser and are per origin, so the new domain starts empty. Android is unaffected (origin `https://localhost`).

| Data | Where (file:line) | Storage | Covered by readiness guide? |
|---|---|---|---|
| Campaign databases (one per campaign, `quire*`) | src/lib/quire/db.ts:9-28,41-51 | IndexedDB | Yes: backups, campaign ID, separate destination (migration-readiness.tsx:16-19) |
| Campaign list and active campaign | `quire.campaigns.v1`, `quire.campaign.v1` (campaign-context.ts:1) | localStorage | Indirectly |
| Device backups (`lootsplit-saves`) | src/lib/quire/saves.ts:5,33 | IndexedDB | Yes ("Device backups below") |
| Private library PDFs | library.tsx (`books`) | IndexedDB | Yes: count shown (line 14) |
| Pending sync commands and cloud seat state | `quire.cloud.v2.<id>` (cloud-client.ts:133) | localStorage | **Partly: active campaign only** (line 13 uses one `room`). Other campaigns' pending work is not counted. |
| Seat tokens / room membership for guest or legacy seats | `quire.seat.v1[.id]` (table.ts:63) | localStorage | Partly ("finish pending work") |
| Guest reconnect ticket | `lootsplit.player.reconnect.v1` (cloud-client.ts:49; campaign-gate.tsx:81) | sessionStorage | **No.** Guests must reopen the invitation on the new host; the DM may need to issue fresh invitations. |
| Multi-window campaign pin | `lootsplit.window.campaign.v1` (campaign-context.ts:2) | sessionStorage | No (minor; lost per tab anyway) |
| Verified-account marker, revoked-recovery archives | `lootsplit.verified-account` (ss), `quire.account-recovery.v1.*` (revoked-recovery.ts:16) | session/localStorage | **No.** Device-recovery archives exist only on the old origin. |
| Native account token | `lootsplit.account.token.v1` | localStorage (native only) | n/a |
| Web Push subscription and service worker | public/notify-sw.js; push-notices.tsx:56-76; notify.ts:93 | SW registration + D1 `push_subscriptions` | **No.** Must re-enable on the new host. The old subscription keeps firing to the old origin. 4-device cap (push.server.ts:116). |
| Notification permission | browser | per origin | **No** |
| Local audio library (≤200 MB, "never included in backups") | src/lib/quire/local-audio-library.ts:1-4 | IndexedDB `lootsplit.local-audio.v1` | **No.** Not recoverable from any backup; the user must re-import the files. |
| Map camera / last map | `lootsplit.map-view.v1:*` (map-view-state.ts:21,93) | localStorage | **No** (convenience) |
| Personal map drawings ("yours on this device", player-content.ts:225) | device-local | localStorage/IDB | **No.** Did not locate exact key. low |
| Preferences (theme, roll mode, etc.) | `quire.prefs.v1` (prefs.tsx:68) | localStorage | **No** |
| Shortcuts / account shortcuts | `lootsplit.shortcuts.v1.*`, `lootsplit.account-shortcuts.v1.*` | localStorage | No |
| Unsent chat outbox | `lootsplit.chat.outbox.v2.*` (chat-composer.ts:108) | localStorage | **No.** It should say: send or discard before switching. |
| Party sheet links, split-view, navigation resume, Open5e search, reports, notices, guide offers | party-sheet-links.ts:4, split-view.ts:9, navigation-launch.ts:1, `quire.reports.v1`, etc. | local/sessionStorage | No (minor) |
| Installed PWA / home-screen icon, bookmarks | manifest at `/__grok/manifest.webmanifest` (`start_url: "/"`) | browser | **No.** Users must reinstall or re-bookmark. |
| Session cookie | Better Auth | cookie | Yes ("sign in normally", line 18) |

**Other guide issues:**
- Line 20 promises: "Installed Android versions and existing invitations will keep their supported endpoint during the transition." That holds only if P1-1 and P1-3 are fixed.
- src/lib/help/content.ts:557 ("Use the same browser profile and website address…") needs a cutover note. player-content.ts has no address-change guidance.
- The guide is shown to both roles (settings-page.tsx:83 for players, 104 for DMs). That is good. The player step tells players to ask the DM, which is fine.

---

## 4. Android

- **Hosts compiled into the APK:** (1) `nativeApi` via src/lib/mobile/origin.ts:3, used for `/_serverFn/*` rewrite (boot.ts:14), `/api/account/*` (client.ts:50) and release identity; (2) `deploymentOrigins.website` for invitations (invitation-url.ts:3); (3) WidgetClient.java:15; (4) WidgetActions.java:49. No `server.url` (capacitor.config.ts:10-12; ANDROID.md:5), so the UI is bundled and served from `https://localhost`. high
- **Old APK compatibility through the legacy origin:** it works if workers.dev stays attached (`workers_dev = true`), workers.dev is in `ACCOUNT_LEGACY_ORIGINS`, and `/_serverFn/*`, `/api/account/*`, `/assets/release-identity.json` and `/share` are **not redirected**. Server-function CSRF and CORS accept `https://localhost` on any host (start.ts:14-18; mobile-cors.ts:25). The widget uses `setInstanceFollowRedirects(false)` (WidgetClient.java:36), so **any redirect breaks the widgets**. high
- **network_security_config:** none exists (android/app/src/main/res/xml has backup_rules, data_extraction_rules, file_paths and two widget infos). targetSdk 36 (variables.gradle:4) means cleartext is off by default, and `allowMixedContent: false` (capacitor.config.ts:8). No change is needed for a domain move. high
- **file_paths.xml:** cache root and `Pictures/` only; not origin-related. high
- **Manifest:** only a LAUNCHER intent filter on MainActivity (AndroidManifest.xml:23-26), plus widget and configure receivers. **No https deep links or App Links (no `autoVerify`)**, and `public/.well-known/` does not exist. Live `/.well-known/assetlinks.json` returns 404. Nothing to migrate. Adding App Links for the new domain is an optional P3 feature (needs assetlinks.json with the permanent signing cert SHA-256 and an owner decision). high
- **Release download:** `release.json` points to GitHub (`apkUrl`, `releaseUrl`, `checksumUrl`), and `/download/android` proxies with a sha256 check (src/lib/website/android-download.ts:4-30). It is origin-agnostic. The website audit tests `/download/android` on `AUDIT_ORIGIN` (website-browser-audit.mjs:5-8). Keep `/download/android` served (not redirected) on the old host. high
- **What an app update must change** (CLAUDE.md "Android releases", AGENTS.project.md): `APP_VERSION` (src/lib/quire/version.ts:1, now 1.9.3); `versionCode` and `versionName` (android/app/build.gradle:10-11, now 16 / "1.9.3"); a `src/lib/website/changelog.json` entry; release notes; publication only through `android-release.yml`; and `release.json` updated after the signed APK is verified. For domain work the APK update should change WidgetActions.java:49 to the new website and fix #17/#18. `nativeApi` can stay on workers.dev. If it later moves, WidgetClient.java:15 and android-widget.test.mjs move with it.

---

## 5. Push, monitoring, widgets, probe, standby

- **VAPID:** keys are generated once and stored in D1 `push_config` id `vapid` (push.server.ts:42-60), so they are **not tied to the origin** and both hosts share them. The JWT `aud` is the push service origin (line 129). `sub` is the hard-coded workers.dev URL (line 131), which is cosmetic. Endpoints are restricted to FCM, Mozilla and Apple (push.server.ts:24-38). The `/share?chat=1` click target is relative to the service worker's origin (notify-sw.js:11), so old-host subscriptions open the old host. That is acceptable during coexistence. high
- **Owner monitoring:** `/api/account/owner/monitor` (widgets, account page) is under the account host check, so it needs the legacy host listed. `/api/owner-telemetry` (monitor-telemetry.mjs:116) has no host check; it requires no Origin and a GitHub OIDC JWT with `aud === "https://lootsplit.oliverstorie2017.workers.dev/monitoring"` (line 50), `iss`, repo, repo/owner IDs, a main ref and an allowlisted workflow (lines 4-20, 45-68). Recommendation: keep `aud` unchanged as an opaque identifier. high
- **Widget tokens:** the widget gets the account bearer through `OwnerWidget.connect({token})` (src/lib/mobile/owner-widget.ts:15) and calls `ENDPOINT` with `Authorization: Bearer`. It is host-sensitive only through `ACCOUNT_LEGACY_ORIGINS`. high
- **Multiplayer probe** (cloudflare/multiplayer-probe.mjs): runs in the scheduled handler through the room code path directly. It makes no HTTP self-fetch and has no origin dependency. high
- **Cron:** a single minute cron (wrangler.toml:7-8), independent of routes. Attaching a custom domain does not duplicate it. high
- **Standby:** locked by default (render.yaml `STANDBY_MODE: locked`). When active, it pins every request to its own `ACCOUNT_ORIGIN` (standby/http.mjs:51-53) and refuses workers.dev as that origin (server.mjs:16, hard-coded; see table #15). scripts/standby-backup.mjs:91,113 probes `deploymentOrigins.website` for `/.well-known/lootsplit-recovery` and release identity, so after cutover it probes the new domain, which is the same Worker and therefore fine. high

---

## 6. Security headers

Source: cloudflare/release-assets.mjs:50-58, applied to every Worker response through `releaseResponse` (lines 13-28). Confirmed live on `/`, `/welcome`, `/robots.txt` and the 404s:

```
Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; script-src-attr 'none'; worker-src 'self' blob:
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000
```

- **The CSP contains no host names.** Only `'self'` is used, so a domain move needs **no CSP change**. There is no `default-src`, `connect-src`, `img-src`, `style-src` or `frame-src`, so connections and images are currently unrestricted. live-release-audit.mjs:50 asserts that `SCRIPT_POLICY` is present. high
- **HSTS:** one year, no `includeSubDomains`, no `preload`. workers.dev sits under the `.dev` TLD, which is HSTS-preloaded by the browser. Recommendations for the new domain: keep the current header until the domain is final. Add `includeSubDomains` only after every subdomain of the zone is confirmed HTTPS-only. **Do not submit to hstspreload.org before the domain is final and stable**, because removal takes months. If the domain is on a preloaded TLD (.app, .dev, .page) this is moot. Do not also enable Cloudflare's zone HSTS, which would produce a duplicate or conflicting header, unless the Worker header is removed. med
- **Cookies:** see section 2 (`__Secure-` prefix, Secure, HttpOnly, SameSite=Lax, host-only). high
- **security.txt:** absent (`public/.well-known/` does not exist; live `/.well-known/security.txt` returns 404). P3: add `public/.well-known/security.txt` with `Contact:`, `Expires:`, and `Canonical:` for both hosts. Note that `/.well-known/lootsplit-recovery` is served by recoveryGuard (recovery-guard.mjs:4); a static file would not conflict. high
- **CSP changes ads or analytics would need:** each provider's script host in `script-src`. Examples: Cloudflare Web Analytics `https://static.cloudflareinsights.com`; Google tag `https://www.googletagmanager.com`; AdSense `https://pagead2.googlesyndication.com` plus partner hosts, which also need `frame-src` for ad iframes. The comment at release-assets.mjs:30-48 deliberately blocks third-party scripts; adding any is an owner decision with privacy implications (players' data). If `connect-src`/`img-src` are introduced later, the analytics beacon hosts must be listed (e.g. `https://cloudflareinsights.com`). Cloudflare's *automatic* Web Analytics injection in a new zone would be blocked by the current `script-src`, so if the zone enables it, the release CSP audit or browser console would show violations. Leave it off. med

---

## 7. SEO and redirects

**Current state (live GETs plus code):**
- **Canonical:** no `<link rel="canonical">` anywhere (grep of src; live `/welcome`). high
- **sitemap.xml:** 404 live. high
- **robots.txt:** live returns only Cloudflare "content signals" comments with no `User-agent`/`Sitemap` lines. It is not in `public/`, so it is probably Cloudflare-managed. A new zone will have its own managed robots setting. med/low (source not confirmed)
- **OG/Twitter:** injected at runtime by server/middleware/grok-pwa.ts:99-109 → scripts/grok-pwa-shared.mjs:342-380. `og:image` and `x:game:image` are `https://<request host>/og.jpg`. There is no `og:url`. Per-route heads set only `<title>` (e.g. downloads.tsx:4, features.index.tsx:5). The host comes from `x-forwarded-host ?? host` (grok-pwa.ts:33-37), or from `VITE_PUBLIC_HOSTNAME` if set at build. Live result: `/welcome` gives `og:image=https://lootsplit.oliverstorie2017.workers.dev/og.jpg`, and with `X-Forwarded-Host: evil.example` it gives `https://evil.example/og.jpg`. high
- **Manifest:** `/__grok/manifest.webmanifest` reports `"name": "Grok App"` (host-derived; grok-pwa-shared.mjs:160). This is wrong branding already today. P3. high
- `/` returns `307 → /?view=home`.

**Redirect policy (old host → new host):**

| Path | 301 OK? | Reason |
|---|---|---|
| `/welcome`, `/features`, `/features/*`, `/updates`, `/help`, `/resources`, `/donate`, `/downloads` (page) | **Yes, but only after** the coexistence window starts and users were told, as a GET-only 301 for HTML documents | Static marketing and help content with no origin-scoped data. Safer first step: serve `rel=canonical` → new domain on both hosts, and redirect later. |
| `/`, `/?view=*`, `/settings`, `/characters`, `/party`, `/market`, `/maps`, `/encounters`, `/library`, `/book/*`, `/read/*`, `/shop/*`, `/catalog`, `/favorites`, `/player-display` | **No** | Local campaigns, backups and PDFs live in the old origin's storage; a redirect strands them. |
| `/account` | **No** | Old-host sign-in, device recovery and account campaigns must stay reachable. |
| `/share` (join links, chat click target) | **No** | Old APKs and existing invitations use it; guests' reconnect tickets and the DM's local room state are on the old origin. |
| `/api/*` (account, auth, owner monitor/widget), `/_serverFn/*`, `/api/owner-telemetry` | **Never** | Authenticated, native bearer, CSRF-checked; the widget refuses redirects. |
| `/download/android` | **No** | Checksum proxy, audited per host. |
| `/assets/*` incl. `/assets/release-identity.json`, `/ocr/*`, `/notify-sw.js`, `/favicon.svg`, `/__grok/*`, `/.well-known/lootsplit-recovery` | **No** | SW updates fail on redirect; identity and recovery probes are per host. |

---

## 9. Activation checklist (DOMAIN-READINESS steps 2–7, made concrete)

Guard hook reminder: `.claude/hooks/guard.mjs` blocks `wrangler deploy`, remote D1 writes (`d1 execute --remote`, `d1 migrations apply --remote`; lines 55-60) and pushes to main. Releases go only through `verify.yml` → `website-release.yml`. Cloudflare dashboard actions (custom domain, zone settings) are **owner-only**.

### Prerequisite PRs (before step 2; each a normal branch + PR + green CI)
- **PR-A "domain cutover guards"** (P1):
  1. Add `workers_dev = true` (and `preview_urls` if previews are used) to wrangler.toml. Make `scripts/domain-readiness.mjs` and `release-artifact.mjs`/`runtime-policy` assert it, so a later `routes`/`custom_domain` edit cannot disable workers.dev.
  2. Add `ACCOUNT_LEGACY_ORIGINS = ""` to wrangler.toml `[vars]`. Extend domain-readiness.mjs to assert that it equals `legacy − website`.
  3. Make production-preflight.mjs:46-47 accept a *transition*: the live binding may equal either the new source value or the value from the previous `deploymentOrigins` (e.g. a reviewed `PREVIOUS_WEBSITE_ORIGIN` constant), and only when the new legacy list contains the old website. Unit-test it.
  4. Allow `domain-readiness.mjs` and the workflows to take `LEGACY_AUDIT_ORIGINS` and run `live-release-audit.mjs` plus `website-browser-audit.mjs` once per origin.
- **PR-B "origin constants"** (P1/P2): fix #8 (next APK), #13, #14, #15, #16, #17, #18 and #9 to read `origins.mjs`. Stop trusting `x-forwarded-host` in grok-pwa.ts: use `deploymentOrigins.website` for OG and manifest, add `og:url` and `<link rel=canonical>` for public pages, and fix the "Grok App" manifest name. Pass the request origin in member-access.server.ts:31.
- **PR-C "readiness guide and help"** (P2): add the missing items from section 3. Count pending work across all campaigns. Update help content.ts:557 and player-content.ts. Review recorded in the PR per CLAUDE.md.

### Step 2: record the baseline (owner + agent, read-only)
- `npm run recover:status`. Note the live commit from `GET /assets/release-identity.json` and the `X-Lootsplit-Worker-Version` header.
- Download the latest `production-verification-<sha>` artifact (`test-results/production-preflight.json` holds `previousDeployment`).
- Record D1 id `0a200e96-ae2e-47b5-9869-c1f4d316148f` and Worker `lootsplit`.
- Owner: make a verified encrypted backup (Device backups → import back to validate). Confirm D1 Time Travel retention.
- **Owner sign-off #1:** baseline recorded.

### Step 3: attach the domain to the same Worker (owner, dashboard)
- Workers & Pages → lootsplit → Settings → Domains & Routes → Add Custom Domain. Do **not** remove workers.dev; confirm "workers.dev: Enabled".
- Do not add zone redirect rules or Page Rules for workers.dev paths. Leave Cloudflare zone HSTS, Web Analytics auto-inject and Rocket Loader **off**, because Rocket Loader rewrites scripts against the CSP.
- Verify DNS and TLS with read-only `curl -sSI https://lootsplitter.com/assets/release-identity.json` (same commit). `/api/account/auth/get-session` on the new host will be **403 "host not approved"** until step 4. That is expected; anonymous pages work.
- Registrar: MFA, lock and DNSSEC review per step 1.
- **Owner sign-off #2:** domain serves the same identity on both hosts.

### Step 4: config release (agent PR, owner approves merge)
- In one PR: `origins.mjs` `website: "https://lootsplitter.com"`, `nativeApi` unchanged (workers.dev), `legacy: ["https://lootsplit.oliverstorie2017.workers.dev"]`; wrangler.toml `ACCOUNT_ORIGIN = "https://lootsplitter.com"`, `ACCOUNT_LEGACY_ORIGINS = "https://lootsplit.oliverstorie2017.workers.dev"`, `workers_dev = true`; both workflows' `AUDIT_ORIGIN: https://lootsplitter.com` plus the legacy audit origin; test literals as needed.
- Locally: `npm run migration:check`, `npm run verify:quick`, `node --test scripts/domain-readiness.test.mjs scripts/android-widget.test.mjs`.
- The PR description is the checkpoint, with a help review recorded.

### Step 5: rehearsal before merge
- Full CI on the PR (build plus all dev-server audits). Do not push while it runs.
- Disposable two-host rehearsal using the existing pattern in domain-readiness.test.mjs (two HTTPS origins, one disposable DB), extended to browser level. Two hostnames such as `new.localhost` and `old.localhost` via Playwright `--host-resolver-rules` are acceptable, with `npm run verify:focus -- <scenario>` for: sign-up/sign-in/sign-out/recovery key on each host; invitation (both builders plus fresh-invitation); end/reopen session; per-campaign IDs; pending turns; map uploads; encrypted backup import and load into a separate campaign; interrupted save; native bearer from `https://localhost` against the *legacy* host (`/api/account/library`, `/_serverFn/*`, the owner monitor `?view=widget`); serverFn `currentAccountId` on the legacy host (G2.2); rollback (switch config back).
- Physical device: install the **currently published 1.9.3 APK** and confirm rooms, account, both widgets and invitations against the legacy host.
- **Owner sign-off #3:** rehearsal evidence attached to the PR.

### Step 6: publish and verify both hosts
- Merge (owner standing approval) → `verify.yml` on main → `website-release.yml` (production-migrations → production-preflight → `wrangler deploy --keep-vars` → runtime-policy → live audits).
- The release must run `live-release-audit.mjs` and `website-browser-audit.mjs` with `AUDIT_ORIGIN=https://lootsplitter.com` **and** `AUDIT_ORIGIN=https://lootsplit.oliverstorie2017.workers.dev`. Re-run on demand with `verify-live.yml` (workflow_dispatch: `release_sha`, `verification_run_id`) for each origin.
- Manual read-only checks on both hosts: `/assets/release-identity.json` commit, CSP/HSTS headers, `/download/android` HEAD gives 200 with `X-Release-SHA256`, `/api/account/auth/get-session` gives 200 (not 403) on both, `/.well-known/lootsplit-recovery` gives `{"mode":"primary"}`.
- Confirm the owner monitor daily report shows telemetry and widget refreshes still arriving (`X-Lootsplit-Version` from old APKs).
- **Owner sign-off #4:** released and confirmed on both hosts.

### Step 7: tell users
- Site announcement (`saveAnnouncement`, owner account page): new address; sign in again; local campaigns do not move automatically; open Settings → "Prepare for a future website address change"; re-enable notifications; reinstall the home-screen app or update bookmarks; Android needs no action.
- Changelog entry in the next Android release, and help pages updated.
- Do not redirect app routes. Optionally add, in a later PR, a dismissible banner on the old host's public pages pointing to the new address, and later 301s for marketing pages only (section 7).

### Rollback triggers (any one)
Wrong identity or asset hashes on either host; sign-in, recovery or invitation failures on either host; 403 "host not approved" or "Origin not allowed" spikes in Worker logs; server-function CSRF rejections; old-APK or widget failures (owner monitor widget gaps); failed backup validation; preflight or migration anomalies.

**Rollback:** revert the config PR on main (gated release). For urgency, use Cloudflare Worker version rollback to `previousDeployment` from production-preflight.json (owner, per CLOUDFLARE.md:119-128). Keep the custom domain attached unless it is itself the fault; detaching it does not affect workers.dev. Never restore D1 to undo a domain binding. Re-verify both hosts afterwards.

### Coexistence period
- **Native API (workers.dev): indefinitely**, or at minimum until no supported APK compiled with workers.dev is in use, judged from widget `X-Lootsplit-Version` telemetry, and only with explicit owner approval to retire it. Old APKs cannot be updated remotely.
- **Old-origin web UI and recovery: at least 12 months** (recommendation), so users can export local-only data. Do not retire it while the owner monitor shows old-host sign-ins.
- **Owner sign-off #5:** coexistence duration and any later legacy retirement.

---

## `npm run migration:check` output (2026-10-22, `main` at `ca29406`)

```
> migration:check
> node scripts/domain-readiness.mjs

{
  "ok": true,
  "activated": false,
  "origins": {
    "website": "https://lootsplit.oliverstorie2017.workers.dev",
    "nativeApi": "https://lootsplit.oliverstorie2017.workers.dev",
    "legacy": [
      "https://lootsplit.oliverstorie2017.workers.dev"
    ]
  },
  "remaining": [
    "Owner-selected domain and approved DNS/TLS activation",
    "Registrar and Cloudflare account security review",
    "Real two-host cutover, legacy APK and rollback rehearsal before activation"
  ]
}
```

This check confirms that the source, Wrangler and live-audit origins agree today. At the time it didn't check `workers_dev` or `ACCOUNT_LEGACY_ORIGINS` (P1-1, P1-3); `fix/domain-cutover-guards` added both checks (see Status updates). It doesn't prove live readiness.

## Status updates

- 2026-10-22, PR `fix/domain-cutover-guards` (PR-A, without P1-7, which is a separate PR): **P1-1** `workers_dev = true` is set and asserted by `migration:check`, the release artifact config and preflight. **P1-3** `ACCOUNT_LEGACY_ORIGINS = ""` is in `[vars]` and asserted to equal `legacy − website`. **P1-2** preflight accepts the reviewed transition (`previousDeploymentOrigins` in `origins.mjs`) only when the new legacy list keeps the old website. **P1-6** both live-audit workflows declare `AUDIT_LEGACY_ORIGINS` and run each audit once per origin via `scripts/live-audit-origins.mjs`. The live origin is unchanged.
- 2026-10-22 `fix/origin-constants`: fixed P1-4, P1-5, P1-7, P2-2, P2-3 (forwarded host no longer trusted; `og:url` + canonical on public pages), P2-7 (POST targets; OIDC audience kept), P2-8, P3-1, P3-2.
