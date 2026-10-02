# Site owner controls

An existing account can receive the `owner` role through a trusted D1 administrator after migration 0004 has run. No public endpoint can grant this role. Use a bound immutable user ID, confirm the intended account matches, and insert its role into `site_roles`. Never commit a real user ID, email, credential, or session. Revoke by deleting that user's role row; authorization checks run on every privileged request.

My account shows Owner controls: aggregate usage counts, a publishable homepage announcement, and an external HTTPS donation page URL. Blank donation URLs close donations. Announcement and donation edits use independent revisions to reject stale writes, and successful edits leave an audit record. Owner status grants no access to another account's private backups or campaign seats.

Resources uses `src/lib/website/resources.ts`. Add the original source and applicable licenses for each future integrated resource, and retain item-level source credits. Donation links must be the owner's chosen payment destination. Lootsplit stores no payment details and promises no donor benefits.

Verification: account API tests cover member denial, origin checks, conflict handling, audit counts, invalid donation URLs, public responses, and immediate role revocation. The local-only owner browser audit creates a disposable user, grants through the development DB, exercises both forms and public pages, then removes its role and user. Never run that fixture against production.

## Member management

Migration 0005 preserves existing owner grants while adding admin/moderator roles, account status, profiles, and a separate moderation audit trail. Only an owner may assign staff roles; ownership cannot be edited through this UI. Owners cannot moderate themselves, admins can moderate ordinary members only, and moderators have a 30-day suspension limit and cannot revoke accounts, permanently ban, restore access or change roles. Staff actions require a reason and current target revision. Role changes require a sign-in within ten minutes.

Revocation preserves the account and its data. Bans end all sessions and clear linked push subscriptions; permanent bans have no expiry. Temporary bans expire automatically, after which the member must sign in again. Linked room tokens are checked independently so they cannot bypass account restrictions. Guest play stays supported, so these are account bans, not claims of device/IP-wide exclusion.

Profiles and last-online timestamps are available to the member and staff. Last Online is approximate visible signed-in activity, updated at most once a minute and periodically while browsing. Dates before rollout have no fabricated activity. Ordinary moderators do not receive registration email addresses; messaging email is available to them only when the member explicitly enables it. Profile changes use optimistic revisions. Email opt-in is stored but no broadcast/delivery provider is configured and no email is sent.

Shared deletion requires the linked DM, exact code confirmation, current room revision and no staged turns. A private backup retains the DM-visible saved state before the shared room and its memberships/subscriptions are deleted. Private player-to-player messages are excluded from that backup; device-local PDFs, catalogs, and copies stay on their devices. Local campaign deletion uses the existing confirmed device workflow.

## Notifications

The shipped Android APK has no Capacitor native push plugin or Firebase configuration, and its background push toggle explicitly remains disabled. Website Web Push exists separately. Native Android push requires Firebase Cloud Messaging integration, device token registration and secure server delivery, permission requests on Android 13+, a signed APK update, and actual-device testing. Email announcements require a verified sending domain/service, verified subscribers, unsubscribe handling and delivery/bounce controls before enabling sends. Registration email is not automatic mailing-list consent.

## Server monitoring

Owners and administrators can open **My account → Server monitoring**. Members and
moderators cannot access either the panel or `GET /api/account/monitor`; every refresh
checks the signed-in account's current access and role. Responses are `no-store`.

The read-only snapshot checks D1 aggregate queries and a fixed bundled SVG through the
ASSETS binding, with a five-second timeout per check. It shows server-side check duration,
account check-ins over 5 minutes / 24 hours, stored campaign/library totals, distinct web
push endpoints, moderation action count, notification configuration, and Worker version
metadata. It returns no emails, user IDs, session tokens, room contents, push keys or
subscription URLs. Activity includes the viewing administrator and is approximate.

Auto-refresh runs every 30 seconds only while the panel is open and the page is visible.
It can be paused, supports manual refresh, labels snapshots stale after 60 seconds, and
clears results on request failure or loss of access. Database check failure suppresses
usage totals; asset failure does not hide otherwise available database totals. The
client stops a stalled request after 12 seconds. Closing the panel cancels its request.

This is on-demand diagnostics, not an external uptime monitor or persistent request/error
history. If authentication/D1 is down entirely, the panel cannot authenticate and displays
unavailable. It does not measure CPU, RAM, billing, delivery success, guest presence or
end-to-end multiplayer health. No campaign writes or external monitoring service are added.
Email sending and Android native push remain unconfigured; existing browser push is retained.
