import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { assertAdditiveSql } from "./production-migrations.mjs";

const directory = "cloudflare/migrations";
const schema = () => {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync(directory).filter((n) => n.endsWith(".sql")).sort())
    db.exec(readFileSync(`${directory}/${name}`, "utf8"));
  return db;
};
const plan = (db, sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array((sql.match(/\?/g) || []).length).fill("x")).map((row) => row.detail).join(" | ");

test("0017 is additive and lets the real Worker queries use its indexes", () => {
  assertAdditiveSql("0017_query_indexes.sql", readFileSync(`${directory}/0017_query_indexes.sql`, "utf8"));
  const db = schema();
  // cloudflare/campaign-characters.mjs: the partial assignment index cannot serve a bound campaign code.
  assert.match(plan(db, "SELECT id,body,purse_id,user_id FROM play_characters WHERE campaign_code=?"), /USING INDEX play_characters_campaign/);
  // cloudflare/members.mjs and accounts.mjs: one member's moderation history, newest first.
  assert.match(plan(db, "SELECT action,reason,created_at FROM moderation_audit WHERE target_id=? ORDER BY created_at DESC LIMIT 100"), /USING INDEX moderation_audit_target/);
  assert.doesNotMatch(plan(db, "SELECT action,reason,created_at FROM moderation_audit WHERE target_id=? ORDER BY created_at DESC LIMIT 100"), /TEMP B-TREE/);
  // cloudflare/bug-reports.mjs: one report's audit trail by revision.
  const bug = plan(db, "SELECT status,priority,response,created_at FROM bug_report_audit WHERE report_id=? ORDER BY revision DESC LIMIT 30");
  assert.match(bug, /USING INDEX bug_report_audit_report/);
  assert.doesNotMatch(bug, /TEMP B-TREE/);
  // 0016's late-log trigger: reports whose window contains an observation.
  assert.match(plan(db, "SELECT id FROM owner_monitor_reports WHERE json_extract(body,'$.start')<=? AND json_extract(body,'$.end')>?"), /USING INDEX owner_monitor_reports_window_end/);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('play_characters_campaign','moderation_audit_target','bug_report_audit_report','owner_monitor_reports_window_end')").all();
  assert.equal(names.length, 4);
  db.close();
});

test("0024 and 0025 serve the per-poll room queries from indexes (load audit F1, F5)", () => {
  assertAdditiveSql("0025_encounter_code_status_index.sql", readFileSync(`${directory}/0025_encounter_code_status_index.sql`, "utf8"));
  const db = schema();
  // cloud.server.ts activeEncounter: asked on every poll and every view; it scanned all encounters.
  const encounter = plan(db, "SELECT 1 AS active FROM dm_encounters WHERE code=? AND status='active' LIMIT 1");
  assert.match(encounter, /USING (COVERING )?INDEX dm_encounters_code_status/);
  assert.doesNotMatch(encounter, /SCAN dm_encounters/);
  // room-store.server.ts receipts: lookups by key and each seat's latest acknowledgements.
  assert.match(plan(db, "SELECT key, hash FROM campaign_room_receipts WHERE code=? AND kind=? AND key IN (?,?)"), /USING INDEX campaign_room_receipts_key/);
  const recent = plan(db, "SELECT key FROM campaign_room_receipts WHERE code=? AND seat_id=? AND kind='command' ORDER BY seq DESC LIMIT ?");
  assert.match(recent, /USING INDEX campaign_room_receipts_recent/);
  assert.doesNotMatch(recent, /TEMP B-TREE/);
  db.close();
});

test("0026 room sections are read and cleaned up through their primary key", () => {
  assertAdditiveSql("0026_campaign_room_sections.sql", readFileSync(`${directory}/0026_campaign_room_sections.sql`, "utf8"));
  const db = schema();
  // cloudflare/room-storage.mjs: parts of the hashes a manifest names, per room.
  const parts = plan(db, "SELECT hash,part,body FROM campaign_room_sections WHERE code=? AND hash IN (SELECT value FROM json_each(?))");
  assert.match(parts, /USING INDEX sqlite_autoindex_campaign_room_sections_1/);
  assert.doesNotMatch(parts, /SCAN campaign_room_sections/);
  // The single-statement room read: the row, then its manifest's sections.
  const room = plan(db, `SELECT r.code,r.body,NULL AS hash FROM campaign_rooms r WHERE r.code=? UNION ALL SELECT s.code,s.body,s.hash FROM campaign_room_sections s WHERE s.code=? AND s.hash IN (SELECT json_extract(m.value,'$.hash') FROM campaign_rooms r,json_each(r.body,'$."$sections"') m WHERE r.code=?)`);
  assert.match(room, /SEARCH s USING INDEX sqlite_autoindex_campaign_room_sections_1 \(code=\? AND hash=\?\)/);
  assert.doesNotMatch(room, /SCAN (r|s)\b/);
  // Cleanup after a write, the stored-hash listing and deletion with the room.
  for (const sql of [
    "DELETE FROM campaign_room_sections WHERE code = ? AND hash NOT IN (SELECT value FROM json_each(?))",
    "SELECT hash,COUNT(*) AS parts FROM campaign_room_sections WHERE code=? GROUP BY hash",
    "DELETE FROM campaign_room_sections WHERE code = ? AND NOT EXISTS (SELECT 1 FROM campaign_rooms WHERE code = ?)",
  ])
    assert.match(plan(db, sql), /USING (COVERING )?INDEX sqlite_autoindex_campaign_room_sections_1/, sql);
  db.close();
});
