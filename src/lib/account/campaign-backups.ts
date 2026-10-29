/**
 * Online (account) backups per campaign (owner decision 2026-10-28: "Limit the amount of online
 * backups for each user per campaign, and encourage manual downloads/ local storage of
 * campaigns"). Shared by the Worker (cloudflare/backup-rotation.mjs) and the account page, so
 * the limit is one constant. No imports: the Worker loads this file directly.
 *
 * A backup's campaign is its `campaign key`:
 * - `room:<CODE>` for a shared room: the deletion recovery copy of that room (older copies are
 *   read from `campaign_deletion_backups.source_code`), and a backup a DM saves while joined to it;
 * - `device:<id>` for a device campaign saved while not in a shared room (the device campaign's
 *   id, or for the first campaign on a device, which every device calls "main", an id this device
 *   keeps for it).
 * Backups saved before this change, or by an older app, have no key: they never rotate and stay
 * until the person removes them; the account's overall limits still apply to them.
 */
export const CAMPAIGN_BACKUP_LIMIT = 3;

const KEY = /^(room|device):[A-Za-z0-9_-]{1,64}$/;

/** A valid campaign key, or null (an unidentified backup). */
export function campaignBackupKey(value: unknown): string | null {
  return typeof value === "string" && KEY.test(value) ? value : null;
}

export function roomBackupKey(code: string): string {
  return `room:${code}`;
}

export type CampaignBackupRow = {
  id: string;
  name: string;
  created_at: number;
  campaign_key?: string | null;
};

/** One campaign's backups, oldest first (the order rotation uses on the server too). */
export function campaignBackups<T extends CampaignBackupRow>(
  backups: readonly T[],
  key: string | null,
): T[] {
  if (!key) return [];
  return backups
    .filter((b) => b.campaign_key === key)
    .sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The backup the next backup of this campaign replaces: its oldest, once it already has
 * `limit` or more. Never more than one, however far over the limit an older account is.
 */
export function backupToReplace<T extends CampaignBackupRow>(
  backups: readonly T[],
  key: string | null,
  limit = CAMPAIGN_BACKUP_LIMIT,
): T | null {
  const same = campaignBackups(backups, key);
  return same.length >= limit ? same[0]! : null;
}
