const reject = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export { roleOf as siteRole } from "./members.mjs";
import { roleOf as siteRole, staffCommitGuard } from "./members.mjs";
export async function publicAnnouncement(db) {
  const row = await db
    .prepare("SELECT title, message FROM site_settings WHERE id=1 AND published=1")
    .first();
  return { announcement: row || null };
}
export async function ownerOverview(db, userId) {
  if ((await siteRole(db, userId)) !== "owner") reject("Owner access is required.", 403);
  const stats = await db
    .prepare(
      `SELECT
    (SELECT COUNT(*) FROM user) AS accounts,
    (SELECT COUNT(*) FROM campaign_rooms) AS sharedCampaigns,
    (SELECT COUNT(*) FROM library_members) AS savedMemberships,
    (SELECT COUNT(*) FROM library_backups) AS cloudBackups,
    (SELECT COUNT(*) FROM library_characters) AS characterProfiles`,
    )
    .first();
  const settings = await db
    .prepare(
      "SELECT title, message, published, revision, updated_at, donation_url, donation_revision FROM site_settings WHERE id=1",
    )
    .first();
  return { stats, settings };
}
export async function saveAnnouncement(db, userId, body, sessionId) {
  if ((await siteRole(db, userId)) !== "owner") reject("Owner access is required.", 403);
  if (
    typeof body.title !== "string" ||
    typeof body.message !== "string" ||
    typeof body.published !== "boolean" ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 0
  )
    reject("Please check the announcement fields.");
  const title = body.title.trim(),
    message = body.message.trim();
  if (title.length > 100 || message.length > 2000 || (body.published && (!title || !message)))
    reject(
      "Published announcements need a title (up to 100 characters) and message (up to 2,000 characters).",
    );
  const id = crypto.randomUUID(),
    now = Date.now();
  const guard = await staffCommitGuard(db, userId, sessionId, ["owner"]);
  const results = await db.batch([
    db
      .prepare(
        `UPDATE site_settings SET title=?, message=?, published=?, revision=revision+1, update_id=?, updated_by=?, updated_at=? WHERE id=1 AND revision=? AND ${guard.sql}`,
      )
      .bind(title, message, body.published ? 1 : 0, id, userId, now, body.revision, ...guard.binds),
    db
      .prepare(
        "INSERT INTO site_audit (id,actor_id,action,created_at,revision) SELECT update_id,updated_by,?,updated_at,revision FROM site_settings WHERE id=1 AND update_id=?",
      )
      .bind(body.published ? "announcement.publish" : "announcement.withdraw", id),
  ]);
  if (results[0].meta.changes !== 1)
    reject(
      "This announcement changed in another tab. Reload the owner panel before saving again.",
      409,
    );
  return { ok: true, revision: body.revision + 1 };
}

export async function publicDonations(db) {
  const row = await db.prepare("SELECT donation_url FROM site_settings WHERE id=1").first();
  return { donationUrl: row?.donation_url || null };
}
export async function saveDonations(db, userId, body, sessionId) {
  if ((await siteRole(db, userId)) !== "owner") reject("Owner access is required.", 403);
  if (
    typeof body.donationUrl !== "string" ||
    body.donationUrl.length > 2000 ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 0
  )
    reject("Please check the donation link.");
  let donationUrl = body.donationUrl.trim();
  if (donationUrl) {
    let url;
    try {
      url = new URL(donationUrl);
    } catch {
      reject("Enter a complete HTTPS donation link.");
    }
    if (url.protocol !== "https:" || url.username || url.password)
      reject("Use an HTTPS donation link without a username or password in the URL.");
    donationUrl = url.href;
  }
  const id = crypto.randomUUID(),
    now = Date.now();
  const guard = await staffCommitGuard(db, userId, sessionId, ["owner"]);
  const result = await db.batch([
    db
      .prepare(
        `UPDATE site_settings SET donation_url=?, donation_revision=donation_revision+1, donation_update_id=? WHERE id=1 AND donation_revision=? AND ${guard.sql}`,
      )
      .bind(donationUrl, id, body.revision, ...guard.binds),
    db
      .prepare(
        "INSERT INTO site_audit (id,actor_id,action,created_at,revision) SELECT donation_update_id,?,'donations.update',?,donation_revision FROM site_settings WHERE id=1 AND donation_update_id=?",
      )
      .bind(userId, now, id),
  ]);
  if (result[0].meta.changes !== 1)
    reject(
      "The donation link changed in another tab. Reload the owner panel before saving again.",
      409,
    );
  return { donationUrl, revision: body.revision + 1 };
}
