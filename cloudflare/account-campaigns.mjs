const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
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
