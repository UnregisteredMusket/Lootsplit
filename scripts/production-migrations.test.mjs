import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { assertAdditiveSql, pendingMigrations, sqlStructure } from "./production-migrations.mjs";

const allowed = {
  "new table": "CREATE TABLE things (id TEXT PRIMARY KEY, body TEXT NOT NULL DEFAULT '');",
  "new table if missing": "create table if not exists \"things\" (\"id\" text not null primary key);",
  "foreign key actions": "CREATE TABLE a (id TEXT PRIMARY KEY, user_id TEXT REFERENCES user(id) ON DELETE CASCADE ON UPDATE SET NULL, b TEXT REFERENCES user(id) ON DELETE SET NULL);",
  "index": "CREATE INDEX IF NOT EXISTS things_owner ON things(user_id, created_at);",
  "unique partial index": "CREATE UNIQUE INDEX one_pending ON imports(user_id,code) WHERE status='pending';",
  "expression index": "CREATE INDEX IF NOT EXISTS report_end ON owner_monitor_reports(json_extract(body,'$.end'));",
  "add column": "ALTER TABLE site_settings ADD COLUMN donation_url TEXT NOT NULL DEFAULT '';",
  "add column without keyword": "alter table site_settings add extra integer;",
  "insert into new table": "CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), title TEXT NOT NULL DEFAULT '');\nINSERT INTO settings (id) VALUES (1);",
  "keywords inside strings and comments": "-- DROP TABLE user; DELETE FROM user\n/* UPDATE user SET x=1 */\nCREATE TABLE notes (kind TEXT NOT NULL DEFAULT 'delete; drop table user' CHECK(kind IN ('update','select')));",
  "quoted identifiers named like keywords": "CREATE TABLE \"delete\" (\"update\" TEXT, [drop] TEXT, `select` TEXT);",
  "comment only": "-- nothing to do\n",
};
const denied = {
  "drop table": "DROP TABLE campaign_rooms;",
  "drop index": "DROP INDEX IF EXISTS push_room;",
  "drop column": "ALTER TABLE user DROP COLUMN image;",
  "rename table": "ALTER TABLE site_roles RENAME TO site_roles_old;",
  "rename column": "ALTER TABLE user RENAME COLUMN name TO display_name;",
  "delete": "DELETE FROM campaign_rooms;",
  "delete hidden after create": "CREATE TABLE x (id TEXT);DELETE FROM user;",
  "update": "UPDATE user SET name = '';",
  "upsert update": "CREATE TABLE x (id TEXT PRIMARY KEY);\nINSERT INTO x (id) VALUES ('a') ON CONFLICT(id) DO UPDATE SET id = 'b';",
  "insert into existing table": "INSERT INTO site_roles (user_id, role, granted_at) VALUES ('u', 'owner', 0);",
  "insert into IF NOT EXISTS table": "CREATE TABLE IF NOT EXISTS user (id TEXT);\nINSERT INTO user (id) VALUES ('x');",
  "insert or replace": "CREATE TABLE x (id TEXT);\nINSERT OR REPLACE INTO x VALUES ('a');",
  "insert select copy": "CREATE TABLE x (id TEXT);\nINSERT INTO x SELECT id FROM user;",
  "values subquery": "CREATE TABLE x (id TEXT);\nINSERT INTO x VALUES ((SELECT id FROM user LIMIT 1));",
  "replace": "REPLACE INTO site_settings (id) VALUES (1);",
  "create table as select": "CREATE TABLE copy AS SELECT * FROM user;",
  "trigger": "CREATE TRIGGER t AFTER INSERT ON user BEGIN DELETE FROM session; END;",
  "view": "CREATE VIEW v AS SELECT * FROM user;",
  "virtual table": "CREATE VIRTUAL TABLE f USING fts5(body);",
  "temp table": "CREATE TEMP TABLE t (id TEXT);",
  "pragma": "PRAGMA foreign_keys = OFF;",
  "attach": "ATTACH DATABASE 'x' AS other;",
  "transaction": "BEGIN TRANSACTION; CREATE TABLE x (id TEXT); COMMIT;",
  "vacuum": "VACUUM;",
  "reindex": "REINDEX push_room;",
  "cte": "WITH a AS (SELECT 1) INSERT INTO x VALUES (1);",
  "schema qualified": "CREATE TABLE main.x (id TEXT);",
  "unterminated string": "CREATE TABLE x (id TEXT DEFAULT 'oops);",
  "unterminated comment": "/* CREATE TABLE x (id TEXT);",
};

test("additive-only checker accepts creates, indexes, added columns and inserts into new tables", () => {
  for (const [label, sql] of Object.entries(allowed))
    assert.doesNotThrow(() => assertAdditiveSql(label, sql), label);
});
test("additive-only checker rejects drops, renames, data changes, triggers, views and pragmas", () => {
  for (const [label, sql] of Object.entries(denied))
    assert.throws(() => assertAdditiveSql(label, sql), undefined, label);
});
test("history: the rename/drop and trigger migrations would have been stopped; the rest pass", () => {
  const directory = "cloudflare/migrations";
  const names = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
  const rejected = names.filter((name) => {
    try { assertAdditiveSql(name, readFileSync(`${directory}/${name}`, "utf8")); return false; } catch { return true; }
  });
  assert.deepEqual(rejected, ["0005_member_management.sql", "0016_owner_monitoring.sql"]);
});
test("masking keeps structure and hides literal and identifier contents", () => {
  assert.equal(sqlStructure("SELECT 'it''s' -- x\n"), "SELECT ''  \n");
  assert.doesNotMatch(sqlStructure('CREATE TABLE "drop" (x)'), /drop/i);
});
test("pending migrations are the ordered unapplied tail; extra, reused or out-of-order names fail closed", () => {
  const all = ["0001_a.sql", "0002_b.sql", "0003_c.sql"];
  assert.deepEqual(pendingMigrations(all, ["0002_b.sql", "0001_a.sql"]), ["0003_c.sql"]);
  assert.deepEqual(pendingMigrations(all, all), []);
  assert.deepEqual(pendingMigrations(all, []), all);
  assert.throws(() => pendingMigrations(all, [...all, "0004_d.sql"]), /does not contain/);
  assert.throws(() => pendingMigrations(["0001_a.sql", "0002_b.sql", "0003_c.sql"], ["0001_a.sql", "0003_c.sql"]), /sorts before/);
  assert.throws(() => pendingMigrations(["0001_a.sql", "0001_b.sql"], []), /share a number/);
  assert.throws(() => pendingMigrations(["0001_A.sql"], []), /file name/);
  assert.throws(() => pendingMigrations(["notes.txt"], []), /file name/);
});
test("the release job applies migrations after verifying the artifact and before preflight and deploy", () => {
  const workflow = readFileSync(".github/workflows/website-release.yml", "utf8");
  const at = (text) => {
    const index = workflow.indexOf(text);
    assert.ok(index > 0, `missing: ${text}`);
    return index;
  };
  const verify = at("node scripts/release-artifact.mjs verify");
  const apply = at("node scripts/recovery-step.mjs production-migrations 300 node scripts/production-migrations.mjs");
  const preflight = at("node scripts/recovery-step.mjs production-preflight 120 node scripts/production-preflight.mjs");
  const deploy = at("npx wrangler deploy --config dist/website-release/wrangler.toml");
  assert.ok(verify < apply && apply < preflight && preflight < deploy);
  assert.match(workflow, /group: lootsplit-production\n\s+cancel-in-progress: false/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  // Only the release job may write to production D1; PR/verification workflows use local D1.
  for (const name of readdirSync(".github/workflows")) {
    const text = readFileSync(`.github/workflows/${name}`, "utf8");
    if (name !== "website-release.yml") {
      assert.doesNotMatch(text, /production-migrations\.mjs/, name);
      assert.doesNotMatch(text, /migrations apply[^\n]*--remote/, name);
    }
  }
  assert.doesNotMatch(readFileSync("scripts/production-preflight.mjs", "utf8"), /migrations apply/);
});

test("the repository's migrations would pass the release check (unique numbers, valid names)", () => {
  const names = readdirSync(new URL("../cloudflare/migrations/", import.meta.url)).filter((n) =>
    n.endsWith(".sql"),
  );
  assert.ok(names.length > 0);
  assert.deepEqual(pendingMigrations(names, []), [...names].sort());
});
