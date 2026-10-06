# DM navigation and payment review clarity

Baseline: verified main/live `8a8e28c3afda624abd33c7e43a602fe061891ae5`, PR55, main verification37487891026 and deployment37488564832. Remote main and live identity reconciled before editing. Branch: `fix/dm-review-local-play`.

The DM Desk retains Multiplayer settings and removes the repeated standalone room/chat/status link and duplicate Campaign tools entry. Player entries remain. Review Inbox now shows Payments & loans awaiting approval, its empty state and existing decisions/history, without the shared submission form. Player Bank retains spending requests. DM Bank retains its manual queue action with wording explaining that approval debits the selected account. No invoice, DM-directed transfer, permission, financial command, schema or saved campaign changed.

Offline investigation: the owner gate and IndexedDB support an already verified DM’s saved device campaign. Shared turns call the server. The notification service worker does not cache the website interface; Android bundles it. UI/Help now state these boundaries. `docs/plans/offline-pass-phone.md` specifies local handoff and cross-platform offline launch; neither is implemented in this maintenance change. Installed APKs are not updated by a website release.

## Local verification

Node22.23.3, Chromium133.0.6943.0, source-isolated Vite, empty database, synthetic signed-in owner. Scratch cleanup had removed the runtime/browser; the initial browser attempt failed before launching. Restored the same runtime/browser package and the browser doctor passed. Current-browser full CI remains mandatory.

- Quick suite:508 passing tests/four existing skips; clean types and zero lint errors/34 existing warnings.
- Cloudflare web and Capacitor mobile builds passed; no APK signing/publication.
- Expanded control-panel26.138s,20:10:01.917–20:10:28.055UTC: single DM entry, empty inbox without composer, retained DM Bank action, real player submission/DM decline, title/navigation, settings, shortcuts and320/390/768/1440 widths. Screenshot inspected.
- Full finance25.633s,20:10:28.057–20:10:53.690UTC: desktop/mobile funding, downtime preview/consent/approval, reload, repayment and campaign isolation. Existing permission/atomic-payment regressions pass.

## Performance review

Read current readable log, baselines and state. Latest recorder37519891110 succeeded; no pending runs or new observations since PR55’s final analysis. Party-selector resolution remains archived. Local control-panel26.138s is below the last logged comparable27.105s under the same v3 scope/environment. Finance25.633s is below the logged29.099s reference; the intervening23.082s was not a reset. No qualifying local entry or reference change, and no application speedup is claimed.

Open repeated trends: CI control-panel14→24s,+10s/+71.43%,two rises with expanded scrolling/navigation checks; development finance17→28s,+11s/+64.71%,two rises; packaged finance11→19s,+8s/+72.73%,three rises; full PR verification220→403s,+183s/+83.18%,three rises. Last main277s remains below403s without resetting it. Setup/cache/runner effects coexist with expanded workloads. Inspect this release’s actual execution before diagnosing gameplay latency.

Deployment98→156s has two rises,+58s/+59.18%; latest128→156s adds28s/+21.88%. Live audit69→81s adds12s/+17.39%, including31.268s asset convergence. Old queue4→6780s is infrastructure delay. Preserve findings and inspect new readiness evidence. Parallel job durations overlap; do not sum them as waiting time.

Fresh exact-head PR/main checks, immutable deployment and read-only live verification remain required. Record final evidence in the PR. Local verification is not a release.
