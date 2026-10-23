/**
 * Community profiles and the Looking for Group directory (owner decisions 2026-10-23).
 *
 * - Each member chooses who sees their community profile: nobody ('off', the default),
 *   signed-in members ('members') or everyone including search engines ('public').
 * - Restricted (banned or revoked) accounts and profiles staff have hidden are never listed.
 * - The account email and the private messaging address are never part of a community
 *   profile; members who want to be contacted add a Discord handle.
 * - Portraits are served separately so the directory stays small.
 */
import { roleOf, staffCommitGuard } from "./members.mjs";

const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};

export const VISIBILITIES = ["off", "members", "public"];
export const PLAY_ROLES = ["", "dm", "player", "both"];
export const LFG = ["", "players", "group"];
export const DIRECTORY_PAGE = 24;
export const REPORTS_PER_DAY = 5;
const STAFF = ["owner", "admin", "moderator"];
const RESERVED = new Set([
  "admin",
  "administrator",
  "api",
  "help",
  "lootsplit",
  "lootsplitter",
  "mod",
  "moderator",
  "owner",
  "root",
  "staff",
  "support",
  "system",
]);

/** Lowercase handle of 3–30 letters, digits, "-" or "_", starting and ending with a letter or digit. */
export function normalizeHandle(value) {
  if (typeof value !== "string") fail("Choose a profile handle.");
  const handle = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9_-]{1,28})[a-z0-9]$/.test(handle))
    fail("Use a handle of 3–30 letters, numbers, - or _, starting and ending with a letter or number.");
  if (RESERVED.has(handle)) fail("That handle is reserved. Choose another.");
  return handle;
}

function validTimeZone(zone) {
  if (zone === "") return "";
  if (typeof zone !== "string" || zone.length > 64) fail("Choose a time zone from the list.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    fail("Choose a time zone from the list.");
  }
  return zone;
}

function text(value, max, label) {
  if (typeof value !== "string" || value.length > max) fail(`${label} must be ${max} characters or fewer.`);
  return value.trim();
}

function games(value) {
  if (!Array.isArray(value) || value.length > 8) fail("List up to 8 games.");
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const game = text(raw, 30, "Each game");
    if (!game) continue;
    const key = game.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(game);
  }
  return out;
}

function discord(value) {
  const handle = text(value, 40, "Discord handle");
  if (handle && !/^[^\s@<>:`#]{2,32}(?:#\d{4})?$/.test(handle))
    fail("Enter your Discord username without spaces, for example kobold_dm.");
  return handle;
}

/** Validates a community profile update and returns the stored column values. */
export function communityFields(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("Invalid profile update.");
  if (!VISIBILITIES.includes(body.visibility)) fail("Choose who can see your profile.");
  if (!PLAY_ROLES.includes(body.play_role)) fail("Choose Dungeon Master, player or both.");
  if (!LFG.includes(body.lfg)) fail("Choose what you are looking for.");
  if (!Number.isSafeInteger(body.revision) || body.revision < 0)
    fail("A current profile revision is required.");
  const handle =
    body.handle === "" || body.handle === null || body.handle === undefined
      ? null
      : normalizeHandle(body.handle);
  if (body.visibility !== "off" && !handle) fail("Choose a handle before showing your profile.");
  return {
    visibility: body.visibility,
    handle,
    play_role: body.play_role,
    games: JSON.stringify(games(body.games ?? [])),
    time_zone: validTimeZone(body.time_zone ?? ""),
    play_times: text(body.play_times ?? "", 120, "Usual play times"),
    discord: discord(body.discord ?? ""),
    lfg: body.lfg,
    lfg_note: text(body.lfg_note ?? "", 280, "Looking-for-group note"),
    revision: body.revision,
  };
}

const ACTIVE = `NOT (COALESCE(a.status,'active')='revoked' OR (COALESCE(a.status,'active')='banned' AND (a.ban_until IS NULL OR a.ban_until>?)))`;
const PUBLIC_COLUMNS = `p.handle,u.name,u.createdAt AS member_since,COALESCE(p.introduction,'') AS introduction,
  CASE WHEN COALESCE(p.portrait,'')<>'' THEN 1 ELSE 0 END AS has_portrait,p.revision,
  p.play_role,p.games,p.time_zone,p.play_times,p.discord,p.lfg,p.lfg_note,p.community_changed_at`;

function shape(row) {
  if (!row) return null;
  let list = [];
  try {
    list = JSON.parse(row.games || "[]");
  } catch {
    list = [];
  }
  return {
    handle: row.handle,
    name: row.name,
    member_since: row.member_since,
    introduction: row.introduction,
    portrait: row.has_portrait ? `/api/account/community/portrait/${row.handle}?v=${row.revision}` : "",
    play_role: row.play_role,
    games: Array.isArray(list) ? list : [],
    time_zone: row.time_zone,
    play_times: row.play_times,
    discord: row.discord,
    lfg: row.lfg,
    lfg_note: row.lfg_note,
    updated_at: row.community_changed_at,
  };
}

/** Visibility predicate for a viewer: everyone sees 'public'; signed-in members also see 'members'. */
function visibleTo(viewer) {
  return viewer ? "p.visibility IN ('public','members')" : "p.visibility='public'";
}

/** The member's own community settings (editing form). */
export async function ownCommunityProfile(db, userId) {
  const row = await db
    .prepare(
      `SELECT p.visibility,p.handle,p.play_role,p.games,p.time_zone,p.play_times,p.discord,p.lfg,p.lfg_note,p.community_hidden,COALESCE(p.revision,0) AS revision FROM user u LEFT JOIN member_profiles p ON p.user_id=u.id WHERE u.id=?`,
    )
    .bind(userId)
    .first();
  let list = [];
  try {
    list = JSON.parse(row?.games || "[]");
  } catch {
    list = [];
  }
  return {
    visibility: row?.visibility || "off",
    handle: row?.handle || "",
    play_role: row?.play_role || "",
    games: Array.isArray(list) ? list : [],
    time_zone: row?.time_zone || "",
    play_times: row?.play_times || "",
    discord: row?.discord || "",
    lfg: row?.lfg || "",
    lfg_note: row?.lfg_note || "",
    hidden_by_staff: !!row?.community_hidden,
    revision: row?.revision ?? 0,
  };
}

export async function saveCommunityProfile(db, userId, body) {
  const f = communityFields(body);
  await db.prepare("INSERT OR IGNORE INTO member_profiles(user_id) VALUES (?)").bind(userId).run();
  if (f.handle) {
    const taken = await db
      .prepare("SELECT user_id FROM member_profiles WHERE handle=? AND user_id<>?")
      .bind(f.handle, userId)
      .first();
    if (taken) fail("That handle is taken. Choose another.", 409);
  }
  let result;
  try {
    result = await db
      .prepare(
        "UPDATE member_profiles SET visibility=?,handle=?,play_role=?,games=?,time_zone=?,play_times=?,discord=?,lfg=?,lfg_note=?,community_changed_at=?,revision=revision+1 WHERE user_id=? AND revision=?",
      )
      .bind(
        f.visibility,
        f.handle,
        f.play_role,
        f.games,
        f.time_zone,
        f.play_times,
        f.discord,
        f.lfg,
        f.lfg_note,
        Date.now(),
        userId,
        f.revision,
      )
      .run();
  } catch (error) {
    if (/unique/i.test(String(error?.message))) fail("That handle is taken. Choose another.", 409);
    throw error;
  }
  if (result.meta.changes !== 1) fail("Your profile changed. Reload before saving again.", 409);
  return ownCommunityProfile(db, userId);
}

/** One profile by handle, or 404 when the viewer may not see it (same answer as "no such handle"). */
export async function communityProfile(db, viewer, rawHandle) {
  const handle = typeof rawHandle === "string" ? rawHandle.trim().toLowerCase() : "";
  const notFound = () => fail("No profile with that name is visible to you.", 404);
  if (!/^[a-z0-9_-]{3,30}$/.test(handle)) notFound();
  const own = viewer
    ? await db.prepare("SELECT handle FROM member_profiles WHERE user_id=?").bind(viewer).first()
    : null;
  const self = own?.handle === handle;
  const row = await db
    .prepare(
      `SELECT ${PUBLIC_COLUMNS} FROM member_profiles p JOIN user u ON u.id=p.user_id LEFT JOIN member_access a ON a.user_id=p.user_id
       WHERE p.handle=? AND ${self ? "1=1" : `${visibleTo(viewer)} AND p.community_hidden=0 AND ${ACTIVE}`}`,
    )
    .bind(handle, ...(self ? [] : [Date.now()]))
    .first();
  if (!row) notFound();
  return { profile: shape(row), self, signedIn: !!viewer };
}

/** The Looking for Group directory: filters by role, LFG status, game, time zone and name. */
export async function communityDirectory(db, viewer, url) {
  const params = url.searchParams;
  const role = params.get("role") || "";
  const lfg = params.get("lfg") || "";
  const game = (params.get("game") || "").trim().slice(0, 30);
  const zone = (params.get("tz") || "").trim().slice(0, 64);
  const q = (params.get("q") || "").trim().slice(0, 60);
  const offset = Math.max(0, Math.min(100000, Math.floor(Number(params.get("offset")) || 0)));
  if (role && !["dm", "player"].includes(role)) fail("Unknown role filter.");
  if (lfg && !["players", "group"].includes(lfg)) fail("Unknown looking-for filter.");
  const like = (s) => "%" + s.replace(/[\\%_]/g, "\\$&") + "%";
  const where = [
    "p.handle IS NOT NULL",
    visibleTo(viewer),
    "p.community_hidden=0",
    ACTIVE,
  ];
  const binds = [Date.now()];
  if (role) {
    where.push("p.play_role IN (?, 'both')");
    binds.push(role);
  }
  if (lfg) {
    where.push("p.lfg=?");
    binds.push(lfg);
  }
  if (game) {
    where.push("p.games LIKE ? ESCAPE '\\'");
    binds.push(like(game));
  }
  if (zone) {
    where.push("p.time_zone=?");
    binds.push(zone);
  }
  if (q) {
    where.push("(u.name LIKE ? ESCAPE '\\' OR p.handle LIKE ? ESCAPE '\\')");
    binds.push(like(q), like(q.toLowerCase()));
  }
  const sql = `FROM member_profiles p JOIN user u ON u.id=p.user_id LEFT JOIN member_access a ON a.user_id=p.user_id WHERE ${where.join(" AND ")}`;
  const rows = await db
    .prepare(
      `SELECT ${PUBLIC_COLUMNS} ${sql} ORDER BY CASE WHEN p.lfg<>'' THEN 0 ELSE 1 END, p.community_changed_at DESC, p.handle LIMIT ${DIRECTORY_PAGE} OFFSET ?`,
    )
    .bind(...binds, offset)
    .all();
  const count = await db.prepare(`SELECT COUNT(*) AS n ${sql}`).bind(...binds).first();
  return {
    profiles: rows.results.map(shape),
    total: count?.n ?? 0,
    offset,
    page: DIRECTORY_PAGE,
    signedIn: !!viewer,
  };
}

/** The portrait image for a visible profile, as bytes with its own content type. */
export async function communityPortrait(db, viewer, rawHandle) {
  const { profile } = await communityProfile(db, viewer, rawHandle);
  const row = await db
    .prepare("SELECT portrait FROM member_profiles WHERE handle=?")
    .bind(profile.handle)
    .first();
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(row?.portrait || "");
  if (!match) fail("No portrait.", 404);
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "Content-Type": match[1],
      "X-Content-Type-Options": "nosniff",
      // The account API marks every response no-store, so visibility changes apply at once.
      "Cache-Control": "no-store",
    },
  });
}

/** A signed-in member reports a profile they can see. Limited per reporter per day. */
export async function reportCommunityProfile(db, reporter, body) {
  const reason = text(body?.reason ?? "", 500, "The reason");
  if (reason.length < 3) fail("Tell us briefly what is wrong with this profile.");
  const { profile, self } = await communityProfile(db, reporter, body?.handle);
  if (self) fail("You cannot report your own profile.");
  const recent = await db
    .prepare("SELECT COUNT(*) AS n FROM community_reports WHERE reporter_id=? AND created_at>?")
    .bind(reporter, Date.now() - 86400000)
    .first();
  if ((recent?.n ?? 0) >= REPORTS_PER_DAY)
    fail("You have sent several reports today. Please try again tomorrow.", 429);
  const target = await db
    .prepare("SELECT user_id FROM member_profiles WHERE handle=?")
    .bind(profile.handle)
    .first();
  await db
    .prepare(
      "INSERT INTO community_reports(id,reporter_id,target_id,reason,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(crypto.randomUUID(), reporter, target.user_id, reason, Date.now())
    .run();
  return { reported: true };
}

/** Staff: open reports, newest first, with the profile they concern. */
export async function communityReports(db, actor) {
  if (!STAFF.includes(await roleOf(db, actor))) fail("Staff access is required.", 403);
  const rows = await db
    .prepare(
      `SELECT r.id,r.reason,r.created_at,p.handle,u.name,p.community_hidden,COALESCE(ru.name,'Deleted member') AS reporter
       FROM community_reports r JOIN member_profiles p ON p.user_id=r.target_id JOIN user u ON u.id=r.target_id
       LEFT JOIN user ru ON ru.id=r.reporter_id WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC LIMIT 100`,
    )
    .all();
  return { reports: rows.results };
}

/** Staff: hide or show a community profile and resolve its open reports, with an audit entry. */
export async function moderateCommunityProfile(db, actor, body, sessionId) {
  const handle = typeof body?.handle === "string" ? body.handle.trim().toLowerCase() : "";
  if (!["hide", "show", "dismiss"].includes(body?.action)) fail("Unknown community action.");
  const reason = text(body?.reason ?? "", 500, "The reason");
  if (body.action !== "dismiss" && !reason) fail("Give a short reason; it is recorded in the moderation log.");
  const guard = await staffCommitGuard(db, actor, sessionId, STAFF);
  const target = await db
    .prepare("SELECT user_id FROM member_profiles WHERE handle=?")
    .bind(handle)
    .first();
  if (!target) fail("No profile with that handle.", 404);
  // Same rule as account moderation (members.mjs): never yourself or the owner, and only the
  // owner acts on other staff.
  const actorRole = await roleOf(db, actor);
  const targetRole = await roleOf(db, target.user_id);
  if (
    target.user_id === actor ||
    targetRole === "owner" ||
    (actorRole !== "owner" && targetRole !== "member")
  )
    fail("You cannot moderate yourself or this staff account.", 403);
  const now = Date.now();
  const statements = [];
  if (body.action !== "dismiss")
    statements.push(
      db
        .prepare(`UPDATE member_profiles SET community_hidden=? WHERE user_id=? AND ${guard.sql}`)
        .bind(body.action === "hide" ? 1 : 0, target.user_id, ...guard.binds),
    );
  statements.push(
    db
      .prepare(
        `UPDATE community_reports SET resolved_at=?,resolution=? WHERE target_id=? AND resolved_at IS NULL AND ${guard.sql}`,
      )
      .bind(now, body.action, target.user_id, ...guard.binds),
    db
      .prepare(
        `INSERT INTO moderation_audit(id,actor_id,target_id,action,reason,created_at,details) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql}`,
      )
      .bind(
        crypto.randomUUID(),
        actor,
        target.user_id,
        `community-${body.action}`,
        reason,
        now,
        JSON.stringify({ handle }),
        ...guard.binds,
      ),
  );
  const results = await db.batch(statements);
  if (results.at(-1).meta.changes !== 1) fail("Current staff access is required.", 403);
  return { ok: true };
}
