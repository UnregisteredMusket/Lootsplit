# Website and download center

Public pages: `/welcome`, `/downloads`, `/updates`, `/help`. Existing campaign routes, including `/`, keep their URLs. Public pages bypass campaign providers so browsing the website does not initialize a campaign. The app links back through Website & downloads on the desktop rail and mobile More menu.

The Android button calls `/download/android`. Its server-only handler fetches the fixed published GitHub APK, verifies SHA-256 before returning any APK bytes, and sets attachment/MIME headers. Failures return a non-cacheable 503 and recovery instructions; Downloads also links directly to GitHub. No URL from the visitor is fetched. Public downloads neither require a campaign nor access campaign state. This endpoint uses outbound GitHub access on the deployed Worker.

`src/lib/website/release.json` is the reviewed release manifest. When publishing a newer permanent-signed APK, verify the asset first, update version/date/filename/URLs/checksum together, update release notes and version-code copy, and deploy the site. Do not point at an unreleased Android version merely because the web app version changed. The existing Android release/signing workflow is unchanged.

PC access currently uses the browser app. Native Windows/macOS installers, account registration, a publishing dashboard, content packs, analytics, and a forum are outside this change. No domain purchase or DNS migration is performed. Keep the current browser origin for existing saves; a future custom domain needs an explicit backup/migration flow.

Verification: typecheck, web/mobile builds, existing full suite plus download failure/integrity/header tests. Browser verification checks all public pages at desktop/mobile widths and navigation back to the original application. Never test against real campaign rooms.

## Validation recorded for this implementation
- 355 tests passed; four existing legacy-document tests skipped.
- TypeScript, Cloudflare build and bundled mobile build passed.
- Development and production-output browser checks passed for four public pages at 1280px and 390px, including download details, help links and navigation back to Party in the app.
- No app runtime errors or same-origin failed resources. The sandbox blocked the pre-existing external Grok extension script; it is retained unchanged. Explicit-root brand asset verification passed.
- Live deployment and a real download through the deployed endpoint remain pending: automatic approval review rejected the GitHub push for lack of explicit repository publishing authorization. No publishing workaround was attempted.
