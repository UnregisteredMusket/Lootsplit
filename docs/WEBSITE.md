# Website and download center

Public pages: `/welcome`, `/features`, `/downloads`, `/updates`, `/help`, `/resources`, `/donate` (and `/account`, which shares the website header and footer). Existing campaign routes, including `/`, keep their URLs. Campaign providers remain mounted across public-page navigation to preserve account/campaign context while lazy routes load. The app links back through Website & downloads on the desktop rail and mobile More menu.

The Android button calls `/download/android`. Its server-only handler fetches the fixed published GitHub APK, verifies SHA-256 before returning any APK bytes, and sets attachment/MIME headers. Failures return a non-cacheable 503 and recovery instructions; Downloads also links directly to GitHub. No URL from the visitor is fetched. Public downloads neither require a campaign nor access campaign state. This endpoint uses outbound GitHub access on the deployed Worker.

`src/lib/website/release.json` is the reviewed release manifest. When publishing a newer permanent-signed APK, verify the asset first, update version/date/filename/URLs/checksum together, update release notes and version-code copy, and deploy the site. Do not point at an unreleased Android version merely because the web app version changed. The existing Android release/signing workflow is unchanged.

PC access currently uses the browser app. Native Windows/macOS installers, a publishing dashboard, content packs, analytics, and a forum are outside this change. The separately released account library is preserved, with navigation and backup guidance integrated into these pages. No domain purchase or DNS migration is performed. Keep the current browser origin for existing saves; a future custom domain needs an explicit backup/migration flow.

Verification: typecheck, web/mobile builds, existing full suite plus download failure/integrity/header tests. Browser verification checks all public pages at desktop/mobile widths and navigation back to the original application. Never test against real campaign rooms.

## Site redesign (October 2026)

All pages using `Website` (`src/components/website/site.tsx`) share one visual system: dark ink sections alternating with ruled parchment, Cormorant Garamond/Cormorant SC headings and Source Sans 3 body, framed product screenshots (`public/product/*.webp`, captured by `scripts/capture-product-screenshots.mjs`; metadata and alt text in `src/lib/website/product-shots.ts`).

- Header and footer share one order and set of labels: Features · Downloads · Changelog · Help · Resources · Donate | My account | Open the app. "Open the app" is the only label for website links into the application. Below 1100px the header links collapse into a Menu button (aria-expanded, Escape closes); the app link stays visible.
- `/features` (`src/routes/features.index.tsx`) is the public feature tour. In-app screens remain at `/features/$feature` inside the app shell; `/features` is listed with the other public pages so it bypasses the title screen.
- About this app & releases (client, hosted web/backend commit, published Android version and its disclaimers) lives once, in Downloads → Release details and verification (`#release-details`), with the APK checksum. Every page's footer shows `Web <commit> · Android <version> (code N)` linking there; one request per document reads `/assets/release-identity.json` (not available on the development server).
- The Browser or Android comparison lives on Downloads. The changelog interleaves Android and web/backend releases by date with working filters (`aria-pressed`); `#android-releases`, `#web-backend` and `#android-<version>` links select the matching filter.
- Resources lists credits first; engineering and design references (`kind: "reference"` in `src/lib/website/resources.ts`) sit in a collapsed Technical references section.
- Layouts are checked at 320, 390, 768 and 1280px by `scripts/website-browser-audit.mjs` (no horizontal page scroll; wide tables scroll inside their own region).

## Validation recorded for this implementation
- 355 tests passed; four existing legacy-document tests skipped.
- TypeScript, Cloudflare build and bundled mobile build passed.
- Development and production-output browser checks passed for four public pages at 1280px and 390px, including download details, help links and navigation back to Party in the app.
- No app runtime errors or same-origin failed resources. The sandbox blocked the pre-existing external Grok extension script; it is retained unchanged. Explicit-root brand asset verification passed.
- Live deployment and a real download through the deployed endpoint remain pending: automatic approval review rejected the GitHub push for lack of explicit repository publishing authorization. No publishing workaround was attempted.
