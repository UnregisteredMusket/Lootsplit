import { isRoomViewOnly } from "../src/lib/quire/room-access.ts";
import { accountShortcuts } from "./account-shortcuts.mjs";
import { accountRequestOrigin } from "../src/lib/deployment/origins.mjs";
import { ownerTestMode } from "./test-mode.mjs";
import { campaignRecords } from "./campaign-records.mjs";
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
import {
  assertActive,
  touchMember,
  profileOf,
  saveProfile,
  directory,
  moderation,
  memberDetail,
} from "./members.mjs";
import { campaignAction, resumeCampaignMembership } from "./account-campaigns.mjs";
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

const nativeOrigins = ["https://localhost", "http://localhost", "capacitor://localhost"];
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
    appName: "Lootsplit",
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
async function rateLimit(env, request) {
  const key = await digest(request.headers.get("cf-connecting-ip") || "local");
  const window = Math.floor(Date.now() / 60000);
  const row = await env.DB.prepare(
    "INSERT INTO library_limits (key, window, hits) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window=excluded.window, hits=CASE WHEN library_limits.window=excluded.window THEN library_limits.hits+1 ELSE 1 END RETURNING hits",
  )
    .bind(key, window)
    .first();
  if (row.hits > 60) fail("Too many account requests. Wait a minute and try again.", 429);
}
async function roomSeat(db, code, token) {
  const row = await db.prepare("SELECT body FROM campaign_rooms WHERE code = ?").bind(code).first();
  const room = row ? JSON.parse(row.body) : null;
  const seat = room?.seats.find((s) => s.token === token);
  if (!seat || room.closed)
    fail("This campaign membership is no longer available. Ask the DM for a new invitation.", 403);
  return { room, seat };
}

export async function handleAccounts(request, env) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/account/")) return null;
  let authOrigin;
  try { authOrigin = accountRequestOrigin(env, request.url); }
  catch { return json({ error: "Account request host is not approved." }, 403); }
  const origin = request.headers.get("origin");
  const native = nativeOrigins.includes(origin);
  const allowed = !origin || origin === authOrigin || native;
  if (!allowed) return json({ error: "Origin not allowed." }, 403);
  const cors = (response) => {
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    headers.set("vary", "Origin");
    if (native) {
      headers.set("access-control-allow-origin", origin);
      headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
      headers.set("access-control-allow-headers", "content-type, authorization");
      headers.set("access-control-expose-headers", "set-auth-token");
    }
    return new Response(response.body, { status: response.status, headers });
  };
  try {
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    const auth = accountAuth({ ...env, ACCOUNT_ORIGIN: authOrigin });
    if (!["GET", "POST"].includes(request.method)) fail("Method not allowed.", 405);
    if (request.method === "POST") {
      if (!origin) fail("An origin is required.", 403);
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        fail("JSON is required.", 415);
      await rateLimit(env, request);
    }
    if (path.startsWith("/api/account/auth/")) {
      if (request.method === "POST") {
        const body = await readBody(request, 16_000);
        request = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: JSON.stringify(body),
        });
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
    if (path === "/api/account/site-donations" && request.method === "GET")
      return cors(json(await publicDonations(db)));
    if (path === "/api/account/site-analytics" && request.method === "GET")
      return cors(json(await publicAnalytics(db)));
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) fail("Sign in to open your account library.", 401);
    const userId = session.user.id;
    await assertActive(db, userId);
    await touchMember(db, userId);
    if (path === "/api/account/shortcuts" && ["GET","POST"].includes(request.method)) return cors(json(await accountShortcuts(db,userId,request.method,request.method === "GET" ? {role:new URL(request.url).searchParams.get("role")} : body)));
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
      return cors(json(await updateBugReport(db, userId, body)));
    if (path === "/api/account/monitor" && request.method === "GET")
      return cors(json(await serverMonitor(env, userId)));
    if (path === "/api/account/profile" && request.method === "POST")
      return cors(json(await saveProfile(db, userId, body)));
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
      return cors(json(await moderation(db, userId, body)));
    }
    if (path === "/api/account/campaign" && request.method === "POST")
      return cors(json(await campaignAction(db, userId, body)));
    if (path === "/api/account/owner/donations" && request.method === "POST")
      return cors(json(await saveDonations(db, userId, body)));
    if (path === "/api/account/owner/analytics" && request.method === "GET")
      return cors(json(await ownerAnalytics(db, userId)));
    if (path === "/api/account/owner" && request.method === "GET")
      return cors(json(await ownerOverview(db, userId)));
    if (path === "/api/account/owner/announcement" && request.method === "POST")
      return cors(json(await saveAnnouncement(db, userId, body)));
    if (path === "/api/account/owner/test-mode" && request.method === "POST") return cors(json(await ownerTestMode(db,userId,body)));
    if (path === "/api/account/records" && request.method === "GET") return cors(json(await campaignRecords(db, userId)));
    if (path === "/api/account/library" && request.method === "GET") {
      const [members, backups, characters, recovery] = await Promise.all([
        db
          .prepare(
            "SELECT m.code,m.seat_id,m.name,m.archived,m.updated_at,r.body AS room_body,r.revision AS room_revision,m.token FROM library_members m LEFT JOIN campaign_rooms r ON r.code=m.code WHERE m.user_id=? ORDER BY m.updated_at DESC",
          )
          .bind(userId)
          .all(),
        db
          .prepare(
            "SELECT id, name, created_at FROM library_backups WHERE user_id=? ORDER BY created_at DESC",
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
          members: members.results.map(({ room_body, token, ...m }) => {
            const room = room_body ? JSON.parse(room_body) : null;
            const seat = room?.seats.find((s) => s.id === m.seat_id && s.token === token);
            return {
              ...m,
              role: seat && (!room.closed || isRoomViewOnly(room) || seat.role === "dm") ? seat.role : null,
              closed: room?.closed === true,
              viewOnly: isRoomViewOnly(room),
            };
          }),
          backups: backups.results,
          characters: characters.results.map((r) => ({ id: r.id, ...JSON.parse(r.body) })),
          hasRecoveryKey: !!recovery,
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
      const code = text(body.code, 16).toUpperCase(),
        token = text(body.token, 128);
      const { room, seat } = await roomSeat(db, code, token);
      if ((room.ownerId && seat.role === "dm" && room.ownerId !== userId) || (seat.userId && seat.userId !== userId)) fail("This seat belongs to another account.", 409);
      const owner = await db
        .prepare("SELECT user_id FROM library_members WHERE code=? AND seat_id=?")
        .bind(code, seat.id)
        .first();
      if (owner && owner.user_id !== userId) fail("This seat is linked to another account.", 409);
      const prior = JSON.stringify(room);
      seat.userId = userId;
      if (seat.role === "dm") room.ownerId = userId;
      const updated = await db.batch([
        db.prepare("UPDATE campaign_rooms SET body=? WHERE code=? AND body=?").bind(JSON.stringify(room), code, prior),
        db.prepare("INSERT INTO library_members (user_id,code,seat_id,token,name,archived,updated_at) SELECT ?,?,?,?,?,0,? WHERE EXISTS (SELECT 1 FROM campaign_rooms WHERE code=? AND body=?) ON CONFLICT(user_id,code) DO UPDATE SET seat_id=excluded.seat_id,token=excluded.token,name=excluded.name,archived=0,updated_at=excluded.updated_at").bind(userId, code, seat.id, token, text(body.name), Date.now(), code, JSON.stringify(room))
      ]);
      if (!updated[0].meta.changes) fail("The campaign changed. Retry saving this membership.", 409);
      return cors(json({ ok: true }));
    }
    if (path === "/api/account/resume" && request.method === "POST") {
      return cors(
        json(await resumeCampaignMembership(db, userId, {
          ...body,
          code: text(body.code, 16).toUpperCase(),
        })),
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
      const id = crypto.randomUUID();
      await db
        .prepare("INSERT INTO library_backups (id,user_id,name,body,created_at) VALUES (?,?,?,?,?)")
        .bind(id, userId, text(body.name), JSON.stringify(payload), Date.now())
        .run();
      return cors(json({ id }));
    }
    if (path === "/api/account/read-backup" && request.method === "POST") {
      const row = await db
        .prepare("SELECT body FROM library_backups WHERE id=? AND user_id=?")
        .bind(text(body.id), userId)
        .first();
      if (!row) fail("Backup not found.", 404);
      return cors(json({ payload: JSON.parse(row.body) }));
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
      await db
        .prepare(
          "INSERT INTO library_characters (id,user_id,body,updated_at) VALUES (?,?,?,?) ON CONFLICT(id,user_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at",
        )
        .bind(id, userId, JSON.stringify(profile), Date.now())
        .run();
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
        },
        error.status || 500,
      ),
    );
  }
}
