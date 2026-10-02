# Site owner controls

An existing account can receive the `owner` role through a trusted D1 administrator after migration 0004 has run. No public endpoint can grant this role. Use a bound immutable user ID, confirm the intended account matches, and insert its role into `site_roles`. Never commit a real user ID, email, credential, or session. Revoke by deleting that user's role row; authorization checks run on every privileged request.

My account shows Owner controls: aggregate usage counts, a publishable homepage announcement, and an external HTTPS donation page URL. Blank donation URLs close donations. Announcement and donation edits use independent revisions to reject stale writes, and successful edits leave an audit record. Owner status grants no access to another account's private backups or campaign seats.

Resources uses `src/lib/website/resources.ts`. Add the original source and applicable licenses for each future integrated resource, and retain item-level source credits. Donation links must be the owner's chosen payment destination. Lootsplit stores no payment details and promises no donor benefits.

Verification: account API tests cover member denial, origin checks, conflict handling, audit counts, invalid donation URLs, public responses, and immediate role revocation. The local-only owner browser audit creates a disposable user, grants through the development DB, exercises both forms and public pages, then removes its role and user. Never run that fixture against production.
