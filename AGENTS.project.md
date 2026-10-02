# Lootsplit preservation contract

The user requires preservation of every existing feature, UI capability, saved campaign, permission and supported platform. Do not remove, disable, hide, or replace a feature with a reduced version without the user's explicit approval. Full implementation permission is not removal permission.

Use docs/FEATURE-INVENTORY.md and docs/REDESIGN.md as the preservation baseline. For every change identify affected capabilities, keep old saves and backups readable, and verify related authorization and financial behavior. Add new features to the inventory. Never test destructive actions against real user campaigns or rooms.

The production application uses Cloudflare Workers/D1, not the original template's Vercel/Grok deployment. Develop the shared web client first; retain Android compatibility and the permanent signing certificate. Main is the canonical release source. Increment Android versionCode for each distributed update. Never generate or commit a signing key or passwords.

Keep local, turn-based, live and manual sharing available. Private PDFs stay device-local. Do not silently truncate history, expire/delete rooms or campaigns, or introduce account registration/Google Drive without a user request.

Credit every newly integrated third-party content, data, art, or reference resource in src/lib/website/resources.ts (the Resources page), including its original source and applicable license. Keep existing per-entry attributions intact. Donation destinations are owner-configured HTTPS links; never invent a payment destination or promise donor benefits.
