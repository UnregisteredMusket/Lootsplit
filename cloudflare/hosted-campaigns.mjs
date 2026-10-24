/**
 * Online campaign hosting limit (owner decision 2026-10-24, AGENTS.project.md).
 *
 * An account may host at most HOSTED_CAMPAIGN_LIMIT live online campaigns. "Hosted" means a
 * shared room whose server-side `ownerId` is the account (set only by the server when the
 * account opens, reopens, restores or links the DM seat). "Live" means the room row exists and
 * is not closed: an active room or one kept online to view after play ended counts; a closed
 * ("Close room & revoke access") or deleted room does not. Joining as a player, account
 * backups (including deletion backups) and device campaigns never count.
 *
 * The site owner (`site_roles.role = 'owner'`, the same role every owner-only endpoint checks)
 * is exempt. Accounts already above the limit keep every room; only new hosting is refused.
 *
 * The guard is a bound SQL predicate placed inside the hosting write itself, so concurrent
 * requests cannot each pass a separate pre-check. The count reads the partial expression index
 * `campaign_rooms_live_owner` (migration 0022).
 */
export const DEFAULT_HOSTED_CAMPAIGN_LIMIT = 2;

/** Owner-adjustable via the Worker variable HOSTED_CAMPAIGN_LIMIT (a whole number ≥ 0). */
/** @param {{ HOSTED_CAMPAIGN_LIMIT?: string | number } | undefined} [env] */
export function hostedCampaignLimit(env = /** @type {any} */ (globalThis).__env__) {
  const raw = env?.HOSTED_CAMPAIGN_LIMIT;
  if (raw === undefined || raw === null || raw === "") return DEFAULT_HOSTED_CAMPAIGN_LIMIT;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : DEFAULT_HOSTED_CAMPAIGN_LIMIT;
}

export const HOSTED_CAMPAIGN_LIMIT_CODE = "hosted_campaign_limit";

export function hostedCampaignLimitMessage(limit) {
  const plural = limit === 1 ? "campaign" : "campaigns";
  return `You can host up to ${limit} online ${plural}. End or delete one, or keep playing this one offline on your device. Joining other campaigns as a player is not limited.`;
}

/** Live rooms hosted by one account; the expression and WHERE match the partial index exactly. */
const LIVE_HOSTED_COUNT =
  "(SELECT COUNT(*) FROM campaign_rooms WHERE json_extract(body,'$.ownerId')=? AND json_extract(body,'$.closed') IS NOT 1)";

/**
 * Predicate that is true when the account may host one more live room. Bind with
 * hostedCampaignGuardArgs(userId, limit) at the position of the fragment.
 */
export const hostedCampaignGuardSql = `(EXISTS(SELECT 1 FROM site_roles WHERE user_id=? AND role='owner') OR ${LIVE_HOSTED_COUNT}<?)`;
export const hostedCampaignGuardArgs = (userId, limit) => [userId, userId, limit];

export async function hostedCampaignStatus(db, userId, limit = hostedCampaignLimit()) {
  const row = await db
    .prepare(
      `SELECT ${LIVE_HOSTED_COUNT} AS hosted, EXISTS(SELECT 1 FROM site_roles WHERE user_id=? AND role='owner') AS exempt`,
    )
    .bind(userId, userId)
    .first();
  const hosted = Number(row?.hosted || 0),
    exempt = !!row?.exempt;
  return { hosted, limit, exempt, atLimit: !exempt && hosted >= limit };
}

export function hostedCampaignLimitError(limit) {
  return Object.assign(new Error(hostedCampaignLimitMessage(limit)), {
    status: 409,
    code: HOSTED_CAMPAIGN_LIMIT_CODE,
  });
}

/**
 * Records a refusal in the owner monitor (`campaign-limit`, registered in BUILTIN_LOGS) with a
 * one-way account tag, never the account identity. One entry per account per path per half-hour.
 * Logging never changes the refusal.
 */
export async function recordHostedCampaignRefusal(db, userId, path, status, now = Date.now()) {
  try {
    const { initializeMonitor, recordLog } = await import("./monitor-journal.mjs");
    await initializeMonitor(db, now);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`campaign-limit:${userId}`),
    );
    const tag = Array.from(new Uint8Array(digest).slice(0, 6), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    await recordLog(
      db,
      {
        id: `campaign-limit:${tag}:${path}:${Math.floor(now / 1_800_000)}`,
        source: "campaign-limit",
        observedAt: now,
        summary: `An account at the online campaign limit was refused (${path}): ${status.hosted} live hosted of ${status.limit}. Nothing was created or changed. Later refusals for this account and path in the same half-hour share this entry.`,
        account: tag,
        path,
        hosted: status.hosted,
        limit: status.limit,
      },
      now,
    );
  } catch (error) {
    console.warn("The online campaign limit refusal could not be logged to monitoring.", error);
  }
}

/**
 * Throws the clear limit error (and logs it) when the account cannot host another room.
 * Used both as the friendly pre-check and after a guarded write changed nothing.
 */
export async function assertCanHost(db, userId, path, limit = hostedCampaignLimit()) {
  const status = await hostedCampaignStatus(db, userId, limit);
  if (!status.atLimit) return status;
  await recordHostedCampaignRefusal(db, userId, path, status);
  throw hostedCampaignLimitError(limit);
}
