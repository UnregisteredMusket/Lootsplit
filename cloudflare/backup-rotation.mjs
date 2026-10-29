/**
 * Per-campaign online backup limit (owner decision 2026-10-28, migration 0028). Each account
 * keeps at most `CAMPAIGN_BACKUP_LIMIT` backups of one campaign, counting every kind (uploaded
 * backups and deletion recovery copies). A new backup of a campaign that already has that many
 * replaces the campaign's oldest backup:
 * - only the one oldest, never more, however far over the limit an older account is;
 * - only when the person confirmed that exact backup (`replace`, shown before it happens), so a
 *   backup nobody was told about is never removed;
 * - in the same D1 batch as the new backup, and only once the new backup is fully stored (its
 *   row, and for a deletion copy every part and its deletion record). If anything fails, the
 *   batch rolls back or the removal's guard does not match, and the old backup stays.
 * Backups without a campaign (saved before this change or by an older app) never rotate; the
 * account's overall backup limits (accounts.mjs `LIBRARY_LIMITS`) apply to every backup.
 */
import { CAMPAIGN_BACKUP_LIMIT } from "../src/lib/account/campaign-backups.ts";

export { CAMPAIGN_BACKUP_LIMIT };

const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};

/** SQL for a backup row's campaign key: its own, or for an older deletion copy, its room. */
export const backupCampaignKeySql = (alias = "b") =>
  `COALESCE(${alias}.campaign_key,(SELECT 'room:'||d.source_code FROM campaign_deletion_backups d WHERE d.backup_id=${alias}.id AND d.user_id=${alias}.user_id))`;

/** SQL for the bytes one backup uses, parts included (bind id, user id, id). */
export const backupBytesSql =
  "((SELECT COALESCE(SUM(LENGTH(body)),0) FROM library_backups WHERE id=? AND user_id=?)+(SELECT COALESCE(SUM(LENGTH(body)),0) FROM library_backup_parts WHERE backup_id=?))";

const dateOf = (at) => new Date(Number(at)).toISOString().slice(0, 10);

/**
 * Plan a new backup of campaign `key` for `userId`: `{ replace: null }` when the campaign has room,
 * or `{ replace: { id, name, created_at } }` when its oldest backup is replaced. A rotation the
 * request did not confirm (`confirmed` is not that oldest backup's id) is refused with a 409 that
 * names the backup, so the person can download it first; nothing is changed.
 * @param {any} db @param {string} userId @param {string | null} key @param {unknown} confirmed
 */
export async function planBackupRotation(db, userId, key, confirmed, what = "Saving this backup") {
  if (!key) return { replace: null };
  const rows = (
    await db
      .prepare(
        `SELECT b.id,b.name,b.created_at FROM library_backups b WHERE b.user_id=? AND ${backupCampaignKeySql("b")}=? ORDER BY b.created_at,b.id`,
      )
      .bind(userId, key)
      .all()
  ).results;
  if (rows.length < CAMPAIGN_BACKUP_LIMIT) return { replace: null };
  const oldest = rows[0];
  if (confirmed !== oldest.id)
    fail(
      `Each campaign keeps up to ${CAMPAIGN_BACKUP_LIMIT} online backups. ${what} replaces your oldest online backup of this campaign, “${oldest.name}” from ${dateOf(oldest.created_at)}. Download it first if you want to keep it, then confirm again. Nothing was changed.`,
      409,
      { replaces: { id: oldest.id, name: oldest.name, created_at: oldest.created_at } },
    );
  return { replace: { id: oldest.id, name: oldest.name, created_at: Number(oldest.created_at) } };
}

/**
 * SQL guard for the INSERT of a new backup (bind with `campaignGuardArgs`): with a rotation, the
 * replaced backup is still this campaign's oldest and the campaign is at its limit; without one,
 * the campaign is below its limit. A concurrent backup of the same campaign therefore makes one
 * of the two inserts match nothing instead of removing a second backup.
 */
export function campaignGuardSql(key, plan) {
  if (!key) return "1";
  const keyed = `FROM library_backups g WHERE g.user_id=? AND ${backupCampaignKeySql("g")}=?`;
  return plan.replace
    ? `((SELECT g.id ${keyed} ORDER BY g.created_at,g.id LIMIT 1)=? AND (SELECT COUNT(*) ${keyed})>=?)`
    : `(SELECT COUNT(*) ${keyed})<?`;
}
export function campaignGuardArgs(userId, key, plan) {
  if (!key) return [];
  return plan.replace
    ? [userId, key, plan.replace.id, userId, key, CAMPAIGN_BACKUP_LIMIT]
    : [userId, key, CAMPAIGN_BACKUP_LIMIT];
}

/**
 * The statement removing the replaced backup, after the new one in the same batch. It removes
 * only that one row of this account (its parts and deletion record cascade), and only if
 * `storedSql` (bound with `storedArgs`) says the new backup is fully stored.
 */
export function replaceStatement(db, userId, plan, storedSql, storedArgs) {
  return db
    .prepare(`DELETE FROM library_backups WHERE id=? AND user_id=? AND ${storedSql}`)
    .bind(plan.replace.id, userId, ...storedArgs);
}
