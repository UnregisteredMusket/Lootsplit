import { deploymentOrigins } from "../src/lib/deployment/origins.mjs";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { migrationIdentity, migrationIdentityOf } from "./standby-artifact.mjs";

let recoveryStage = "configuration";
export class SafeBackupError extends Error {}
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
/**
 * The migration identity of a commit, read from git rather than the checkout (audit G13): the
 * backup runs from main, which can hold a migration that is merged but not deployed yet, while the
 * live database matches the live commit. Fetches the commit when the shallow checkout lacks it.
 */
export function migrationIdentityAt(commit, git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })) {
  assert.match(commit || "", /^[a-f0-9]{40}$/, "Live commit must be a full commit SHA");
  try { git(["cat-file", "-e", `${commit}^{commit}`]); } catch { git(["fetch", "--no-tags", "--depth=1", "origin", commit]); }
  const names = git(["ls-tree", "--name-only", commit, "cloudflare/migrations/"]).split("\n").filter(Boolean).map((path) => path.slice(path.lastIndexOf("/") + 1));
  return migrationIdentityOf(names, (name) => git(["show", `${commit}:cloudflare/migrations/${name}`]));
}
/**
 * The live commit whose migrations the exported database holds. The release identity is read
 * before and after the export; a snapshot matching neither (a release applied migrations but the
 * new Worker was not live yet) is refused rather than stored with a wrong source commit.
 */
export function liveSource(sql, commits, identityAt = migrationIdentityAt) {
  const db = new DatabaseSync(":memory:");
  let applied;
  try { db.exec(sql); applied = db.prepare("SELECT name FROM d1_migrations ORDER BY name").all().map((row) => row.name); } finally { db.close(); }
  for (const commit of [...new Set(commits)]) {
    const expected = identityAt(commit);
    if (JSON.stringify(expected.migrations) === JSON.stringify(applied)) return { commit, expected };
  }
  throw new SafeBackupError(`The database's ${applied.length} applied migrations match no live commit (${[...new Set(commits)].map((c) => c.slice(0, 7)).join(", ")}); a release may have been applying migrations. Nothing was stored; re-run after it finishes`);
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

/** Exports the production database through the D1 polling API. Large exports can take several minutes, so the
 * loop waits up to `deadlineMs` (default 12 minutes, inside the workflow's 20-minute job limit) and reports a
 * timeout or Cloudflare-side failure by stage and status only; the signed snapshot URL is never logged. */
/** fetch rejects with TypeError on a network failure and TimeoutError when AbortSignal.timeout fires. */
const TRANSIENT_FETCH_ERRORS = new Set(["TimeoutError", "TypeError"]);
const STATUS_ATTEMPTS = 3;
export async function exportD1({ accountId, token, fetcher = fetch, deadlineMs = 12 * 60_000, pollMs = 2000, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  assert.match(accountId || "", /^[a-f0-9]{32}$/);
  assert.ok(token, "Missing export token");
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${productionDatabase}/export`;
  const started = now();
  let bookmark, lastStatus = "not started", polls = 0;
  const poll = () => fetcher(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ output_format: "polling", current_bookmark: bookmark }), signal: AbortSignal.timeout(30000) });
  while (now() - started < deadlineMs) {
    polls++;
    let response;
    // A status check (bookmark known) only reads the running export, so a dropped connection or a
    // slow answer is retried, up to STATUS_ATTEMPTS in all and never past the deadline. The first
    // request starts the export and is not repeated.
    for (let attempt = 1; ; attempt++) {
      try { response = await poll(); break; } catch (error) {
        const transient = bookmark !== undefined && TRANSIENT_FETCH_ERRORS.has(error?.name);
        if (!transient) throw error;
        if (attempt >= STATUS_ATTEMPTS || now() - started >= deadlineMs)
          throw new SafeBackupError(`D1 export status check failed ${attempt} time(s) (${error.name})`);
        await sleep(pollMs);
      }
    }
    if (!response.ok) throw new SafeBackupError(`D1 export HTTP ${response.status}`);
    const body = await response.json();
    if (!(body.success && body.result?.success)) throw new SafeBackupError("D1 export was refused by Cloudflare");
    const state = body.result;
    lastStatus = typeof state.status === "string" ? state.status.slice(0, 40) : "unknown";
    if (state.status === "complete") {
      const url = new URL(state.result.signed_url);
      assert.equal(url.protocol, "https:");
      // This URL grants temporary access to the full database. Never log it.
      const download = await fetcher(url, { signal: AbortSignal.timeout(180000) });
      if (!download.ok) throw new SafeBackupError(`Snapshot download HTTP ${download.status}`);
      return download.text();
    }
    if (state.status === "error") throw new SafeBackupError("D1 export reported an error");
    if (!(typeof state.at_bookmark === "string" && state.at_bookmark.length > 0)) throw new SafeBackupError("D1 export returned no bookmark");
    bookmark = state.at_bookmark;
    await sleep(pollMs);
  }
  throw new SafeBackupError(`D1 export still ${lastStatus} after ${Math.round((now() - started) / 1000)} s (${polls} polls)`);
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
    const liveCommit = async () => {
      const identity = await fetch(`${primaryOrigin}/assets/release-identity.json`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
      assert.ok(identity.ok, "Primary release identity unavailable");
      const { commit: live } = await identity.json();
      assert.match(live || "", /^[a-f0-9]{40}$/, "Primary release identity has no commit");
      return live;
    };
    const before = await liveCommit();
    recoveryStage = "live commit migrations";
    migrationIdentityAt(before); // Fail before asking D1 to pause queries if git cannot read it.
    recoveryStage = "Cloudflare export";
    const sql = await exportD1({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN });
    recoveryStage = "primary release identity";
    const after = await liveCommit();
    recoveryStage = "snapshot schema and integrity validation";
    const { commit, expected } = liveSource(sql, [before, after]);
    const snapshot = makeSnapshot(sql, commit, expected);
    recoveryStage = "encryption and restore verification";
    const encrypted = seal(snapshot, process.env.BACKUP_ENCRYPTION_KEY);
    const recovered = unseal(encrypted, process.env.BACKUP_ENCRYPTION_KEY);
    assert.equal(recovered.sha256, hash(recovered.sql));
    makeSnapshot(recovered.sql, recovered.sourceCommit, expected);
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
/** An error's class name for logs, limited to identifier characters. */
export function safeErrorName(error) {
  const name = typeof error?.name === "string" ? error.name : typeof error;
  return /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(name) ? name : "Error";
}
if (process.argv[1]?.endsWith("/standby-backup.mjs")) main().catch((error) => {
  // Never print SDK/API errors that could contain SQL, signed URLs or credentials.
  // Other errors show only their class name (TypeError, AssertionError…): enough to tell a network
  // failure from a validation failure without printing a message that could hold a URL or secret.
  const reason = error instanceof SafeBackupError ? `: ${error.message}` : ` (${safeErrorName(error)})`;
  console.error(`Backup/recovery failed at ${recoveryStage}${reason}. No live database was overwritten.`);
  process.exitCode = 1;
});
