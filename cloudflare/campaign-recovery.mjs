import { readCloudTableForImport } from "../src/lib/quire/cloud.ts";
import { encounterSchema } from "../src/lib/encounters/model.mjs";
import { sheetSchema } from "../src/lib/characters/model.mjs";

const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};

// Acquire destructive/recovery authority at the same serializable transaction
// point as its receipt. A request authenticated earlier cannot outlive sign-out,
// expiry or a site restriction imposed before this write starts.
export const recoveryAccountGuardSql = `
 EXISTS(SELECT 1 FROM session s WHERE s.id=? AND s.userId=?
   AND (CASE WHEN typeof(s.expiresAt) IN ('integer','real') THEN s.expiresAt
     ELSE (julianday(s.expiresAt)-2440587.5)*86400000 END)
     > (julianday('now')-2440587.5)*86400000)
 AND NOT EXISTS(SELECT 1 FROM member_access a WHERE a.user_id=?
   AND (a.status='revoked' OR (a.status='banned' AND
     (a.ban_until IS NULL OR a.ban_until=0 OR a.ban_until>(julianday('now')-2440587.5)*86400000))))`;
export function recoveryAccountGuardArgs(actor, userId) {
  if (typeof actor?.id !== "string" || !actor.id)
    fail("Sign in before changing shared campaign recovery records.", 401);
  return [actor.id, userId, userId];
}

export function validateRecovery(recovery) {
  const unreadable = () =>
    fail(
      "This complete recovery copy cannot be read. Download it for recovery; no campaign was created.",
      409,
    );
  const text = (value) => typeof value === "string" && value.length > 0 && value.length <= 256;
  const at = (value) => Number.isSafeInteger(value) && value >= 0;
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  if (
    recovery?.version !== 1 ||
    !text(recovery.sourceCode) ||
    !text(recovery.dmSeatId) ||
    !text(recovery.name) ||
    ![
      "encounters",
      "encounterAwards",
      "encounterRolls",
      "characterRolls",
      "imports",
      "assignments",
    ].every((k) => Array.isArray(recovery[k]))
  )
    unreadable();
  if (
    typeof recovery.live !== "boolean" ||
    !Array.isArray(recovery.roomState?.seats) ||
    !recovery.roomState.seats.some((s) => s.id === recovery.dmSeatId && s.role === "dm") ||
    !Array.isArray(recovery.roomState.seen?.gifts) ||
    !Array.isArray(recovery.roomState.seen?.sales) ||
    (recovery.policy && ![0, 1].includes(recovery.policy.manual_allowed))
  )
    unreadable();
  const encounters = new Set();
  for (const e of recovery.encounters) {
    if (
      !text(e.id) ||
      encounters.has(e.id) ||
      !at(e.revision) ||
      !at(e.created_at) ||
      !at(e.updated_at) ||
      !["draft", "active", "review", "awarded"].includes(e.status) ||
      !encounterSchema.safeParse(e.body).success
    )
      unreadable();
    encounters.add(e.id);
  }
  const awards = new Set();
  for (const a of recovery.encounterAwards) {
    if (
      !encounters.has(a.encounter_id) ||
      awards.has(a.encounter_id) ||
      !text(a.receipt_id) ||
      !at(a.created_at) ||
      !object(a.body)
    )
      unreadable();
    awards.add(a.encounter_id);
  }
  for (const e of recovery.encounters)
    if ((e.status === "awarded") !== awards.has(e.id)) unreadable();
  for (const r of recovery.encounterRolls)
    if (
      !encounters.has(r.encounter_id) ||
      !text(r.request_key) ||
      !at(r.seq) ||
      !at(r.created_at) ||
      !object(r.body)
    )
      unreadable();
  for (const r of recovery.characterRolls)
    if (
      !text(r.id) ||
      !text(r.character_id) ||
      !text(r.request_key) ||
      !at(r.created_at) ||
      !object(r.body)
    )
      unreadable();
  for (const i of recovery.imports)
    if (
      !text(i.id) ||
      !["pending", "approved", "denied"].includes(i.status) ||
      !at(i.created_at) ||
      !sheetSchema.safeParse(i.body).success
    )
      unreadable();
  for (const a of recovery.assignments)
    if (
      !text(a.id) ||
      !text(a.purse_id) ||
      !at(a.revision) ||
      !at(a.updated_at) ||
      !sheetSchema.safeParse(a.body).success
    )
      unreadable();
  // Protocol secrets have no place in these archival bodies. Free text (including
  // character source/notes) remains intact; only structured credential fields fail.
  function checkSecrets(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (
        /^(token|seat_token|seatToken|authorization|cookie|password|secret|accessToken|refreshToken|idToken)$/i.test(
          key,
        )
      )
        unreadable();
      checkSecrets(child);
    }
  }
  checkSecrets(recovery);
}

// These subqueries execute inside the deletion transaction, not against a
// pre-transaction collection of independently read records. Never export seats,
// membership tokens, import seat_token, account credentials or private profiles.
export const deletionRecoverySql = `json_object(
 'version',1,'sourceCode',?,'dmSeatId',?,'name',?,'live',json(?),'roomState',json(?),
 'policy',json(COALESCE((SELECT json_object('manual_allowed',manual_allowed,'updated_at',updated_at) FROM play_policies WHERE code=?),'null')),
 'encounters',json((SELECT COALESCE(json_group_array(json_object('id',id,'body',json(body),'status',status,'revision',revision,'created_at',created_at,'updated_at',updated_at)),'[]') FROM dm_encounters WHERE code=? AND user_id=?)),
 'encounterAwards',json((SELECT COALESCE(json_group_array(json_object('encounter_id',a.encounter_id,'receipt_id',a.receipt_id,'body',json(a.body),'created_at',a.created_at)),'[]') FROM dm_encounter_awards a JOIN dm_encounters e ON e.id=a.encounter_id WHERE e.code=? AND e.user_id=?)),
 'encounterRolls',json((SELECT COALESCE(json_group_array(json_object('seq',r.seq,'encounter_id',r.encounter_id,'request_key',r.request_key,'body',json(r.body),'created_at',r.created_at)),'[]') FROM (SELECT * FROM dm_encounter_rolls ORDER BY seq) r JOIN dm_encounters e ON e.id=r.encounter_id WHERE e.code=? AND e.user_id=?)),
 'characterRolls',json((SELECT COALESCE(json_group_array(json_object('id',id,'user_id',user_id,'character_id',character_id,'request_key',request_key,'body',json(body),'created_at',created_at)),'[]') FROM (SELECT * FROM play_rolls WHERE code=? ORDER BY seq))),
 'imports',json((SELECT COALESCE(json_group_array(json_object('id',id,'user_id',user_id,'character_id',character_id,'purse_id',purse_id,'source_revision',source_revision,'target_revision',target_revision,'seat_id',seat_id,'session_id',session_id,'body',json(body),'status',status,'created_at',created_at,'reviewed_at',reviewed_at,'reviewed_by',reviewed_by)),'[]') FROM character_imports WHERE code=?)),
 'assignments',json((SELECT COALESCE(json_group_array(json_object('id',c.id,'user_id',c.user_id,'purse_id',c.purse_id,'revision',c.revision,'updated_at',c.updated_at,'body',json(json_set(json_extract(p.value,'$.sheet'),'$.coins',json('{"cp":0,"sp":0,"ep":0,"gp":0,"pp":0}'),'$.equipment',json('[]'))))),'[]') FROM play_characters c JOIN campaign_rooms r ON r.code=c.campaign_code LEFT JOIN json_each(r.body,'$.table.purses') p ON json_extract(p.value,'$.id')=c.purse_id WHERE c.campaign_code=?))
)`;

export function deletionRecoveryArgs(room, seat, name, userId) {
  const roomState = {
    turn: room.turn,
    closed: room.closed === true,
    viewOnly: room.viewOnly === true,
    seen: room.seen || { gifts: [], sales: [] },
    blockedUsers: room.blockedUsers || {},
    seats: [...room.seats, ...(room.departed || [])].map(({ token: _token, ...entry }) => entry),
  };
  return [
    room.code,
    seat.id,
    name,
    JSON.stringify(room.live === true),
    JSON.stringify(roomState),
    room.code,
    room.code,
    userId,
    room.code,
    userId,
    room.code,
    userId,
    room.code,
    room.code,
    room.code,
  ];
}

async function restoredMembership(db, userId, code) {
  const row = await db
    .prepare(
      "SELECT m.*,r.body FROM library_members m JOIN campaign_rooms r ON r.code=m.code WHERE m.user_id=? AND m.code=?",
    )
    .bind(userId, code)
    .first();
  const room = row && JSON.parse(row.body);
  const seat = room?.seats.find(
    (s) => s.id === row.seat_id && s.token === row.token && s.userId === userId && s.role === "dm",
  );
  if (!seat || room.ownerId !== userId)
    fail("The restored campaign is no longer available. Your backup is still safe.", 409);
  return {
    code,
    userId,
    token: seat.token,
    seatId: seat.id,
    role: "dm",
    purseIds: [],
    name: row.name,
  };
}

export async function restoreDeletedCampaign(db, userId, body, actor) {
  const accountGuardArgs = recoveryAccountGuardArgs(actor, userId);
  if (
    typeof body.id !== "string" ||
    body.id.length > 80 ||
    typeof body.requestKey !== "string" ||
    !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestKey)
  )
    fail("Invalid campaign recovery request.");
  const previous = await db
    .prepare(
      "SELECT code FROM campaign_recoveries WHERE user_id=? AND backup_id=? AND request_key=?",
    )
    .bind(userId, body.id, body.requestKey)
    .first();
  if (previous) return restoredMembership(db, userId, previous.code);
  // Do not trust a recovery marker in a client-uploaded backup. Only a backup
  // written by the guarded deletion transaction may restore server history.
  const row = await db
    .prepare(
      "SELECT b.body,b.name FROM library_backups b JOIN campaign_deletion_backups d ON d.backup_id=b.id AND d.user_id=b.user_id WHERE b.id=? AND b.user_id=?",
    )
    .bind(body.id, userId)
    .first();
  if (!row) fail("Shared recovery backup not found.", 404);
  const payload = JSON.parse(row.body),
    recovery = payload.campaignRecovery;
  const table = readCloudTableForImport(payload);
  if (!table)
    fail(
      "This recovery copy cannot be read. Download it for recovery; no campaign was created.",
      409,
    );
  validateRecovery(recovery);

  const now = Date.now(),
    id = crypto.randomUUID();
  // A fresh room has one verified DM, no invitations and no previous capabilities.
  // Keep the archived DM seat ID for historical report visibility, but rotate its token.
  const seat = {
    id: recovery.dmSeatId,
    userId,
    token: crypto.randomUUID(),
    name: recovery.roomState?.seats.find((s) => s.id === recovery.dmSeatId)?.name || "DM",
    role: "dm",
    purseIds: [],
  };
  const code = crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const name = `${recovery.name} (restored)`;
  for (const purse of table.purses) {
    // These are independent campaign characters, not assignments of somebody
    // else's account profile. The original assignment stays in the recovery log.
    delete purse.profileId;
    delete purse.sheetReadOnlyForDm;
    if (!purse.sheet && purse.kind === "character") {
      const assignment = recovery.assignments.find((a) => a.purse_id === purse.id);
      if (assignment) purse.sheet = assignment.body;
    }
  }
  const room = {
    code,
    ownerId: userId,
    sessionId: crypto.randomUUID(),
    revision: 1,
    live: recovery.live === true,
    viewOnly: true,
    closed: false,
    turn: 0,
    seats: [seat],
    table,
    seen: recovery.roomState?.seen || { gifts: [], sales: [] },
    blockedUsers: recovery.roomState?.blockedUsers || {},
    invitations: {},
    drafts: {},
  };
  const encounterIds = new Map(recovery.encounters.map((e) => [e.id, crypto.randomUUID()]));
  const receiptIds = new Map(
    recovery.encounterAwards.map((a) => [a.receipt_id, crypto.randomUUID()]),
  );
  const sourceAwards = new Map(recovery.encounterAwards.map((a) => [a.encounter_id, a]));
  // Only active references to an exact restored award move with its rotated IDs.
  // Historical archive strings, note identity/text and unmatched references stay intact.
  for (const entry of table.journal?.entries || []) {
    const provenance = entry.provenance;
    if (provenance?.kind !== "encounter-loot") continue;
    const sourceAward = sourceAwards.get(provenance.encounterId);
    if (sourceAward?.receipt_id !== provenance.receiptId) continue;
    entry.provenance = {
      ...provenance,
      encounterId: encounterIds.get(sourceAward.encounter_id),
      receiptId: receiptIds.get(sourceAward.receipt_id),
    };
  }
  const committed = "EXISTS(SELECT 1 FROM campaign_recoveries WHERE id=? AND user_id=?)";
  const statements = [
    db
      .prepare(
        `INSERT INTO campaign_recoveries(id,backup_id,user_id,request_key,code,body,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM campaign_deletion_backups d JOIN library_backups b ON b.id=d.backup_id AND b.user_id=d.user_id WHERE d.backup_id=? AND d.user_id=?) AND ${recoveryAccountGuardSql} ON CONFLICT(user_id,backup_id,request_key) DO NOTHING`,
      )
      .bind(
        id,
        body.id,
        userId,
        body.requestKey,
        code,
        JSON.stringify(recovery),
        now,
        body.id,
        userId,
        ...accountGuardArgs,
      ),
    db
      .prepare(`INSERT INTO campaign_rooms(code,revision,body) SELECT ?,1,? WHERE ${committed}`)
      .bind(code, JSON.stringify(room), id, userId),
    db
      .prepare(
        `INSERT INTO library_members(user_id,code,seat_id,token,name,archived,updated_at) SELECT ?,?,?,?,?,0,? WHERE ${committed}`,
      )
      .bind(userId, code, seat.id, seat.token, name, now, id, userId),
  ];
  const encounters = recovery.encounters.map((e) => ({ ...e, id: encounterIds.get(e.id) }));
  const awards = recovery.encounterAwards.map((a) => ({
    ...a,
    encounter_id: encounterIds.get(a.encounter_id),
    receipt_id: receiptIds.get(a.receipt_id),
    body: {
      ...a.body,
      code,
      receiptId: receiptIds.get(a.receipt_id),
      encounterId: encounterIds.get(a.encounter_id),
    },
  }));
  const encounterRolls = [...recovery.encounterRolls]
    .sort((a, b) => a.seq - b.seq)
    .map((r) => ({
      ...r,
      encounter_id: encounterIds.get(r.encounter_id),
      request_key: crypto.randomUUID(),
    }));
  const characterRolls = recovery.characterRolls.map((r) => {
    const rollId = crypto.randomUUID();
    const profile = recovery.assignments.find((a) => a.id === r.character_id);
    const characterId = profile
      ? `campaign:${code}:${profile.purse_id}`
      : r.character_id.startsWith(`campaign:${recovery.sourceCode}:`)
        ? `campaign:${code}:${r.character_id.slice(recovery.sourceCode.length + 10)}`
        : r.character_id;
    return {
      ...r,
      id: rollId,
      character_id: characterId,
      request_key: crypto.randomUUID(),
      body: { ...r.body, id: rollId, characterId },
    };
  });
  // Use one bounded statement per collection rather than one per historical row.
  statements.push(
    db
      .prepare(
        `INSERT INTO dm_encounters(id,user_id,code,body,status,revision,created_at,updated_at) SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.body'),json_extract(value,'$.status'),json_extract(value,'$.revision'),json_extract(value,'$.created_at'),json_extract(value,'$.updated_at') FROM json_each(?) WHERE ${committed}`,
      )
      .bind(userId, code, JSON.stringify(encounters), id, userId),
    db
      .prepare(
        `INSERT INTO dm_encounter_awards(encounter_id,receipt_id,body,created_at) SELECT json_extract(value,'$.encounter_id'),json_extract(value,'$.receipt_id'),json_extract(value,'$.body'),json_extract(value,'$.created_at') FROM json_each(?) WHERE ${committed}`,
      )
      .bind(JSON.stringify(awards), id, userId),
    db
      .prepare(
        `INSERT INTO dm_encounter_rolls(encounter_id,request_key,body,created_at) SELECT json_extract(value,'$.encounter_id'),json_extract(value,'$.request_key'),json_extract(value,'$.body'),json_extract(value,'$.created_at') FROM json_each(?) WHERE ${committed}`,
      )
      .bind(JSON.stringify(encounterRolls), id, userId),
    db
      .prepare(
        `INSERT INTO play_rolls(id,user_id,character_id,code,request_key,body,created_at) SELECT json_extract(value,'$.id'),NULL,json_extract(value,'$.character_id'),?,json_extract(value,'$.request_key'),json_extract(value,'$.body'),json_extract(value,'$.created_at') FROM json_each(?) WHERE ${committed}`,
      )
      .bind(code, JSON.stringify(characterRolls), id, userId),
  );
  if (recovery.policy)
    statements.push(
      db
        .prepare(
          `INSERT INTO play_policies(code,manual_allowed,updated_at) SELECT ?,?,? WHERE ${committed}`,
        )
        .bind(code, recovery.policy.manual_allowed, recovery.policy.updated_at, id, userId),
    );
  await db.batch(statements);
  const saved = await db
    .prepare(
      "SELECT code FROM campaign_recoveries WHERE user_id=? AND backup_id=? AND request_key=?",
    )
    .bind(userId, body.id, body.requestKey)
    .first();
  if (!saved) fail("Your account access or backup changed. Refresh before restoring it.", 409);
  return restoredMembership(db, userId, saved.code);
}

export async function campaignRecoveryRecords(db, userId, body) {
  if (typeof body.code !== "string" || body.code.length > 16) fail("Invalid recovery campaign.");
  const row = await db
    .prepare("SELECT body FROM campaign_recoveries WHERE user_id=? AND code=?")
    .bind(userId, body.code)
    .first();
  if (!row) fail("Campaign recovery history not found.", 404);
  // Records stay privately downloadable after the restored room is deleted too.
  return { kind: "lootsplit-campaign-recovery", version: 1, records: JSON.parse(row.body) };
}
