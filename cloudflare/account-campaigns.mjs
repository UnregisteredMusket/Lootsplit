import { hydrateRoomImages } from "./room-images.mjs";
import {
  deletionRecoverySql,
  deletionRecoveryArgs,
  validateRecovery,
  recoveryAccountGuardSql,
  recoveryAccountGuardArgs,
} from "./campaign-recovery.mjs";
import { readCloudTable } from "../src/lib/quire/cloud.ts";
import {
  assertCanHost,
  hostedCampaignGuardArgs,
  hostedCampaignGuardSql,
  hostedCampaignLimit,
  hostedCampaignLimitError,
} from "./hosted-campaigns.mjs";
import { projectRecord } from "../src/lib/quire/session-records.ts";
import {
  ACCOUNT_BACKUP_BYTES,
  accountBackupBytesSql,
  BACKUP_MAX_BYTES,
  BACKUP_PARTS_KEY,
  backupPartStatements,
  backupParts,
  backupPartsCompleteSql,
} from "./backup-parts.mjs";
import {
  backupBytesSql,
  campaignGuardArgs,
  campaignGuardSql,
  planBackupRotation,
  replaceStatement,
} from "./backup-rotation.mjs";
import { roomBackupKey } from "../src/lib/account/campaign-backups.ts";
import {
  readRoomCore,
  readStoredRoom,
  roomDeleteStatement,
  roomSectionsDeletedStatement,
  roomVersionSql,
  roomWriteStatements,
} from "./room-storage.mjs";

const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};

export async function resumeCampaignMembership(db, userId, body, limit = hostedCampaignLimit()) {
  const member = await db
    .prepare("SELECT * FROM library_members WHERE user_id=? AND code=?")
    .bind(userId, body.code)
    .first();
  if (!member) fail("Campaign not found.", 404);
  const row = await readStoredRoom(db, member.code);
  const room = row ? row.room : null;
  // Ownership is the saved account membership plus the current server seat, never a client role.
  const seat = room?.seats.find((s) => s.id === member.seat_id && s.token === member.token);
  if (!seat || (room.closed && seat.role !== "dm"))
    fail("This campaign membership is no longer available. Ask the DM for a new invitation.", 403);
  let reopened = false;
  if (room.closed) {
    if (body.reopen !== true)
      fail("This session has ended. Use Reopen as DM in My campaigns to continue it.", 409);
    if (body.revision !== row.version.revision)
      fail("The campaign changed. Refresh My campaigns before reopening it.", 409);
    if (Object.values(room.drafts || {}).some((draft) => draft.length))
      fail("This campaign has pending turns. Resolve them before reopening it.", 409);
    // A closed room is not live, so reopening it hosts a new online campaign.
    await assertCanHost(db, userId, "reopen", limit);
    const next = structuredClone(room);
    next.closed = false;
    next.ownerId = userId;
    next.sessionId = crypto.randomUUID();
    next.invitations = {};
    next.revision = row.version.revision + 1;
    const players = next.seats.filter((s) => s.role === "player");
    // Closing ended these player sessions. Reopening must not silently restore revoked access.
    next.departed = [
      ...(next.departed || []).filter((s) => !players.some((p) => p.id === s.id)),
      ...players.map((s) => ({ ...s, status: "dismissed" })),
    ];
    next.seats = next.seats.filter((s) => s.role === "dm");
    next.turn = next.seats.findIndex((s) => s.id === seat.id);
    // Revision-only guard, as before (the reopen request names the revision it saw).
    const write = roomWriteStatements(db, next, {
      expect: { revision: row.version.revision },
      extraWhere: hostedCampaignGuardSql,
      extraArgs: hostedCampaignGuardArgs(userId, limit),
      // Sections of the room as read, so a sectioned room does not re-send unchanged parts.
      present: new Map((row.version.sections ?? []).map((s) => [s.hash, s.parts])),
    });
    if (!write.changed(await db.batch(write.statements), write.statements)) {
      await assertCanHost(db, userId, "reopen", limit);
      const current = await readRoomCore(db, member.code);
      if (current?.revision === row.version.revision) throw hostedCampaignLimitError(limit);
      fail("The campaign changed. Refresh My campaigns before reopening it.", 409);
    }
    reopened = true;
  }
  await db
    .prepare("UPDATE library_members SET updated_at=? WHERE user_id=? AND code=?")
    .bind(Date.now(), userId, member.code)
    .run();
  return {
    code: member.code,
    token: member.token,
    seatId: seat.id,
    role: seat.role,
    purseIds: seat.purseIds,
    name: member.name,
    userId,
    reopened,
  };
}

export async function campaignAction(db, userId, body, actor) {
  if (typeof body.code !== "string" || !["rename", "delete", "export"].includes(body.action))
    fail("Invalid campaign action.");
  const member = await db
    .prepare("SELECT * FROM library_members WHERE user_id=? AND code=?")
    .bind(userId, body.code)
    .first();
  if (!member) fail("Campaign membership not found.", 404);
  if (body.action === "rename") {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 80)
      fail("Use a campaign name of 1–80 characters.");
    await db
      .prepare("UPDATE library_members SET name=?,updated_at=? WHERE user_id=? AND code=?")
      .bind(body.name.trim(), Date.now(), userId, body.code)
      .run();
    return { ok: true };
  }
  const exporting = body.action === "export";
  if (!exporting && body.confirm !== body.code) fail("Type the campaign code to confirm deletion.");
  const accountGuardArgs = exporting ? [] : recoveryAccountGuardArgs(actor, userId);
  const row = await readStoredRoom(db, body.code);
  if (!row) fail("This campaign is already closed.", 404);
  const room = row.room,
    seat = room.seats.find((s) => s.id === member.seat_id && s.token === member.token);
  // The purses exactly as stored at this version, for the recovery copy (taken before any
  // hydration below can touch the room object).
  const recoveryRoom = { ...room, table: { purses: structuredClone(room.table?.purses) } };
  if (seat?.role !== "dm")
    fail(
      exporting
        ? "Only the linked dungeon master can download a shared campaign."
        : "Only the linked dungeon master can delete a shared campaign.",
      403,
    );
  if (!exporting && Object.values(room.drafts || {}).some((d) => d.length))
    fail("Submit or discard pending turns in the campaign before deleting it.", 409);
  if (!exporting && body.revision !== row.version.revision)
    fail("The campaign changed. Refresh your library before deleting it.", 409);
  let projected;
  try {
    projected = projectRecord(await hydrateRoomImages(db, room.code, room.table), seat);
  } catch {
    fail(
      "An archived record cannot be safely backed up. Your campaign was not deleted. Export your records for recovery first.",
      409,
    );
  }
  if (projected.journal?.reports?.some((report) => report.error) || !readCloudTable(projected))
    fail(
      "An archived record cannot be safely backed up. Your campaign was not deleted. Export your records for recovery first.",
      409,
    );
  // Download a copy (owner decision 2026-10-28: encourage local copies): the same campaign file
  // the deletion copy holds (the DM's projection, no private PDFs), without its recovery
  // records. It is a device backup file (kind "quire", version 2) that Import reads. Read-only.
  if (exporting) return { payload: campaignFile(projected, room), name: member.name };
  // Check existing records before mutation. The transaction captures them again,
  // so a legitimate concurrent saved roll/encounter is included as well.
  let recovery;
  try {
    const checked = await db
      .prepare(`SELECT ${deletionRecoverySql} AS body`)
      .bind(...deletionRecoveryArgs(recoveryRoom, seat, member.name, userId))
      .first();
    recovery = JSON.parse(checked.body);
  } catch {
    fail(
      "Related campaign records cannot be safely restored. Your campaign was not deleted. Download your records for recovery first.",
      409,
    );
  }
  if (recovery.assignments.some((assignment) => !assignment.body))
    fail(
      "Resume this campaign to update its linked shared character sheets before deleting it, then refresh My campaigns. Your campaign was not deleted.",
      409,
    );
  try {
    validateRecovery(recovery);
  } catch {
    fail(
      "Related campaign records cannot be safely restored. Your campaign was not deleted. Download your records for recovery first.",
      409,
    );
  }
  const payload = campaignFile(projected, room);
  // Per-campaign limit (backup-rotation.mjs): when this room already has the limit's worth of
  // online backups, its oldest is replaced by this recovery copy (confirmed by `replace`), in the
  // same batch and only once the copy is complete; the deletion is no longer refused for it.
  const campaignKey = roomBackupKey(body.code);
  const plan = await planBackupRotation(db, userId, campaignKey, body.replace, "Deleting this campaign");
  const backupId = crypto.randomUUID();
  // A campaign too large for one backup row is stored in parts (backup-parts.mjs, migration
  // 0027); the row then holds the parts marker and the recovery records.
  const payloadText = JSON.stringify(payload);
  const chunked = backupParts(payloadText);
  if (chunked && chunked.marker.bytes > BACKUP_MAX_BYTES)
    fail(
      "Campaign access changed or its complete recovery copy exceeds the supported cloud size. Your campaign was not deleted. Refresh or download your backups.",
      409,
    );
  const partStatements = chunked ? backupPartStatements(db, backupId, userId, chunked.parts) : [];
  // The recovery copy counts toward the account's backup storage, like any backup (step 3 review:
  // repeated delete/restore must not grow the database without bound). Apart from the one
  // confirmed rotation above, nothing is removed to make room: if the copy does not fit even
  // after it, the deletion is refused and the campaign and every backup stay as they are.
  const partChars = chunked ? chunked.parts.reduce((sum, part) => sum + part.length, 0) : 0;
  const freedSql = plan.replace ? backupBytesSql : "0";
  const freedArgs = plan.replace ? [plan.replace.id, userId, plan.replace.id] : [];
  const usedBytes = async () =>
    Number(
      (
        await db
          .prepare(`SELECT ${accountBackupBytesSql}-${freedSql} AS n`)
          .bind(userId, userId, ...freedArgs)
          .first()
      )?.n ?? 0,
    );
  const backupFull = () =>
    fail(
      `Your account backup storage is full (up to ${ACCOUNT_BACKUP_BYTES / 1_000_000} MB, including recovery copies of deleted campaigns). Deleting this campaign needs room for its recovery copy${plan.replace ? ", even after it replaces this campaign's oldest online backup" : ""}. Download a copy of the campaign, download and remove an older backup in My account → Backups, then delete again. Your campaign was not deleted.`,
      413,
    );
  if ((await usedBytes()) + (chunked ? partChars : payloadText.length) > ACCOUNT_BACKUP_BYTES) backupFull();
  // The room must still be exactly as read (no write since) for the backup and the delete.
  const unchanged = roomVersionSql(row.version);
  let results;
  try {
    results = await db.batch([
      db
        .prepare(
          `INSERT INTO library_backups(id,user_id,name,body,created_at,campaign_key)
         WITH snapshot(body) AS (SELECT json_set(?, '$.campaignRecovery', ${deletionRecoverySql}))
         SELECT ?,?,?,snapshot.body,?,? FROM snapshot
         WHERE length(CAST(snapshot.body AS BLOB))<=1900000
         AND ${accountBackupBytesSql}-${freedSql}+length(snapshot.body)+?<=?
         AND ${campaignGuardSql(campaignKey, plan)}
         AND ${unchanged.sql}
         AND ${recoveryAccountGuardSql}
         AND EXISTS(SELECT 1 FROM library_members WHERE user_id=? AND code=? AND seat_id=? AND token=?)`,
        )
        .bind(
          chunked ? JSON.stringify({ [BACKUP_PARTS_KEY]: chunked.marker }) : payloadText,
          ...deletionRecoveryArgs(recoveryRoom, seat, member.name, userId),
          backupId,
          userId,
          member.name + " (before deletion)",
          Date.now(),
          campaignKey,
          userId,
          userId,
          ...freedArgs,
          partChars,
          ACCOUNT_BACKUP_BYTES,
          ...campaignGuardArgs(userId, campaignKey, plan),
          ...unchanged.args,
          ...accountGuardArgs,
          userId,
          room.code,
          member.seat_id,
          member.token,
        ),
      ...partStatements,
      // The deletion backup exists only once the whole copy (every part) is stored.
      db
        .prepare(
          `INSERT INTO campaign_deletion_backups(backup_id,user_id,source_code) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM library_backups WHERE id=? AND user_id=?) AND ${backupPartsCompleteSql}`,
        )
        .bind(backupId, userId, body.code, backupId, userId, backupId, partStatements.length),
      // The replaced backup goes only once the new copy is complete (its deletion record exists).
      ...(plan.replace
        ? [
            replaceStatement(
              db,
              userId,
              plan,
              "EXISTS(SELECT 1 FROM campaign_deletion_backups WHERE backup_id=? AND user_id=?)",
              [backupId, userId],
            ),
          ]
        : []),
      roomDeleteStatement(db, body.code, {
        expect: row.version,
        extraWhere: "EXISTS(SELECT 1 FROM campaign_deletion_backups WHERE backup_id=? AND user_id=?)",
        extraArgs: [backupId, userId],
      }),
      roomSectionsDeletedStatement(db, body.code),
      db
        .prepare(
          "DELETE FROM library_members WHERE code=? AND NOT EXISTS (SELECT 1 FROM campaign_rooms WHERE code=?)",
        )
        .bind(body.code, body.code),
      db
        .prepare(
          "DELETE FROM push_subscriptions WHERE room_code=? AND NOT EXISTS (SELECT 1 FROM campaign_rooms WHERE code=?)",
        )
        .bind(body.code, body.code),
      db
        .prepare(
          "UPDATE play_characters SET campaign_code='',purse_id='',revision=revision+1,updated_at=? WHERE campaign_code=? AND NOT EXISTS(SELECT 1 FROM campaign_rooms WHERE code=?)",
        )
        .bind(Date.now(), body.code, body.code),
    ]);
  } catch {
    fail(
      "The complete recovery copy could not be saved. Your campaign was not deleted. Download your backups before trying again.",
      409,
    );
  }
  if (results[0].meta.changes !== 1) {
    // A concurrent backup filled the storage between the check above and this transaction.
    // Or another device changed this campaign's backups: planning again names the backup it
    // would now replace.
    const again = await planBackupRotation(db, userId, campaignKey, body.replace, "Deleting this campaign");
    if ((again.replace?.id ?? null) !== (plan.replace?.id ?? null))
      fail("Your online backups changed on another device. Refresh My campaigns and delete again. Your campaign was not deleted.", 409);
    if ((await usedBytes()) + (chunked ? partChars : payloadText.length) > ACCOUNT_BACKUP_BYTES) backupFull();
    fail(
      "Campaign access changed or its complete recovery copy exceeds the supported cloud size. Your campaign was not deleted. Refresh or download your backups.",
      409,
    );
  }
  if (results[2 + partStatements.length + (plan.replace ? 1 : 0)].meta.changes !== 1)
    fail("The campaign changed. Refresh before deleting it.", 409);
  return { ok: true, backupId, replaced: plan.replace?.id ?? null };
}

/** A shared campaign as a device backup file (kind "quire"), as the DM's projection shows it. */
function campaignFile(projected, room) {
  return {
    ...projected,
    kind: "quire",
    version: 2,
    exportedAt: Date.now(),
    settings: room.table.realm,
    notes: (room.table.notes || []).filter((note) => note.to !== "player"),
    books: [],
    articles: [],
  };
}
