// Synthetic data only. Never connect this rehearsal to the primary database.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client/http";
import { migrationIdentity } from "./standby-artifact.mjs";
import { makeSnapshot, seal, unseal, restoreFile } from "./standby-backup.mjs";
import { d1Database } from "../standby/database.mjs";

export async function verifyRemote({ databaseUrl, authToken, factory = createClient }) {
  const url = new URL(databaseUrl);
  assert.ok(["libsql:", "https:"].includes(url.protocol) && url.hostname.startsWith("lootsplit-standby-") && url.hostname.endsWith(".turso.io"), "Expected the dedicated standby database");
  assert.ok(authToken, "Missing Turso token");
  const config = { url: url.href, authToken };
  const client = factory(config);
  const directory = mkdtempSync(join(tmpdir(), "lootsplit-remote-check-"));
  const table = "lootsplit_probe_" + randomBytes(8).toString("hex");
  let created = false;
  try {
    // Refuse to rehearse on an activated or populated database.
    const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream_%' AND name NOT LIKE 'libsql_%'");
    assert.equal(tables.rows.length, 0, "Rehearsal requires an empty standby database");
    const identity = migrationIdentity();
    const sql = identity.migrations.map(name => readFileSync(`cloudflare/migrations/${name}`, "utf8")).join("\n") +
      "\nCREATE TABLE d1_migrations(name TEXT PRIMARY KEY);\n" + identity.migrations.map(name => `INSERT INTO d1_migrations VALUES('${name}');`).join("\n") +
      "\nINSERT INTO campaign_rooms(code,revision,body) VALUES('REHEARSE',1,'{\"synthetic\":true}');";
    const key = randomBytes(32).toString("hex");
    const snapshot = makeSnapshot(sql, process.env.GITHUB_SHA || "a".repeat(40));
    const recovered = unseal(seal(snapshot, key), key);
    restoreFile(recovered, join(directory, "synthetic.db"));
    const tx = await client.transaction("write");
    try {
      await tx.executeMultiple(recovered.sql);
      assert.equal((await tx.execute("PRAGMA integrity_check")).rows[0].integrity_check, "ok");
      assert.equal((await tx.execute("PRAGMA foreign_key_check")).rows.length, 0);
      assert.deepEqual((await tx.execute("SELECT name FROM d1_migrations ORDER BY name")).rows.map(r => r.name), identity.migrations);
      assert.equal((await tx.execute("SELECT body FROM campaign_rooms WHERE code='REHEARSE'")).rows[0].body, '{"synthetic":true}');
    } finally { await tx.rollback(); }
    assert.equal((await client.execute("SELECT name FROM sqlite_master WHERE name='campaign_rooms'")).rows.length, 0);

    await client.execute(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,n INTEGER NOT NULL)`);
    created = true;
    const db = d1Database(client);
    await db.batch([db.prepare(`INSERT INTO ${table} VALUES('receipt',5)`), db.prepare(`INSERT INTO ${table} SELECT 'total',5 WHERE changes()>0`)]);
    await db.batch([db.prepare(`INSERT OR IGNORE INTO ${table} VALUES('receipt',5)`), db.prepare(`UPDATE ${table} SET n=n+5 WHERE id='total' AND changes()>0`)]);
    await assert.rejects(db.batch([db.prepare(`INSERT INTO ${table} VALUES('rollback',1)`), db.prepare(`INSERT INTO ${table} VALUES('receipt',99)`)]));
    const second = factory(config);
    try {
      assert.deepEqual((await second.execute(`SELECT id,n FROM ${table} ORDER BY id`)).rows.map(r => [r.id,r.n]), [["receipt",5],["total",5]]);
    } finally { second.close(); }
    const message = "PASS remote Turso: encrypted synthetic restore, complete schema, integrity/references, transaction rollback, durable reconnect and duplicate-award guards. Primary untouched; standby remains locked.\n";
    console.log(message.trim());
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message);
  } finally {
    // This uniquely named table was created by this run and contains only its fixtures.
    try { if (created) await client.execute(`DROP TABLE ${table}`); }
    finally { client.close(); rmSync(directory, { recursive: true, force: true }); }
  }
}
if (process.argv[1]?.endsWith("/standby-remote-check.mjs")) verifyRemote({ databaseUrl: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }).catch(() => {
  console.error("Remote rehearsal failed. Check the saved Turso secrets, libSQL engine and empty standby database. Raw errors and credentials are intentionally not logged.");
  process.exitCode = 1;
});
