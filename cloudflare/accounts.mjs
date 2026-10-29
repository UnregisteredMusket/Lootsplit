import { ACCOUNT_BACKUP_BYTES, accountBackupBytesSql, readBackupPayload } from "./backup-parts.mjs";
import {
  backupBytesSql,
  backupCampaignKeySql,
  CAMPAIGN_BACKUP_LIMIT,
  campaignGuardArgs,
  campaignGuardSql,
  planBackupRotation,
  replaceStatement,
} from "./backup-rotation.mjs";
import { campaignBackupKey } from "../src/lib/account/campaign-backups.ts";
import { accountShortcuts } from "./account-shortcuts.mjs";
import { accountRequestOrigin } from "../src/lib/deployment/origins.mjs";
import { ownerTestMode } from "./test-mode.mjs";
import { campaignRecords } from "./campaign-records.mjs";
import { accountMapAsset, validateBackupMapAssets } from "./account-map-assets.mjs";
import { libraryMemberRoom } from "./library-member-room.mjs";
import {
  readStoredRoom,
  roomCoreColumnsSql,
  roomCoreFromRow,
  roomVersionSql,
  roomWriteStatements,
} from "./room-storage.mjs";
import { CURRENT_TABLETOP_PROTOCOL, FOLLOW_VIEW_PROTOCOL, hasFollowView, GROUP_COMMANDS_PROTOCOL, hasPartyFormation, FOOTPRINT_PROTOCOL, GRID_MODE_PROTOCOL, PLAYER_MOVEMENT_PROTOCOL, hasFootprintTokens, hasHiddenGrids, hasMovementSettings, hasJourneys, hasMapScales, hasNpcServices, hasPartyGroups, hasPlacementStyles, hasWave2Services, tableForProtocol } from "../src/lib/quire/tabletop-protocol.ts";

/** Tabletop protocol the account client declared: 0 (none) to 9 (current; 4 adds nothing here,
 * 5 adds placement pin styles, 6 map scale bars, 7 journeys, 8 NPC service lists, 9 services
 * wave 2, 10 split-the-party groups). */
const tabletopHeader = (request) => {
  const value = Number(request.headers.get("x-lootsplit-tabletop"));
  return Number.isInteger(value) && value >= 0 ? Math.min(value, 10) : 0;
};
import { publicAnalytics, ownerAnalytics } from "./game-analytics.mjs";
import { handleEncounters } from "./encounters.mjs";
import { handleCharacterPlay } from "./character-play.mjs";
import {
  createBugReport,
  listBugReports,
  bugReportDetail,
  updateBugReport,
} from "./bug-reports.mjs";
import { serverMonitor } from "./monitoring.mjs";
import { ownerMonitor } from "./owner-monitor.mjs";
import { monitorApi } from "./monitor-journal.mjs";
import { throttledSignin } from "./signin-throttle.mjs";
import { captchaConfig, verifyCaptcha } from "./turnstile.mjs";
import {
  assertActive,
  touchMember,
  profileOf,
  saveProfile,
  saveAuthProfile,
  displayName,
  directory,
  moderation,
  memberDetail,
} from "./members.mjs";
import { campaignAction, resumeCampaignMembership } from "./account-campaigns.mjs";
import {
  assertCanHost,
  hostedCampaignGuardArgs,
  hostedCampaignGuardSql,
  hostedCampaignLimit,
  hostedCampaignStatus,
} from "./hosted-campaigns.mjs";
import {
  communityDirectory,
  communityPortrait,
  communityProfile,
  communityReports,
  moderateCommunityProfile,
  ownCommunityProfile,
  reportCommunityProfile,
  saveCommunityProfile,
} from "./community.mjs";
import { restoreDeletedCampaign, campaignRecoveryRecords } from "./campaign-recovery.mjs";
import {
  siteRole,
  publicAnnouncement,
  ownerOverview,
  saveAnnouncement,
  publicDonations,
  saveDonations,
} from "./site-owner.mjs";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { hashPassword } from "better-auth/crypto";
import { APIError } from "better-auth/api";

const nativeOrigins = ["https://localhost", "http://localhost", "capacitor://localhost"];
// Per-account cloud library bounds. Sign-up is open, so without these one account could fill the
// shared D1 database that every campaign uses. Set well above real usage on 2026-10-21
// (largest account: 2 backups, 5.4 MB). Device backups remain unlimited.
export const LIBRARY_LIMITS = Object.freeze({
  backups: 20,
  backupBytes: ACCOUNT_BACKUP_BYTES,
  characters: 100,
  characterBytes: 30_000_000,
});
const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const text = (value, max = 80) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= max
    ? value.trim()
    : fail("Please check the required fields.");
const digest = async (value) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const recoveryKey = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export function accountAuth(env) {
  if (!env.DB || !env.ACCOUNT_SECRET || !env.ACCOUNT_ORIGIN)
    fail("Accounts are not configured on this server yet. Guest play is still available.", 503);
  return betterAuth({
    appName: "Lootsplitter",
    baseURL: env.ACCOUNT_ORIGIN,
    basePath: "/api/account/auth",
    secret: env.ACCOUNT_SECRET,
    database: env.DB,
    trustedOrigins: [env.ACCOUNT_ORIGIN, ...nativeOrigins],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    account: { accountLinking: { enabled: false } },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    advanced: { cookiePrefix: "lootsplit", ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 40 },
    plugins: [bearer({ requireSignature: true })],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            try {
              return { data: { ...user, name: displayName(user.name) } };
            } catch (error) {
              throw new APIError("BAD_REQUEST", { message: error.message });
            }
          },
        },
        update: {
          before: async (user) => {
            if (user.name === undefined) return { data: user };
            try {
              return { data: { ...user, name: displayName(user.name) } };
            } catch (error) {
              throw new APIError("BAD_REQUEST", { message: error.message });
            }
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            await assertActive(env.DB, session.userId, true);
            return { data: session };
          },
        },
      },
    },
  });
}

async function readBody(request, limit = 4_000_000) {
  const reader = request.body?.getReader();
  if (!reader) fail("Missing request body.");
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      fail("This file is too large. Keep using a device backup for files above 4 MB.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail("Invalid request.");
  }
}
/**
 * Account API request allowances per minute (audit 2026-10-28 F4). Anonymous and credential
 * requests (sign-in, sign-up, recovery, any request without a valid session) count per IP, so
 * brute-force protection is unchanged. Signed-in requests count per account instead, because
 * players at one table share the household's IP and a DM's encounter views alone poll about
 * 30 times a minute; a separate, much larger per-IP ceiling for signed-in traffic still bounds
 * many accounts flooding from one address, and never touches the anonymous allowance.
 */
export const ACCOUNT_RATE_LIMITS = Object.freeze({
  anonymousPerIp: 60,
  perAccount: 240,
  signedInPerIp: 1500,
});
const limitHit = (db, key, window) =>
  db
    .prepare(
      "INSERT INTO library_limits (key, window, hits) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window=excluded.window, hits=CASE WHEN library_limits.window=excluded.window THEN library_limits.hits+1 ELSE 1 END RETURNING hits",
    )
    .bind(key, window);
const tooMany = () => fail("Too many account requests. Wait a minute and try again.", 429);
/** Paths that take credentials or create accounts: always limited per IP, session or not. */
const credentialPath = (path) =>
  path === "/api/account/recover" ||
  (path.startsWith("/api/account/auth/") && path !== "/api/account/auth/update-user");
async function rateLimit(env, request, userId = null) {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const window = Math.floor(Date.now() / 60000);
  if (!userId) {
    // Same key as before this change, so a deploy does not reset a running window.
    const row = await limitHit(env.DB, await digest(ip), window).first();
    if (row.hits > ACCOUNT_RATE_LIMITS.anonymousPerIp) tooMany();
    return;
  }
  const [account, household] = await Promise.all([
    limitHit(env.DB, `account:${await digest(userId)}`, window).first(),
    limitHit(env.DB, `signed-in-ip:${await digest(ip)}`, window).first(),
  ]);
  if (
    account.hits > ACCOUNT_RATE_LIMITS.perAccount ||
    household.hits > ACCOUNT_RATE_LIMITS.signedInPerIp
  )
    tooMany();
}
async function roomSeat(db, code, token) {
  const stored = await readStoredRoom(db, code);
  const room = stored ? stored.room : null;
  const seat = room?.seats.find((s) => s.token === token);
  if (!seat || room.closed)
    fail("This campaign membership is no longer available. Ask the DM for a new invitation.", 403);
  return { room, seat, version: stored.version };
}

/**
 * Links a campaign seat to the signed-in account. A room write bumps the revision so
 * pollers see it and a request that loaded the room earlier cannot overwrite it.
 */
export async function linkAccountSeat(db, userId, body, limit = hostedCampaignLimit()) {
  const code = text(body.code, 16).toUpperCase(),
    token = text(body.token, 128);
  const { room, seat, version } = await roomSeat(db, code, token);
  if (
    (room.ownerId && seat.role === "dm" && room.ownerId !== userId) ||
    (seat.userId && seat.userId !== userId)
  )
    fail("This seat belongs to another account.", 409);
  const owner = await db
    .prepare("SELECT user_id FROM library_members WHERE code=? AND seat_id=?")
    .bind(code, seat.id)
    .first();
  if (owner && owner.user_id !== userId) fail("This seat is linked to another account.", 409);
  const changes = seat.userId !== userId || (seat.role === "dm" && room.ownerId !== userId);
  // Taking ownership of an unowned live room (a guest-era DM seat) makes this account its host.
  const hosting = seat.role === "dm" && room.ownerId !== userId;
  if (hosting) await assertCanHost(db, userId, "link", limit);
  const statements = [];
  let write = null;
  if (changes) {
    seat.userId = userId;
    if (seat.role === "dm") room.ownerId = userId;
    // Same conditional write as character-play: the version guard detects a concurrent
    // change, and the revision bump invalidates revision-only CAS writers (updateRoom) and
    // tells knownRevision pollers that the room changed.
    room.revision = (Number.isSafeInteger(room.revision) ? room.revision : 0) + 1;
    write = roomWriteStatements(db, room, {
      expect: version,
      ...(hosting
        ? { extraWhere: hostedCampaignGuardSql, extraArgs: hostedCampaignGuardArgs(userId, limit) }
        : {}),
    });
    statements.push(...write.statements);
  }
  // An already linked seat leaves the room untouched (no revision bump); the membership
  // row is still refreshed, and only while the room is exactly as read (or as just written).
  const current = write ? write.committed : roomVersionSql(version);
  statements.push(
    db
      .prepare(
        `INSERT INTO library_members (user_id,code,seat_id,token,name,archived,updated_at) SELECT ?,?,?,?,?,0,? WHERE ${current.sql} ON CONFLICT(user_id,code) DO UPDATE SET seat_id=excluded.seat_id,token=excluded.token,name=excluded.name,archived=0,updated_at=excluded.updated_at`,
      )
      .bind(userId, code, seat.id, token, text(body.name), Date.now(), ...current.args),
  );
  const updated = await db.batch(statements);
  if (!updated[0].meta.changes) {
    if (hosting) await assertCanHost(db, userId, "link", limit);
    fail("The campaign changed. Retry saving this membership.", 409);
  }
}

export async function handleAccounts(request, env, context = null) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/account/")) return null;
  let authOrigin;
  try {
    authOrigin = accountRequestOrigin(env, request.url);
  } catch {
    return json({ error: "Account request host is not approved." }, 403);
  }
  const origin = request.headers.get("origin");
  const native = nativeOrigins.includes(origin);
  const allowed = !origin || origin === authOrigin || native;
  if (!allowed) return json({ error: "Origin not allowed." }, 403);
  const cors = (response) => {
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    headers.set("vary", "Origin");
    headers.set("x-content-type-options", "nosniff");
    if (native) {
      headers.set("access-control-allow-origin", origin);
      headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
      headers.set(
        "access-control-allow-headers",
        "content-type, authorization, x-lootsplit-tabletop",
      );
      headers.set("access-control-expose-headers", "set-auth-token");
    }
    return new Response(response.body, { status: response.status, headers });
  };
  try {
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    const auth = accountAuth({ ...env, ACCOUNT_ORIGIN: authOrigin });
    // Resolved at most once per request and shared by the rate limit and the handlers below.
    let sessionLookup = null;
    const getSession = () => (sessionLookup ??= auth.api.getSession({ headers: request.headers }));
    if (!["GET", "POST"].includes(request.method)) fail("Method not allowed.", 405);
    if (request.method === "POST") {
      if (!origin) fail("An origin is required.", 403);
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        fail("JSON is required.", 415);
      const limitedUser = credentialPath(path)
        ? null
        : ((await getSession().catch(() => null))?.user?.id ?? null);
      await rateLimit(env, request, limitedUser);
      // Turnstile on sign-up, sign-in and recovery-key reset (website only; see turnstile.mjs).
      await verifyCaptcha(env, request, {
        path,
        native,
        hostnames: [new URL(authOrigin).hostname],
      });
    }
    if (path.startsWith("/api/account/auth/")) {
      if (request.method === "POST") {
        const body = await readBody(request, 16_000);
        if (path === "/api/account/auth/update-user") {
          const session = await getSession();
          if (!session) fail("Sign in to edit your profile.", 401);
          await assertActive(env.DB, session.user.id);
          return cors(json(await saveAuthProfile(env.DB, session.user.id, body)));
        }
        request = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: JSON.stringify(body),
        });
        // Per-account throttle on top of the per-IP limits (audit S05).
        if (path === "/api/account/auth/sign-in/email") {
          const signIn = request;
          return cors(await throttledSignin(env.DB, body?.email, () => auth.handler(signIn)));
        }
      }
      return cors(await auth.handler(request));
    }
    const body = request.method === "POST" ? await readBody(request) : {};
    const db = env.DB;
    if (path === "/api/account/recover" && request.method === "POST") {
      const email = text(body.email, 254).toLowerCase();
      const key = text(body.key, 128);
      if (
        typeof body.password !== "string" ||
        body.password.length < 12 ||
        body.password.length > 128
      )
        fail("Use a password with 12–128 characters.");
      const hash = await digest(key);
      const row = await db
        .prepare(
          "SELECT r.user_id FROM library_recovery r JOIN user u ON u.id=r.user_id WHERE u.email=? AND r.key_hash=?",
        )
        .bind(email, hash)
        .first();
      if (!row) fail("The email or recovery key did not match.", 401);
      const nextKey = recoveryKey();
      const password = await hashPassword(body.password);
      // All updates use the old key as a predicate, so concurrent replay cannot reset twice.
      const result = await db.batch([
        db
          .prepare(
            "UPDATE account SET password=?, updatedAt=? WHERE userId=? AND providerId='credential' AND EXISTS (SELECT 1 FROM library_recovery WHERE user_id=? AND key_hash=?)",
          )
          .bind(password, Date.now(), row.user_id, row.user_id, hash),
        db
          .prepare(
            "DELETE FROM session WHERE userId=? AND EXISTS (SELECT 1 FROM library_recovery WHERE user_id=? AND key_hash=?)",
          )
          .bind(row.user_id, row.user_id, hash),
        db
          .prepare("UPDATE library_recovery SET key_hash=? WHERE user_id=? AND key_hash=?")
          .bind(await digest(nextKey), row.user_id, hash),
      ]);
      if (!result[2].meta.changes) fail("This recovery key has already been used.", 409);
      return cors(json({ key: nextKey }));
    }
    if (path === "/api/account/site-announcement" && request.method === "GET") {
      return cors(json(await publicAnnouncement(db)));
    }
    if (path === "/api/account/captcha" && request.method === "GET")
      return cors(json(captchaConfig(env)));
    if (path === "/api/account/site-donations" && request.method === "GET")
      return cors(json(await publicDonations(db)));
    if (path === "/api/account/site-analytics" && request.method === "GET")
      return cors(json(await publicAnalytics(db)));
    // Community profiles: readable without an account; signed-in members also see members-only ones.
    if (path.startsWith("/api/account/community/") && request.method === "GET") {
      const viewerSession = await auth.api.getSession({ headers: request.headers }).catch(() => null);
      let viewer = viewerSession?.user?.id ?? null;
      if (viewer) {
        try {
          await assertActive(db, viewer);
        } catch {
          viewer = null;
        }
      }
      let rest = "";
      try {
        rest = decodeURIComponent(path.slice("/api/account/community/".length));
      } catch {
        fail("No profile with that name is visible to you.", 404);
      }
      if (rest === "directory") return cors(json(await communityDirectory(db, viewer, new URL(request.url))));
      if (rest.startsWith("profile/"))
        return cors(json(await communityProfile(db, viewer, rest.slice(8))));
      if (rest.startsWith("portrait/"))
        return cors(await communityPortrait(db, viewer, rest.slice(9)));
    }
    const session = await getSession();
    if (!session) fail("Sign in to open your account library.", 401);
    const userId = session.user.id;
    await assertActive(db, userId);
    await touchMember(db, userId);
    if (path === "/api/account/shortcuts" && ["GET", "POST"].includes(request.method))
      return cors(
        json(
          await accountShortcuts(
            db,
            userId,
            request.method,
            request.method === "GET"
              ? { role: new URL(request.url).searchParams.get("role") }
              : body,
          ),
        ),
      );
    if (
      (path === "/api/account/encounters" && request.method === "GET") ||
      (path.startsWith("/api/account/encounters/") && request.method === "POST")
    ) {
      const result = await handleEncounters(db, userId, path.slice("/api/account/".length), body);
      if (result !== null) return cors(json(result));
    }
    if (
      (path === "/api/account/sheets" && request.method === "GET") ||
      (path.startsWith("/api/account/sheets/") && request.method === "POST")
    ) {
      const result = await handleCharacterPlay(
        db,
        userId,
        path.slice("/api/account/".length),
        body,
        new URL(request.url),
      );
      if (result !== null) return cors(json(result));
    }
    if (path === "/api/account/reports" && request.method === "GET")
      return cors(json(await listBugReports(db, userId, new URL(request.url))));
    if (path === "/api/account/reports" && request.method === "POST")
      return cors(json(await createBugReport(db, userId, body), 201));
    if (path === "/api/account/reports/detail" && request.method === "POST")
      return cors(json(await bugReportDetail(db, userId, body.id)));
    if (path === "/api/account/reports/update" && request.method === "POST")
      return cors(json(await updateBugReport(db, userId, body, session.session.id)));
    if (path === "/api/account/monitor" && request.method === "GET")
      return cors(json(await serverMonitor(env, userId)));
    if (path === "/api/account/owner/monitor" && request.method === "GET")
      return cors(json(await ownerMonitor(env, userId, session.session.id, request, context)));
    if (path.startsWith("/api/account/owner/monitor/"))
      return cors(json(await monitorApi(env, userId, session.session.id, request, body)));
    if (path === "/api/account/profile" && request.method === "POST")
      return cors(json(await saveProfile(db, userId, body)));
    if (path === "/api/account/community" && request.method === "GET")
      return cors(json(await ownCommunityProfile(db, userId)));
    if (path === "/api/account/community" && request.method === "POST")
      return cors(json(await saveCommunityProfile(db, userId, body)));
    if (path === "/api/account/community-report" && request.method === "POST")
      return cors(json(await reportCommunityProfile(db, userId, body), 201));
    if (path === "/api/account/staff/community-reports" && request.method === "GET")
      return cors(json(await communityReports(db, userId)));
    if (path === "/api/account/staff/community-action" && request.method === "POST")
      return cors(json(await moderateCommunityProfile(db, userId, body, session.session.id)));
    if (path === "/api/account/activity" && request.method === "GET")
      return cors(json({ ok: true }));
    if (path === "/api/account/staff/members" && request.method === "GET")
      return cors(json(await directory(db, userId, new URL(request.url))));
    if (path === "/api/account/staff/member" && request.method === "POST")
      return cors(json(await memberDetail(db, userId, body.id)));
    if (path === "/api/account/staff/action" && request.method === "POST") {
      if (
        body.action === "role" &&
        Date.now() - new Date(session.session.createdAt).getTime() > 600000
      )
        fail("Sign out and sign in again before changing staff roles.", 403);
      return cors(json(await moderation(db, userId, body, session.session.id)));
    }
    if (path === "/api/account/campaign" && request.method === "POST")
      return cors(json(await campaignAction(db, userId, body, session.session)));
    if (path === "/api/account/restore-backup" && request.method === "POST")
      return cors(
        json(
          await restoreDeletedCampaign(db, userId, body, session.session, hostedCampaignLimit(env)),
        ),
      );
    if (path === "/api/account/recovery-records" && request.method === "POST")
      return cors(json(await campaignRecoveryRecords(db, userId, body)));
    if (path === "/api/account/owner/donations" && request.method === "POST")
      return cors(json(await saveDonations(db, userId, body, session.session.id)));
    if (path === "/api/account/owner/analytics" && request.method === "GET")
      return cors(json(await ownerAnalytics(db, userId)));
    if (path === "/api/account/owner" && request.method === "GET")
      return cors(json(await ownerOverview(db, userId)));
    if (path === "/api/account/owner/announcement" && request.method === "POST")
      return cors(json(await saveAnnouncement(db, userId, body, session.session.id)));
    if (path === "/api/account/owner/test-mode" && request.method === "POST")
      return cors(json(await ownerTestMode(db, userId, body, session.session.id)));
    if (path === "/api/account/map-assets" && request.method === "POST")
      return cors(json(await accountMapAsset(db, userId, body)));
    if (path === "/api/account/records" && request.method === "GET") {
      const result = await campaignRecords(db, userId);
      const protocol = tabletopHeader(request);
      if (protocol < CURRENT_TABLETOP_PROTOCOL)
        for (const report of result.reports)
          if (report.snapshot) report.snapshot = tableForProtocol(report.snapshot, protocol);
      return cors(json(result));
    }
    if (path === "/api/account/library" && request.method === "GET") {
      const [members, backups, characters, recovery] = await Promise.all([
        db
          .prepare(
            `SELECT m.code,m.seat_id,m.name,m.archived,m.updated_at,${roomCoreColumnsSql("r")},m.token,EXISTS(SELECT 1 FROM campaign_recoveries c WHERE c.user_id=m.user_id AND c.code=m.code) AS has_recovery FROM library_members m LEFT JOIN campaign_rooms r ON r.code=m.code WHERE m.user_id=? ORDER BY m.updated_at DESC`,
          )
          .bind(userId)
          .all(),
        db
          .prepare(
            `SELECT b.id,b.name,b.created_at,EXISTS(SELECT 1 FROM campaign_deletion_backups d WHERE d.backup_id=b.id AND d.user_id=b.user_id) AS shared_recovery,${backupCampaignKeySql("b")} AS campaign_key FROM library_backups b WHERE b.user_id=? ORDER BY b.created_at DESC`,
          )
          .bind(userId)
          .all(),
        db
          .prepare(
            "SELECT id, body FROM library_characters WHERE user_id=? ORDER BY updated_at DESC",
          )
          .bind(userId)
          .all(),
        db.prepare("SELECT user_id FROM library_recovery WHERE user_id=?").bind(userId).first(),
      ]);
      // Online campaign limit (hosted-campaigns.mjs): shown where a DM hosts; enforced server-side.
      const hosting = await hostedCampaignStatus(db, userId, hostedCampaignLimit(env));
      return cors(
        json({
          user: {
            id: userId,
            name: session.user.name,
            email: session.user.email,
            role: await siteRole(db, userId),
          },
          profile: await profileOf(db, userId),
          notices: (
            await db
              .prepare(
                "SELECT action,reason,created_at FROM moderation_audit WHERE target_id=? AND action='warn' ORDER BY created_at DESC LIMIT 20",
              )
              .bind(userId)
              .all()
          ).results,
          members: members.results.map((row) => {
            const { room_code: _code, room_write_id: _writeId, room_core: _core, token, ...m } = row;
            return { ...m, ...libraryMemberRoom(roomCoreFromRow(row), m, token) };
          }),
          backups: backups.results,
          // Online backups per campaign (backup-rotation.mjs), for the Backups notices.
          backupLimits: { perCampaign: CAMPAIGN_BACKUP_LIMIT },
          characters: characters.results.map((r) => ({ id: r.id, ...JSON.parse(r.body) })),
          hasRecoveryKey: !!recovery,
          hosting,
        }),
      );
    }
    if (path === "/api/account/recovery-key" && request.method === "POST") {
      if (Date.now() - new Date(session.session.createdAt).getTime() > 600000)
        fail("Sign out and sign in again before replacing your recovery key.", 403);
      const key = recoveryKey();
      await db
        .prepare(
          "INSERT INTO library_recovery (user_id,key_hash) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET key_hash=excluded.key_hash",
        )
        .bind(userId, await digest(key))
        .run();
      return cors(json({ key }));
    }
    if (path === "/api/account/link" && request.method === "POST") {
      await linkAccountSeat(db, userId, body, hostedCampaignLimit(env));
      return cors(json({ ok: true }));
    }
    if (path === "/api/account/resume" && request.method === "POST") {
      return cors(
        json(
          await resumeCampaignMembership(
            db,
            userId,
            {
              ...body,
              code: text(body.code, 16).toUpperCase(),
            },
            hostedCampaignLimit(env),
          ),
        ),
      );
    }
    if (path === "/api/account/archive" && request.method === "POST") {
      await db
        .prepare("UPDATE library_members SET archived=? WHERE user_id=? AND code=?")
        .bind(body.archived ? 1 : 0, userId, text(body.code, 16))
        .run();
      return cors(json({ ok: true }));
    }
    if (path === "/api/account/backup" && request.method === "POST") {
      const payload = body.payload;
      if (
        !payload ||
        payload.kind !== "quire" ||
        ![1, 2].includes(payload.version) ||
        !Array.isArray(payload.purses) ||
        !Array.isArray(payload.holdings) ||
        !Array.isArray(payload.ledger) ||
        !Array.isArray(payload.shops) ||
        !Array.isArray(payload.stock)
      )
        fail("Invalid campaign backup.");
      if (payload.books?.length || payload.articles?.length)
        fail("Private PDFs must stay on your device.");
      await validateBackupMapAssets(db, userId, payload);
      const id = crypto.randomUUID();
      const serialized = JSON.stringify(payload);
      // Per-campaign limit (backup-rotation.mjs): the campaign's oldest backup is replaced only
      // when the request confirms that exact backup, after the new one is stored. A backup from an
      // older app has no campaign key and only meets the account limits below.
      const campaignKey = campaignBackupKey(body.campaignKey);
      const plan = await planBackupRotation(db, userId, campaignKey, body.replace);
      const rotating = plan.replace ? 1 : 0;
      // Per-account bound so one account cannot fill the shared database. The checks are part of
      // the INSERT, so concurrent uploads cannot each pass a separate pre-check. A replaced backup
      // no longer counts, because it is removed in the same batch.
      const insert = db
        .prepare(
          `INSERT INTO library_backups (id,user_id,name,body,created_at,campaign_key) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM library_backups WHERE user_id=?)-?<? AND ${accountBackupBytesSql}-${rotating ? backupBytesSql : "0"}+?<=? AND ${campaignGuardSql(campaignKey, plan)}`,
        )
        .bind(
          id,
          userId,
          text(body.name),
          serialized,
          Date.now(),
          campaignKey,
          userId,
          rotating,
          LIBRARY_LIMITS.backups,
          userId,
          userId,
          ...(rotating ? [plan.replace.id, userId, plan.replace.id] : []),
          serialized.length,
          LIBRARY_LIMITS.backupBytes,
          ...campaignGuardArgs(userId, campaignKey, plan),
        );
      const results = await db.batch([
        insert,
        ...(plan.replace
          ? [
              replaceStatement(
                db,
                userId,
                plan,
                "EXISTS(SELECT 1 FROM library_backups WHERE id=? AND user_id=?)",
                [id, userId],
              ),
            ]
          : []),
      ]);
      if (!results[0].meta.changes) {
        // Either the account is full even after rotation, or the campaign's backups changed
        // since the request was made (another device saved or removed one).
        const again = await planBackupRotation(db, userId, campaignKey, body.replace);
        if ((again.replace?.id ?? null) !== (plan.replace?.id ?? null))
          fail(
            "Your online backups changed on another device. Refresh your Library and save again. Your device data has not changed.",
            409,
          );
        fail(
          `Your account backup storage is full (up to ${LIBRARY_LIMITS.backups} backups or ${LIBRARY_LIMITS.backupBytes / 1_000_000} MB). Download and remove an older backup from your Library, then save again. Your device data has not changed.`,
          413,
        );
      }
      return cors(json({ id, replaced: plan.replace?.id ?? null }));
    }
    if (path === "/api/account/read-backup" && request.method === "POST") {
      const row = await db
        .prepare("SELECT body FROM library_backups WHERE id=? AND user_id=?")
        .bind(text(body.id), userId)
        .first();
      if (!row) fail("Backup not found.", 404);
      // A large deletion backup is stored in parts (backup-parts.mjs), read back verified.
      const stored = await readBackupPayload(db, text(body.id), row.body);
      const protocol = tabletopHeader(request);
      // Protocol 2 differs only by compact fog history, which expands losslessly.
      const payload = protocol === 2 ? tableForProtocol(stored, 2) : stored;
      if (
        (protocol < 2 &&
          JSON.stringify(tableForProtocol(stored, protocol)) !== JSON.stringify(stored)) ||
        (protocol < 5 && hasPlacementStyles(stored)) ||
        (protocol < 6 && hasMapScales(stored)) ||
        (protocol < 7 && hasJourneys(stored)) ||
        (protocol < 8 && hasNpcServices(stored)) ||
        (protocol < 9 && hasWave2Services(stored)) ||
        (protocol < 10 && hasPartyGroups(stored)) ||
        (protocol < FOOTPRINT_PROTOCOL && hasFootprintTokens(stored)) ||
        (protocol < GRID_MODE_PROTOCOL && hasHiddenGrids(stored)) ||
        (protocol < PLAYER_MOVEMENT_PROTOCOL && hasMovementSettings(stored)) ||
        (protocol < GROUP_COMMANDS_PROTOCOL && hasPartyFormation(stored)) ||
        (protocol < FOLLOW_VIEW_PROTOCOL && hasFollowView(stored))
      )
        fail(
          "This backup includes detailed tabletop maps. Restore it on the updated website; the complete backup is retained.",
          409,
        );
      return cors(json({ payload }));
    }
    if (path === "/api/account/character" && request.method === "POST") {
      const profile = {
        name: text(body.name),
        description: typeof body.description === "string" ? body.description.slice(0, 2000) : "",
        portrait: "",
      };
      if (body.portrait) {
        if (
          typeof body.portrait !== "string" ||
          body.portrait.length > 500000 ||
          !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(body.portrait)
        )
          fail("Choose a PNG, JPEG or WebP portrait below 350 KB.");
        profile.portrait = body.portrait;
      }
      const id = body.id ? text(body.id) : crypto.randomUUID();
      const serialized = JSON.stringify(profile);
      // Counts and bytes exclude the profile being replaced, so editing never hits the limit
      // unless the edited profile itself makes the account exceed it.
      const saved = await db
        .prepare(
          "INSERT INTO library_characters (id,user_id,body,updated_at) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM library_characters WHERE user_id=? AND id<>?)<? AND (SELECT COALESCE(SUM(LENGTH(body)),0) FROM library_characters WHERE user_id=? AND id<>?)+?<=? ON CONFLICT(id,user_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at",
        )
        .bind(
          id,
          userId,
          serialized,
          Date.now(),
          userId,
          id,
          LIBRARY_LIMITS.characters,
          userId,
          id,
          serialized.length,
          LIBRARY_LIMITS.characterBytes,
        )
        .run();
      if (!saved.meta.changes)
        fail(
          `Your account character storage is full (up to ${LIBRARY_LIMITS.characters} characters or ${LIBRARY_LIMITS.characterBytes / 1_000_000} MB). Remove a character you no longer need, then save again.`,
          413,
        );
      return cors(json({ id }));
    }
    if (path === "/api/account/remove" && request.method === "POST") {
      const table = {
        backup: "library_backups",
        character: "library_characters",
        membership: "library_members",
      }[body.kind];
      if (!table) fail("Unknown library entry.");
      const column = body.kind === "membership" ? "code" : "id";
      await db
        .prepare(`DELETE FROM ${table} WHERE ${column}=? AND user_id=?`)
        .bind(text(body.id), userId)
        .run();
      return cors(json({ ok: true }));
    }
    fail("Not found.", 404);
  } catch (error) {
    return cors(
      json(
        {
          error: error.status
            ? error.message
            : "The account service could not complete this request. Your device data has not been replaced.",
          // The online backup a confirmed save or deletion would replace (backup-rotation.mjs).
          ...(error.status && error.replaces ? { replaces: error.replaces } : {}),
        },
        error.status || 500,
      ),
    );
  }
}
