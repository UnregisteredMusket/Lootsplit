const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};

export async function resumeCampaignMembership(db, userId, body) {
  const member = await db
    .prepare("SELECT * FROM library_members WHERE user_id=? AND code=?")
    .bind(userId, body.code)
    .first();
  if (!member) fail("Campaign not found.", 404);
  const row = await db
    .prepare("SELECT body,revision FROM campaign_rooms WHERE code=?")
    .bind(member.code)
    .first();
  const room = row ? JSON.parse(row.body) : null;
  // Ownership is the saved account membership plus the current server seat, never a client role.
  const seat = room?.seats.find((s) => s.id === member.seat_id && s.token === member.token);
  if (!seat || (room.closed && seat.role !== "dm"))
    fail("This campaign membership is no longer available. Ask the DM for a new invitation.", 403);
  let reopened = false;
  if (room.closed) {
    if (body.reopen !== true)
      fail("This session has ended. Use Reopen as DM in My campaigns to continue it.", 409);
    if (body.revision !== row.revision)
      fail("The campaign changed. Refresh My campaigns before reopening it.", 409);
    if (Object.values(room.drafts || {}).some((draft) => draft.length))
      fail("This campaign has pending turns. Resolve them before reopening it.", 409);
    const next = structuredClone(room);
    next.closed = false;
    next.ownerId = userId;
    next.sessionId = crypto.randomUUID();
    next.invitations = {};
    next.revision = row.revision + 1;
    const players = next.seats.filter((s) => s.role === "player");
    // Closing ended these player sessions. Reopening must not silently restore revoked access.
    next.departed = [
      ...(next.departed || []).filter((s) => !players.some((p) => p.id === s.id)),
      ...players.map((s) => ({ ...s, status: "dismissed" })),
    ];
    next.seats = next.seats.filter((s) => s.role === "dm");
    next.turn = next.seats.findIndex((s) => s.id === seat.id);
    const saved = await db
      .prepare("UPDATE campaign_rooms SET body=?,revision=? WHERE code=? AND revision=?")
      .bind(JSON.stringify(next), next.revision, member.code, row.revision)
      .run();
    if (saved.meta.changes !== 1)
      fail("The campaign changed. Refresh My campaigns before reopening it.", 409);
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

export async function campaignAction(db, userId, body) {
  if (typeof body.code !== "string" || !["rename", "delete"].includes(body.action))
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
  if (body.confirm !== body.code) fail("Type the campaign code to confirm deletion.");
  const row = await db
    .prepare("SELECT body,revision FROM campaign_rooms WHERE code=?")
    .bind(body.code)
    .first();
  if (!row) fail("This campaign is already closed.", 404);
  const room = JSON.parse(row.body),
    seat = room.seats.find((s) => s.id === member.seat_id && s.token === member.token);
  if (seat?.role !== "dm")
    fail("Only the linked dungeon master can delete a shared campaign.", 403);
  if (Object.values(room.drafts || {}).some((d) => d.length))
    fail("Submit or discard pending turns in the campaign before deleting it.", 409);
  if (body.revision !== row.revision)
    fail("The campaign changed. Refresh your library before deleting it.", 409);
  const payload = {
    ...room.table,
    kind: "quire",
    version: 2,
    exportedAt: Date.now(),
    settings: room.table.realm,
    notes: (room.table.notes || []).filter((note) => note.to !== "player"),
    books: [],
    articles: [],
  };
  const backupId = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare(
        "INSERT INTO library_backups(id,user_id,name,body,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM campaign_rooms WHERE code=? AND revision=?)",
      )
      .bind(
        backupId,
        userId,
        member.name + " (before deletion)",
        JSON.stringify(payload),
        Date.now(),
        body.code,
        row.revision,
      ),
    db
      .prepare("DELETE FROM campaign_rooms WHERE code=? AND revision=?")
      .bind(body.code, row.revision),
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
  ]);
  if (results[1].meta.changes !== 1) fail("The campaign changed. Refresh before deleting it.", 409);
  return { ok: true, backupId };
}
