# Lootsplit preservation contract

After a timeout, network failure or interrupted task, read `docs/RECOVERY.md` first. Reconcile the working tree, GitHub runs and live release before retrying any write. Use `npm run recover:status`; checkpoint and push finished work in small commits. A chat timeout does not establish that the external operation failed. Preserve all release gates and report email configuration honestly.

The user requires preservation of every existing feature, UI capability, saved campaign, permission and supported platform. Do not remove, disable, hide, or replace a feature with a reduced version without the user's explicit approval. Full implementation permission is not removal permission.

Use docs/FEATURE-INVENTORY.md and docs/REDESIGN.md as the preservation baseline. For every change identify affected capabilities, keep old saves and backups readable, and verify related authorization and financial behavior. Add new features to the inventory. Never test destructive actions against real user campaigns or rooms.

The production application uses Cloudflare Workers/D1, not the original template's Vercel/Grok deployment. Develop the shared web client first; retain Android compatibility and the permanent signing certificate. Main is the canonical release source. Increment Android versionCode for each distributed update. Never generate or commit a signing key or passwords.

Every Android update must include a versioned website changelog describing added features, improvements, and summarized bug fixes. Add its entry to src/lib/website/changelog.json before release; explicitly say when a category has no changes. Preserve earlier entries. After verifying the signed APK, update src/lib/website/release.json and deploy the website so its download and changelog match. An Android publication is not complete until both are live and verified.

Keep local, turn-based, live and manual sharing available. Private PDFs stay device-local. Do not silently truncate history, expire/delete rooms or campaigns, or introduce account registration/Google Drive without a user request.

Credit every newly integrated third-party content, data, art, or reference resource in src/lib/website/resources.ts (the Resources page), including its original source and applicable license. Keep existing per-entry attributions intact. Donation destinations are owner-configured HTTPS links; never invent a payment destination or promise donor benefits.

Internal navigation must use TanStack Link or the shared AppLink, including menu-generated destinations, query strings and hashes. Plain anchors are reserved for external URLs, hash-only scrolling, and download/API endpoints. The title screen is once per running document: internal navigation must never restart it; a fresh app document still shows it. Navigation regression audits must click real links and assert the title stays absent without using helpers that dismiss it automatically.
