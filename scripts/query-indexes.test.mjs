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
