import { deploymentOrigins } from "../src/lib/deployment/origins.mjs";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { migrationIdentity } from "./standby-artifact.mjs";

let recoveryStage = "configuration";
class SafeBackupError extends Error {}
const magic = Buffer.from("LOOTSPLIT-BACKUP-1\n");
export const primaryOrigin = deploymentOrigins.website;
export const productionDatabase = "0a200e96-ae2e-47b5-9869-c1f4d316148f";
const hash = (value) => createHash("sha256").update(value).digest("hex");
function keyBytes(key) { assert.match(key || "", /^[a-fA-F0-9]{64}$/, "Use a 32-byte hexadecimal backup key"); return Buffer.from(key, "hex"); }
export function seal(snapshot, key) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  cipher.setAAD(magic);
  const data = Buffer.concat([cipher.update(gzipSync(JSON.stringify(snapshot))), cipher.final()]);
  return Buffer.concat([magic, iv, cipher.getAuthTag(), data]);
}
export function unseal(bytes, key) {
  assert.ok(bytes.subarray(0, magic.length).equals(magic), "Unknown backup format");
  const offset = magic.length, decipher = createDecipheriv("aes-256-gcm", keyBytes(key), bytes.subarray(offset, offset + 12));
  decipher.setAAD(magic);
  decipher.setAuthTag(bytes.subarray(offset + 12, offset + 28));
  return JSON.parse(gunzipSync(Buffer.concat([decipher.update(bytes.subarray(offset + 28)), decipher.final()]), { maxOutputLength: 512 * 1024 * 1024 }));
}
export function validateDatabase(db, expected = migrationIdentity()) {
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok", "Database integrity check failed");
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0, "Database has broken references");
  assert.deepEqual(db.prepare("SELECT name FROM d1_migrations ORDER BY name").all().map((row) => row.name), expected.migrations, "Restore using the matching source release");
}
export function makeSnapshot(sql, sourceCommit, expected = migrationIdentity()) {
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  const db = new DatabaseSync(":memory:");
  try { db.exec(sql); validateDatabase(db, expected); } finally { db.close(); }
  return { version: 1, snapshotId: randomBytes(16).toString("hex"), createdAt: new Date().toISOString(), sourceCommit,
    sourceDatabase: productionDatabase, ...expected, sha256: hash(sql), sql };
}
export function restoreFile(snapshot, filename, expected = migrationIdentity()) {
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.sourceDatabase, productionDatabase, "Wrong source database");
  assert.equal(snapshot.sha256, hash(snapshot.sql), "Snapshot checksum mismatch");
  assert.match(snapshot.snapshotId, /^[a-f0-9]{32}$/);
  assert.equal(snapshot.migrationsHash, expected.migrationsHash, "Restore using the matching migration files");
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  // Exclusive creation: never overwrite a working database or an earlier restore.
  writeFileSync(filename, "", { flag: "wx", mode: 0o600 });
  let db;
  try {
    db = new DatabaseSync(filename);
    db.exec(snapshot.sql);
    validateDatabase(db, expected);
    db.exec("CREATE TABLE lootsplit_recovery (id INTEGER PRIMARY KEY CHECK(id=1),snapshot_id TEXT NOT NULL,created_at TEXT NOT NULL,source_commit TEXT NOT NULL,migrations_hash TEXT NOT NULL,fence_id TEXT NOT NULL DEFAULT '')");
    db.prepare("INSERT INTO lootsplit_recovery (id,snapshot_id,created_at,source_commit,migrations_hash) VALUES(1,?,?,?,?)").run(snapshot.snapshotId, snapshot.createdAt, snapshot.sourceCommit, expected.migrationsHash);
    db.close(); db = undefined;
  } catch (error) { db?.close(); rmSync(filename, { force: true }); throw error; }
}

export async function exportD1({ accountId, token, fetcher = fetch }) {
  assert.match(accountId || "", /^[a-f0-9]{32}$/);
  assert.ok(token, "Missing export token");
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${productionDatabase}/export`;
  let bookmark;
  for (let attempt = 0; attempt < 180; attempt++) {
    const response = await fetcher(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ output_format: "polling", current_bookmark: bookmark }), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new SafeBackupError(`D1 export HTTP ${response.status}`);
    const body = await response.json();
    assert.ok(body.success && body.result?.success, "D1 export failed");
    const state = body.result;
    if (state.status === "complete") {
      const url = new URL(state.result.signed_url);
      assert.equal(url.protocol, "https:");
      // This URL grants temporary access to the full database. Never log it.
      const download = await fetcher(url, { signal: AbortSignal.timeout(120000) });
      assert.ok(download.ok, "Snapshot download failed");
      return download.text();
    }
    assert.notEqual(state.status, "error", "D1 export failed");
    assert.ok(typeof state.at_bookmark === "string" && state.at_bookmark.length > 0, "Missing export bookmark");
    bookmark = state.at_bookmark;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("D1 export timeout");
}

export async function authorizeRestore(filename, fenceId, fetcher = fetch) {
  assert.match(fenceId || "", /^[a-f0-9]{64}$/);
  const response = await fetcher(`${primaryOrigin}/.well-known/lootsplit-recovery`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  assert.ok(response.ok, "Cannot confirm the primary is fenced");
  const state = await response.json();
  assert.equal(state.mode, "fenced", "Primary is still accepting writes");
  assert.equal(state.fenceId, fenceId, "Wrong recovery fence");
  // Must be a completed local restore, not an arbitrary live database.
  const db = new DatabaseSync(filename, { readOnly: false });
  try {
    validateDatabase(db);
    const metadata = db.prepare("SELECT * FROM lootsplit_recovery WHERE id=1").get();
    assert.ok(metadata?.snapshot_id, "No restore metadata");
    assert.equal(metadata.migrations_hash, migrationIdentity().migrationsHash);
    db.prepare("UPDATE lootsplit_recovery SET fence_id=? WHERE id=1").run(fenceId);
    return metadata.snapshot_id;
  } finally { db.close(); }
}

async function main() {
  const mode = process.argv[2], path = process.argv[3];
  if (mode === "export") {
    keyBytes(process.env.BACKUP_ENCRYPTION_KEY); // Fail before asking D1 to pause queries.
    recoveryStage = "primary release identity";
    const identity = await fetch(`${primaryOrigin}/assets/release-identity.json`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
    assert.ok(identity.ok, "Primary release identity unavailable");
    const { commit } = await identity.json();
    recoveryStage = "Cloudflare export";
    const sql = await exportD1({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN });
    recoveryStage = "snapshot schema and integrity validation";
    const snapshot = makeSnapshot(sql, commit);
    recoveryStage = "encryption and restore verification";
    const encrypted = seal(snapshot, process.env.BACKUP_ENCRYPTION_KEY);
    const recovered = unseal(encrypted, process.env.BACKUP_ENCRYPTION_KEY);
    assert.equal(recovered.sha256, hash(recovered.sql));
    makeSnapshot(recovered.sql, recovered.sourceCommit);
    recoveryStage = "encrypted artifact write";
    mkdirSync("recovery/encrypted", { recursive: true, mode: 0o700 });
    writeFileSync(`recovery/encrypted/${snapshot.snapshotId}.enc`, encrypted, { flag: "wx", mode: 0o600 });
    const message = `Encrypted snapshot ${snapshot.snapshotId} captured ${snapshot.createdAt}; source ${commit}.\n`;
    console.log(message.trim());
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message);
  } else if (mode === "restore") {
    const snapshot = unseal(readFileSync(path), process.env.BACKUP_ENCRYPTION_KEY);
    restoreFile(snapshot, process.argv[4]);
    console.log(`Verified local restore ${snapshot.snapshotId} from ${snapshot.createdAt}. Locked until authorized.`);
  } else if (mode === "authorize") {
    const id = await authorizeRestore(path, process.env.PRIMARY_FENCE_ID);
    console.log(`Restore ${id} is authorized for the verified primary fence. Import into a NEW Turso database.`);
  } else throw new Error("Use export, restore <encrypted-file> <new-db-file>, or authorize <restored-db-file>");
}
if (process.argv[1]?.endsWith("/standby-backup.mjs")) main().catch((error) => {
  // Never print SDK/API errors that could contain SQL, signed URLs or credentials.
  console.error(`Backup/recovery failed at ${recoveryStage}${error instanceof SafeBackupError ? `: ${error.message}` : ""}. No live database was overwritten.`);
  process.exitCode = 1;
});
