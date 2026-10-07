import { APIError } from "better-auth/api";
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export async function roleOf(db, id) {
  return (
    (await db.prepare("SELECT role FROM site_roles WHERE user_id=?").bind(id).first())?.role ||
    "member"
  );
}
/** A bound SQL predicate evaluated inside the privileged mutation's transaction. */
export async function staffCommitGuard(db, actor, sessionId, roles, fresh = false) {
  const role = await roleOf(db, actor);
  if (!roles.includes(role)) fail("Current staff access is required.", 403);
  const access = await db
    .prepare("SELECT revision FROM member_access WHERE user_id=?")
    .bind(actor)
    .first();
  return {
    sql: `EXISTS (SELECT 1 FROM site_roles r JOIN member_access a ON a.user_id=r.user_id JOIN session s ON s.userId=r.user_id WHERE r.user_id=? AND r.role=? AND a.revision=? AND (a.status='active' OR (a.status='banned' AND a.ban_until IS NOT NULL AND a.ban_until<=(julianday('now')-2440587.5)*86400000)) AND s.id=? AND julianday(s.expiresAt)>julianday('now')${fresh ? " AND julianday(s.createdAt)>julianday('now','-10 minutes')" : ""})`,
    binds: [actor, role, access?.revision ?? -1, sessionId || ""],
  };
}
export function restricted(row, now = Date.now()) {
  return (
    row?.status === "revoked" ||
    (row?.status === "banned" && (!row.ban_until || row.ban_until > now))
  );
}
export async function assertActive(db, id, authHook = false) {
  const row = await db
    .prepare("SELECT status,ban_until FROM member_access WHERE user_id=?")
    .bind(id)
    .first();
  if (restricted(row)) {
    const message =
      row.status === "revoked"
        ? "Account access has been revoked. Contact the site owner."
        : row.ban_until
          ? `Account suspended until ${new Date(row.ban_until).toISOString()}.`
          : "This account is permanently banned.";
    if (authHook) throw new APIError("FORBIDDEN", { message });
    fail(message, 403);
  }
}
export async function assertLinkedSeatActive(db, code, token, seat) {
  if (!db) return;
  if (seat === undefined) {
    const row = await db.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind(code).first();
    seat = row ? JSON.parse(row.body).seats?.find((s) => s.token === token) : null;
  }
  // Forget removes a library card, not the account identity of a current seat.
  const row = await db
    .prepare(
      "SELECT status,ban_until FROM member_access WHERE user_id=COALESCE(NULLIF(?,''),(SELECT user_id FROM library_members WHERE code=? AND token=?))",
    )
    .bind(seat?.userId || "", code, token)
    .first();
  if (restricted(row)) fail("This campaign seat belongs to a restricted account.", 403);
}
export async function touchMember(db, id) {
  await db
    .prepare(
      "INSERT INTO member_profiles(user_id,last_online) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET last_online=excluded.last_online WHERE last_online IS NULL OR last_online<?",
    )
    .bind(id, Date.now(), Date.now() - 60000)
    .run();
}
export async function profileOf(db, id) {
  const row = await db
    .prepare(
      `SELECT u.id,u.name,u.createdAt AS member_since,COALESCE(p.introduction,'') AS introduction,COALESCE(p.portrait,'') AS portrait,COALESCE(p.contact_email,'') AS contact_email,COALESCE(p.share_contact,0) AS share_contact,COALESCE(p.email_opt_in,0) AS email_opt_in,p.last_online,COALESCE(p.revision,0) AS revision FROM user u LEFT JOIN member_profiles p ON p.user_id=u.id WHERE u.id=?`,
    )
    .bind(id)
    .first();
  return row;
}
export function displayName(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80)
    fail("Use a display name of 1–80 characters.");
  return value.trim();
}
/** Keep Better Auth's alternate profile transport on the same optimistic revision. */
export async function saveAuthProfile(db, id, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("Invalid profile update.");
  if (!Number.isSafeInteger(body.revision) || body.revision < 0)
    fail("A current profile revision is required.");
  const name = body.name === undefined ? undefined : displayName(body.name);
  const image = body.image;
  if (
    (image !== undefined &&
      image !== null &&
      (typeof image !== "string" || image.length > 15000)) ||
    body.email !== undefined ||
    (name === undefined && image === undefined)
  )
    fail("Please check your profile fields.");
  await db.prepare("INSERT OR IGNORE INTO member_profiles(user_id) VALUES (?)").bind(id).run();
  const result = await db.batch([
    db
      .prepare("UPDATE member_profiles SET revision=revision+1 WHERE user_id=? AND revision=?")
      .bind(id, body.revision),
    db
      .prepare(
        "UPDATE user SET name=CASE WHEN ? THEN ? ELSE name END,image=CASE WHEN ? THEN ? ELSE image END,updatedAt=? WHERE id=? AND changes()=1",
      )
      .bind(
        name !== undefined ? 1 : 0,
        name ?? "",
        image !== undefined ? 1 : 0,
        image ?? null,
        Date.now(),
        id,
      ),
  ]);
  if (result[0].meta.changes !== 1) fail("Your profile changed. Reload before saving again.", 409);
  return { status: true };
}
export async function saveProfile(db, id, body) {
  if (
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.trim().length > 80 ||
    typeof body.introduction !== "string" ||
    body.introduction.length > 2000 ||
    typeof body.contact_email !== "string" ||
    body.contact_email.length > 254 ||
    typeof body.share_contact !== "boolean" ||
    typeof body.email_opt_in !== "boolean" ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 0
  )
    fail("Please check your profile fields.");
  const email = body.contact_email.trim();
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))
    fail("Enter a valid messaging email address.");
  const portrait = body.portrait || "";
  if (
    typeof portrait !== "string" ||
    portrait.length > 500000 ||
    (portrait && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(portrait))
  )
    fail("Choose a PNG, JPEG or WebP image below 350 KB.");
  await db.prepare("INSERT OR IGNORE INTO member_profiles(user_id) VALUES (?)").bind(id).run();
  const result = await db.batch([
    db
      .prepare(
        "UPDATE member_profiles SET introduction=?,portrait=?,contact_email=?,share_contact=?,email_opt_in_at=CASE WHEN email_opt_in<>? THEN ? ELSE email_opt_in_at END,email_opt_in=?,revision=revision+1 WHERE user_id=? AND revision=?",
      )
      .bind(
        body.introduction.trim(),
        portrait,
        email,
        body.share_contact ? 1 : 0,
        body.email_opt_in ? 1 : 0,
        Date.now(),
        body.email_opt_in ? 1 : 0,
        id,
        body.revision,
      ),
    // Name is updated only after a successful profile revision change in this batch.
    db
      .prepare("UPDATE user SET name=?,updatedAt=? WHERE id=? AND changes()=1")
      .bind(body.name.trim(), Date.now(), id),
  ]);
  if (result[0].meta.changes !== 1) fail("Your profile changed. Reload before saving again.", 409);
  return profileOf(db, id);
}
export async function directory(db, actor, url) {
  const role = await roleOf(db, actor);
  const staff = ["owner", "admin", "moderator"].includes(role);
  if (!staff) fail("Staff access is required.", 403);
  const q = (url.searchParams.get("q") || "").slice(0, 100),
    offset = Math.max(0, Math.min(1000000, Number(url.searchParams.get("offset")) || 0));
  const filter = url.searchParams.get("status") || "all";
  const status =
    "CASE WHEN a.status='banned' AND a.ban_until IS NOT NULL AND a.ban_until<=? THEN 'active' ELSE COALESCE(a.status,'active') END";
  const match = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
  const allowedFields =
    role === "moderator"
      ? "(u.name LIKE ? ESCAPE '\\' OR (p.share_contact=1 AND p.contact_email LIKE ? ESCAPE '\\'))"
      : "(u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')";
  const where = `${allowedFields} AND (?='all' OR ${status}=?)`;
  const params = [match, match, filter, Date.now(), filter];
  const rows = await db
    .prepare(
      `SELECT u.id,u.name,${role === "moderator" ? "''" : "u.email"} AS email,u.createdAt AS member_since,p.last_online,COALESCE(r.role,'member') AS role,${status} AS status,a.ban_until,a.reason,a.revision FROM user u LEFT JOIN site_roles r ON r.user_id=u.id LEFT JOIN member_access a ON a.user_id=u.id LEFT JOIN member_profiles p ON p.user_id=u.id WHERE ${where} ORDER BY u.createdAt DESC,u.id LIMIT 30 OFFSET ?`,
    )
    .bind(Date.now(), ...params, offset)
    .all();
  const count = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM user u LEFT JOIN member_access a ON a.user_id=u.id LEFT JOIN member_profiles p ON p.user_id=u.id WHERE ${where}`,
    )
    .bind(...params)
    .first();
  return { members: rows.results, total: count.n, offset, role };
}
export async function moderation(db, actor, body, sessionId) {
  const actorRole = await roleOf(db, actor),
    targetRole = await roleOf(db, body.id);
  if (!["owner", "admin", "moderator"].includes(actorRole)) fail("Staff access is required.", 403);
  if (
    body.id === actor ||
    targetRole === "owner" ||
    (actorRole !== "owner" && targetRole !== "member")
  )
    fail("You cannot moderate yourself or this staff account.", 403);
  if (
    typeof body.reason !== "string" ||
    !body.reason.trim() ||
    body.reason.length > 1000 ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 0
  )
    fail("A reason and current member revision are required.");
  const actions = ["warn", "ban", "revoke", "restore", "sessions", "clear-profile", "role"];
  if (!actions.includes(body.action)) fail("Unknown moderation action.");
  if (actorRole === "moderator" && !["warn", "ban", "clear-profile"].includes(body.action))
    fail("This action requires an admin or owner.", 403);
  let until = null;
  if (body.action === "ban" && body.until !== null) {
    until = body.until;
    if (!Number.isSafeInteger(until) || until <= Date.now() || until > Date.now() + 366 * 86400000)
      fail("Choose a future ban expiry within one year.");
  }
  if (
    actorRole === "moderator" &&
    body.action === "ban" &&
    (!until || until > Date.now() + 30 * 86400000)
  )
    fail("Moderators may suspend members for up to 30 days.", 403);
  if (
    body.action === "role" &&
    (actorRole !== "owner" || !["member", "admin", "moderator"].includes(body.role))
  )
    fail("Only the owner can grant or revoke staff roles.", 403);
  const target = await db
    .prepare("SELECT user_id FROM member_access WHERE user_id=?")
    .bind(body.id)
    .first();
  if (!target) fail("Member not found.", 404);
  const actionId = crypto.randomUUID(),
    now = Date.now();
  // Authorization must still be current when the transaction commits. Target revision
  // checks alone cannot stop an already-running request after its actor is demoted.
  const actorGuard = await staffCommitGuard(
    db,
    actor,
    sessionId,
    [actorRole],
    body.action === "role",
  );
  const statements = [
    db
      .prepare(
        `UPDATE member_access SET revision=revision+1,last_action=?,updated_at=? WHERE user_id=? AND revision=? AND ${actorGuard.sql} AND COALESCE((SELECT role FROM site_roles WHERE user_id=?),'member')=?`,
      )
      .bind(actionId, now, body.id, body.revision, ...actorGuard.binds, body.id, targetRole),
  ];
  const guard = "EXISTS (SELECT 1 FROM member_access WHERE user_id=? AND last_action=?)";
  const binds = [body.id, actionId];
  if (["ban", "revoke", "restore"].includes(body.action))
    statements.push(
      db
        .prepare(
          `UPDATE member_access SET status=?,ban_until=?,reason=? WHERE user_id=? AND last_action=?`,
        )
        .bind(
          body.action === "ban" ? "banned" : body.action === "revoke" ? "revoked" : "active",
          until,
          body.reason.trim(),
          ...binds,
        ),
    );
  if (["ban", "revoke", "sessions", "role"].includes(body.action))
    statements.push(
      db.prepare(`DELETE FROM session WHERE userId=? AND ${guard}`).bind(body.id, ...binds),
    );
  if (["ban", "revoke"].includes(body.action))
    statements.push(
      db
        .prepare(
          `DELETE FROM push_subscriptions WHERE (EXISTS (SELECT 1 FROM library_members m WHERE m.user_id=? AND m.code=push_subscriptions.room_code AND m.seat_id=push_subscriptions.seat_id) OR EXISTS (SELECT 1 FROM campaign_rooms r,json_each(r.body,'$.seats') s WHERE r.code=push_subscriptions.room_code AND json_extract(s.value,'$.id')=push_subscriptions.seat_id AND json_extract(s.value,'$.userId')=?)) AND ${guard}`,
        )
        .bind(body.id, body.id, ...binds),
    );
  if (body.action === "clear-profile")
    statements.push(
      db
        .prepare(
          `UPDATE member_profiles SET portrait='',introduction='',contact_email='',share_contact=0,revision=revision+1 WHERE user_id=? AND ${guard}`,
        )
        .bind(body.id, ...binds),
    );
  if (body.action === "role") {
    statements.push(
      db.prepare(`DELETE FROM site_roles WHERE user_id=? AND ${guard}`).bind(body.id, ...binds),
    );
    if (body.role !== "member")
      statements.push(
        db
          .prepare(
            `INSERT INTO site_roles(user_id,role,granted_at) SELECT user_id,?,? FROM member_access WHERE user_id=? AND last_action=?`,
          )
          .bind(body.role, now, ...binds),
      );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO moderation_audit(id,actor_id,target_id,action,reason,created_at,details) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,
      )
      .bind(
        actionId,
        actor,
        body.id,
        body.action,
        body.reason.trim(),
        now,
        JSON.stringify({ role: body.action === "role" ? body.role : undefined, until }),
        ...binds,
      ),
  );
  const results = await db.batch(statements);
  if (results[0].meta.changes !== 1)
    fail("This member changed. Refresh the list before trying again.", 409);
  return { ok: true };
}
export async function memberDetail(db, actor, id) {
  const role = await roleOf(db, actor);
  if (!["owner", "admin", "moderator"].includes(role)) fail("Staff access is required.", 403);
  const profile = await profileOf(db, id);
  if (!profile) fail("Member not found.", 404);
  if (role === "moderator" && !profile.share_contact) profile.contact_email = "";
  const history = await db
    .prepare(
      "SELECT a.action,a.reason,a.created_at,a.details,u.name AS actor FROM moderation_audit a LEFT JOIN user u ON u.id=a.actor_id WHERE target_id=? ORDER BY created_at DESC LIMIT 100",
    )
    .bind(id)
    .all();
  return { profile, history: history.results };
}
