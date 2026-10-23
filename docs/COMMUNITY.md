# Community profiles and Find a group

Owner decisions, 2026-10-23: profiles **yes**; an on-site Looking for Group **directory** with the chatting on a **Discord server** instead of an on-site forum; **each member chooses** who sees their profile; fields are DM / player / both, games and time zone, Discord handle and a looking-for-group flag.

## What members get

- **My account → Community profile** (`src/components/account/community-controls.tsx`). Visibility: **Nobody** (default for every existing and new account), **Signed-in Lootsplitter members**, or **Everyone, including search engines**. A handle is required to show a profile and becomes its address, `/community/<handle>` (3–30 letters, digits, `-`, `_`; lowercase; unique; a few system words reserved). Fields: I play as (DM / player / both), looking for (players / a group), a 280-character note, up to 8 games (free text with suggestions), IANA time zone, usual play times, optional Discord username.
- The profile also shows the display name, picture and introduction from the existing member profile. **Email addresses (sign-in or messaging) are never part of a community profile**; contact happens on Discord.
- **Find a group** (`/community`, header and footer): filters by role (a "both" member matches DM and player), looking for, game, time zone and name; paged 24 at a time, members who are looking first. Signed-out visitors see only public profiles; signed-in members also see members-only ones.
- **Profile page** (`/community/<handle>`): badges, note, introduction, table details, the member's current local time, a copy button for the Discord username, and **Report this profile** for signed-in members. A profile the viewer may not see gives the same "not found" answer as a handle that does not exist. Profile pages send `noindex`; only `/community` is in the sitemap.
- The Lootsplitter Discord link appears on both pages once `DISCORD_INVITE` (`src/lib/website/contact.ts`) is set.

## Safety and moderation

- Banned or revoked accounts and staff-hidden profiles are never listed or shown (to anyone but their owner).
- Reports: signed-in members only, not their own profile, at most 5 per reporter per 24 h (`community_reports`).
- Staff (owner, admin, moderator) see **Community profile reports** in My account and can **Hide profile**, **Show profile again** or **Dismiss reports**. Each action resolves the open reports and writes a `community-hide` / `community-show` / `community-dismiss` entry to `moderation_audit`, behind the same live staff-session guard as other staff actions. The member sees a notice that staff hid their profile.

## Data and API

- Migration `0021_community_profiles.sql` (additive): new `member_profiles` columns `visibility`, `handle` (unique index), `play_role`, `games` (JSON array), `time_zone`, `play_times`, `discord`, `lfg`, `lfg_note`, `community_hidden`, `community_changed_at`; table `community_reports`.
- Server: `cloudflare/community.mjs`, routed in `cloudflare/accounts.mjs`.
  - Public (optional session): `GET /api/account/community/directory`, `/community/profile/<handle>`, `/community/portrait/<handle>` (portraits are served separately so listings stay small).
  - Signed in: `GET`/`POST /api/account/community` (revision-checked with the member profile), `POST /api/account/community-report`.
  - Staff: `GET /api/account/staff/community-reports`, `POST /api/account/staff/community-action`.
- Tests: `scripts/community-profiles.test.mjs` (validation, visibility, no emails, uniqueness, filters, bans, hide, report limits, portraits, additive migration) and `scripts/community-browser-audit.mjs` (CI `dev-community`).

## Not built (yet)

- No messages between members on the site; no forum.
- The Android app has the account card but the directory is a website page.
