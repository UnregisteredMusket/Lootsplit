import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@libsql/client";
import { d1Database } from "../standby/database.mjs";
import { roomEntryLimit, incomingRequest, staticAssets } from "../standby/http.mjs";
import { validateActivation } from "../standby/state.mjs";
import { recoveryGuard } from "../cloudflare/recovery-guard.mjs";
import { handleAccounts } from "../cloudflare/accounts.mjs";
import { migrationIdentity } from "./standby-artifact.mjs";
import { seal, unseal, makeSnapshot, restoreFile, authorizeRestore, exportD1 } from "./standby-backup.mjs";

const schema = () => migrationIdentity().migrations.map((name) => readFileSync(`cloudflare/migrations/${name}`, "utf8")).join("\n") +
  "\nCREATE TABLE d1_migrations(name TEXT PRIMARY KEY);\n" + migrationIdentity().migrations.map((name) => `INSERT INTO d1_migrations VALUES('${name}');`).join("\n");

test("libSQL adapter keeps bindings immutable, rolls back complete batches, and preserves changes guards", async () => {
  const client = createClient({ url: ":memory:" }), db = d1Database(client);
  try {
    await client.executeMultiple("CREATE TABLE awards(id TEXT PRIMARY KEY, amount INTEGER); CREATE TABLE totals(n INTEGER); INSERT INTO totals VALUES(0);");
    const insert = db.prepare("INSERT OR IGNORE INTO awards VALUES(?,?)");
    const a = insert.bind("one", 5), b = insert.bind("two", 7);
    await db.batch([a, db.prepare("UPDATE totals SET n=n+5 WHERE changes()>0")]);
    await db.batch([a, db.prepare("UPDATE totals SET n=n+5 WHERE changes()>0")]);
    await b.run();
    assert.equal(await db.prepare("SELECT n FROM totals").first("n"), 5);
    assert.deepEqual(await db.prepare("SELECT * FROM awards ORDER BY id").raw({ columnNames: true }), [["id", "amount"], ["one", 5], ["two", 7]]);
    await assert.rejects(db.batch([insert.bind("three", 8), db.prepare("INSERT INTO awards VALUES('one',99)")]));
    assert.equal(await db.prepare("SELECT * FROM awards WHERE id='three'").first(), null);
    assert.equal((await db.prepare("SELECT * FROM awards").all()).results.length, 2);
    await assert.rejects(db.batch([{ sql: "DROP TABLE awards" }]), /Foreign/);
  } finally { db.close(); }
});

test("accounts retain durable authentication, private library isolation and CSRF protection on libSQL", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(schema());
  const env = { DB: d1Database(client), ACCOUNT_ORIGIN: "http://localhost:8095", ACCOUNT_SECRET: "synthetic-test-signing-secret-1234567890" };
  let index = 0;
  async function call(path, body, cookie, origin = env.ACCOUNT_ORIGIN) {
    return handleAccounts(new Request(env.ACCOUNT_ORIGIN + "/api/account/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { origin, "content-type": "application/json", "cf-connecting-ip": `192.0.2.${++index}`, ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
  }
  try {
    const first = await call("auth/sign-up/email", { email: "standby-a@example.com", name: "Standby A", password: "synthetic standby password" });
    assert.equal(first.status, 200, await first.clone().text());
    const cookie = first.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    assert.ok(cookie);
    assert.equal((await call("library", undefined, cookie)).status, 200);
    assert.equal((await call("library")).status, 401);
    assert.equal((await call("character", { name: "Injected" }, cookie, "https://evil.example")).status, 403);
    assert.equal((await call("character", { name: "Private standby hero", notes: "private" }, cookie)).status, 200);
    const second = await call("auth/sign-up/email", { email: "standby-b@example.com", name: "Standby B", password: "synthetic standby password" });
    assert.equal(second.status, 200);
    const secondCookie = second.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    assert.equal((await (await call("library", undefined, secondCookie)).json()).characters.length, 0);
    assert.equal((await (await call("library", undefined, cookie)).json()).characters.length, 1);
  } finally { client.close(); }
});

test("encrypted snapshots reject tampering and wrong keys; restores never overwrite and require a matching fence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lootsplit-recovery-test-"));
  const filename = join(directory, "restored.db"), key = randomBytes(32).toString("hex");
  const snapshot = makeSnapshot(schema(), "a".repeat(40));
  const sealed = seal(snapshot, key);
  assert.deepEqual(unseal(sealed, key), snapshot);
  assert.throws(() => unseal(sealed, randomBytes(32).toString("hex")));
  const tampered = Buffer.from(sealed); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => unseal(tampered, key));
  try {
    restoreFile(snapshot, filename);
    assert.throws(() => restoreFile(snapshot, filename), /EEXIST/);
    const db = new DatabaseSync(filename);
    assert.equal(db.prepare("SELECT count(*) AS n FROM site_settings").get().n, 1);
    db.close();
    const config = { STANDBY_SNAPSHOT_ID: snapshot.snapshotId, PRIMARY_FENCE_ID: "b".repeat(64) };
    const client = createClient({ url: `file:${filename}` });
    try { await assert.rejects(validateActivation(client, config, migrationIdentity()), /fencing/); } finally { client.close(); }
    await assert.rejects(authorizeRestore(filename, config.PRIMARY_FENCE_ID, async () => Response.json({ mode: "primary" })), /still accepting/);
    await authorizeRestore(filename, config.PRIMARY_FENCE_ID, async () => Response.json({ mode: "fenced", fenceId: config.PRIMARY_FENCE_ID }));
    const restored = createClient({ url: `file:${filename}` });
    try {
      await validateActivation(restored, config, migrationIdentity());
      await assert.rejects(validateActivation(restored, { ...config, STANDBY_SNAPSHOT_ID: "c".repeat(32) }, migrationIdentity()), /Wrong snapshot/);
      await assert.rejects(validateActivation(restored, config, { ...migrationIdentity(), migrationsHash: "different" }), /schema/);
    } finally { restored.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("primary recovery fence blocks reads and writes before app handlers; unset leaves service alone", async () => {
  for (const path of ["/api/account/auth/sign-up/email", "/_server/test", "/", "/assets/app.js"]) {
    const request = new Request("https://example.com" + path, { method: "POST" });
    assert.equal(await recoveryGuard(request, {}), null);
    const blocked = await recoveryGuard(request, { RECOVERY_FENCE: "test-fence" });
    assert.equal(blocked.status, 503);
    assert.equal(blocked.headers.get("cache-control"), "no-store");
  }
  const response = await recoveryGuard(new Request("https://example.com/.well-known/lootsplit-recovery"), { RECOVERY_FENCE: "test-fence" });
  const state = await response.json();
  assert.equal(state.mode, "fenced"); assert.match(state.fenceId, /^[a-f0-9]{64}$/);
});

test("Node transport cannot spoof account IP/origin, static traversal is blocked and entry limits expire", async () => {
  const request = incomingRequest({ method: "GET", url: "/welcome", headers: { host: "evil.example", "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "spoofed, 192.0.2.7" }, socket: { remoteAddress: "127.0.0.1" } }, "https://standby.example", true);
  assert.equal(request.url, "https://standby.example/welcome");
  assert.equal(request.headers.get("cf-connecting-ip"), "192.0.2.7");
  const direct = incomingRequest({ method: "GET", url: "/welcome", headers: { "cf-connecting-ip": "192.0.2.8", "x-forwarded-for": "192.0.2.9" }, socket: { remoteAddress: "127.0.0.1" } }, "https://standby.example");
  assert.equal(direct.headers.get("cf-connecting-ip"), "127.0.0.1");
  const assets = staticAssets("public");
  assert.equal((await assets.fetch(new Request("https://standby.example/%2e%2e%2fpackage.json"))).status, 404);
  let time = 0; const limiter = roomEntryLimit(() => time);
  for (let i = 0; i < 60; i++) assert.ok((await limiter.limit({ key: "client" })).success);
  assert.equal((await limiter.limit({ key: "client" })).success, false);
  time = 60000; assert.ok((await limiter.limit({ key: "client" })).success);
});

test("export polls a consistent bookmark and does not forward API credentials to signed storage", async () => {
  let step = 0;
  const sql = await exportD1({ accountId: "a".repeat(32), token: "test-token", fetcher: async (url, options) => {
    step++;
    if (step === 1) return Response.json({ success: true, result: { success: true, status: "active", at_bookmark: "same-snapshot" } });
    if (step === 2) {
      assert.equal(JSON.parse(options.body).current_bookmark, "same-snapshot");
      return Response.json({ success: true, result: { success: true, status: "complete", result: { signed_url: "https://storage.example/secret" } } });
    }
    assert.equal(options.headers, undefined);
    return new Response("synthetic SQL");
  } });
  assert.equal(sql, "synthetic SQL"); assert.equal(step, 3);
});
