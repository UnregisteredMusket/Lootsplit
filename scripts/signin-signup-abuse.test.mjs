// Sign-up and storage abuse (audit 2026-11-10 H1, H5 and H2; owner decisions 2026-11-11).
// H1: app-origin sign-ups and sign-ins skip the human check, so they get a much smaller per-network
// allowance. H5: sign-up said whether an email was registered; each network gets a few such
// replies a day. H2: nothing capped total storage; new account backups and character uploads are
// refused once the hourly Cloudflare reading puts the database past STORAGE_GUARD_BYTES, never
// play or campaign saves. Every case runs on the local D1 stand-in; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import {
  APP_CREDENTIAL_LIMITS,
  DUPLICATE_SIGNUP_REPLIES_PER_DAY,
  appCredentialAllowance,
  limitedSignup,
} from "../cloudflare/credential-limits.mjs";
import { saveLibraryBackup, saveLibraryCharacter } from "../cloudflare/accounts.mjs";
import { STORAGE_GUARD_BYTES, storageCheck } from "../cloudflare/monitor-model.mjs";
import { storageGuard } from "../cloudflare/storage-guard.mjs";
import { expireRateLimits } from "../cloudflare/rate-limit-expiry.mjs";

const SIGN_UP = "/api/account/auth/sign-up/email";
const SIGN_IN = "/api/account/auth/sign-in/email";
const RECOVER = "/api/account/recover";
const DAY = 86_400_000;
const start = Date.parse("2026-11-11T09:00:00Z");

const refused = (promise, pattern) =>
  assert.rejects(promise, (e) => e.status === 429 && pattern.test(e.message) && e.retryAfter > 0);

test("H1: app-origin sign-ups are limited per network per day", async () => {
  const db = localAccountDb();
  for (let i = 0; i < APP_CREDENTIAL_LIMITS.signUpsPerDay; i++)
    await appCredentialAllowance(db, SIGN_UP, "203.0.113.5", start + i);
  await refused(appCredentialAllowance(db, SIGN_UP, "203.0.113.5", start + 10), /accounts in the app today/);
  // Another network, and the same network the next day, are not affected.
  await appCredentialAllowance(db, SIGN_UP, "203.0.113.6", start + 10);
  await appCredentialAllowance(db, SIGN_UP, "203.0.113.5", start + DAY);
  // One IPv6 /64 is one network.
  for (let i = 0; i < APP_CREDENTIAL_LIMITS.signUpsPerDay; i++)
    await appCredentialAllowance(db, SIGN_UP, `2001:db8:5:5::${i + 1}`, start);
  await refused(appCredentialAllowance(db, SIGN_UP, "2001:db8:5:5:abcd::1", start), /today/);
});

test("H1: app-origin sign-ins and recovery resets share an hourly allowance; other paths are not counted", async () => {
  const db = localAccountDb();
  for (let i = 0; i < 50; i++) await appCredentialAllowance(db, "/api/account/auth/get-session", "198.51.100.1", start);
  for (let i = 0; i < APP_CREDENTIAL_LIMITS.signInsPerHour; i++)
    await appCredentialAllowance(db, i % 2 ? SIGN_IN : RECOVER, "198.51.100.1", start + i);
  await refused(appCredentialAllowance(db, SIGN_IN, "198.51.100.1", start + 100), /Too many sign-ins from this network/);
  // Sign-ups have their own count, and the next hour starts again.
  await appCredentialAllowance(db, SIGN_UP, "198.51.100.1", start + 100);
  await appCredentialAllowance(db, SIGN_IN, "198.51.100.1", start + 3_600_000);
});

test("H1/H5: the hourly rate-limit expiry keeps a running day's counts", async () => {
  const db = localAccountDb();
  for (let i = 0; i < APP_CREDENTIAL_LIMITS.signUpsPerDay; i++)
    await appCredentialAllowance(db, SIGN_UP, "203.0.113.5", start);
  await expireRateLimits(db, start + 3 * 3_600_000);
  await refused(appCredentialAllowance(db, SIGN_UP, "203.0.113.5", start + 3 * 3_600_000), /today/);
  // An hour after the day ends the row is removed.
  await expireRateLimits(db, Math.ceil(start / DAY) * DAY + 3_600_000 + 60_000);
  const left = await db.prepare("SELECT COUNT(*) AS n FROM library_limits WHERE key LIKE 'app-signup:%'").first();
  assert.equal(Number(left.n), 0);
});

/** Better Auth stand-in: 200 and a user row for a new email, 422 for a registered one. */
function fakeSignup(db) {
  return (email) => async () => {
    const normal = email.trim().toLowerCase();
    if (await db.prepare("SELECT 1 FROM user WHERE email=?").bind(normal).first())
      return Response.json({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" }, { status: 422 });
    await db
      .prepare(`INSERT INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?,'X',?,0,null,0,0)`)
      .bind(crypto.randomUUID(), normal)
      .run();
    return Response.json({ ok: true });
  };
}

test("H5: a network gets a few 'already registered' replies a day, then every sign-up is refused alike", async () => {
  const db = localAccountDb();
  const signUp = fakeSignup(db);
  const at = () => start;
  const ip = "192.0.2.44";
  await limitedSignup(db, "known@example.com", ip, signUp("known@example.com"), at);
  // Signing up new addresses never uses the allowance.
  for (let i = 0; i < 6; i++)
    assert.equal((await limitedSignup(db, `new${i}@example.com`, ip, signUp(`new${i}@example.com`), at)).status, 200);
  for (let i = 0; i < DUPLICATE_SIGNUP_REPLIES_PER_DAY; i++)
    assert.equal((await limitedSignup(db, "Known@Example.com", ip, signUp("Known@Example.com"), at)).status, 422);
  // Now registered and unregistered emails get the same refusal, without calling Better Auth.
  let called = 0;
  for (const email of ["known@example.com", "unregistered@example.com"])
    await refused(
      limitedSignup(db, email, ip, () => (called++, signUp(email)()), at),
      /Too many sign-up attempts from this network today/,
    );
  assert.equal(called, 0);
  assert.equal(await db.prepare("SELECT 1 FROM user WHERE email='unregistered@example.com'").first(), null);
  // Another network still gets a normal reply; the next day this one does too.
  assert.equal((await limitedSignup(db, "known@example.com", "192.0.2.45", signUp("known@example.com"), at)).status, 422);
  assert.equal((await limitedSignup(db, "later@example.com", ip, signUp("later@example.com"), () => start + DAY)).status, 200);
});

test("H5: parallel probes cannot pass the cap; a failed sign-up is refunded", async () => {
  const db = localAccountDb();
  const signUp = fakeSignup(db);
  await limitedSignup(db, "known@example.com", "192.0.2.50", signUp("known@example.com"), () => start);
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => limitedSignup(db, "known@example.com", "192.0.2.51", signUp("known@example.com"), () => start)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, DUPLICATE_SIGNUP_REPLIES_PER_DAY);
  await assert.rejects(limitedSignup(db, "x@example.com", "192.0.2.52", () => Promise.reject(new Error("down")), () => start));
  for (let i = 0; i < DUPLICATE_SIGNUP_REPLIES_PER_DAY; i++)
    assert.equal((await limitedSignup(db, "known@example.com", "192.0.2.52", signUp("known@example.com"), () => start)).status, 422);
});

test("H5: a burst of new sign-ups never leaves the network refused (privacy review of PR 494)", async () => {
  const db = localAccountDb();
  const slow = async () => (await new Promise((r) => setTimeout(r, 20)), new Response(null, { status: 200 }));
  const run = (email) => limitedSignup(db, email, "203.0.113.9", slow, () => start).then((r) => r.status, (e) => e.status);
  // In-flight sign-ups count until they finish, so some of a burst may wait; none is kept.
  const burst = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => run(`p${i}@example.com`)));
  assert.ok(burst.filter((s) => s === 200).length >= DUPLICATE_SIGNUP_REPLIES_PER_DAY, String(burst));
  const row = await db.prepare("SELECT hits FROM library_limits WHERE key LIKE 'signup-duplicate:%'").first();
  assert.equal(Number(row.hits), 0, "every attempt that was not a duplicate is refunded, refused ones too");
  assert.equal(await run("late@example.com"), 200);
});

// ---- H2: site-wide storage guard ----

const usageRow = async (db, bytes, checkedAt, id = `usage:${checkedAt}`) => {
  await db
    .prepare("INSERT OR IGNORE INTO owner_monitor_registry(id,body,registered_at) VALUES('cloudflare-usage','{}',0)")
    .run();
  return db
    .prepare("INSERT INTO owner_monitor_logs(id,source,observed_at,collected_at,summary,body) VALUES(?,'cloudflare-usage',?,?,'usage',?)")
    .bind(
      id,
      checkedAt,
      checkedAt,
      JSON.stringify({
        usage:
          bytes === null
            ? { state: "unavailable", checkedAt, data: null, errorCode: "HTTP_500" }
            : { state: "ready", checkedAt, data: { metrics: [{ key: "d1StorageBytes", state: "ready", current: { value: bytes } }] } },
      }),
    )
    .run();
};
async function account(db, id) {
  await db
    .prepare(`INSERT INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?,'DM',?,1,null,0,0)`)
    .bind(id, `${id}@example.com`)
    .run();
  return id;
}
const small = { kind: "quire", version: 2, purses: [], holdings: [], ledger: [], shops: [], stock: [] };
const count = async (db, table) => Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n);
const full = (e) => e.status === 507 && /online storage is nearly full/.test(e.message) && /device/.test(e.message);

test("H2: past the guard share, new backups and character uploads are refused; edits that do not grow pass", async () => {
  const db = localAccountDb();
  const now = Date.now();
  const userId = await account(db, "guard-dm");
  const backup = await saveLibraryBackup(db, userId, { name: "Before", payload: small, campaignKey: "device:a" });
  const character = await saveLibraryCharacter(db, userId, { name: "Hero", description: "A long description." });
  await usageRow(db, STORAGE_GUARD_BYTES + 1, now - 60_000);
  await assert.rejects(saveLibraryBackup(db, userId, { name: "After", payload: small, campaignKey: "device:a" }), full);
  await assert.rejects(saveLibraryCharacter(db, userId, { name: "Second" }), full);
  await assert.rejects(saveLibraryCharacter(db, userId, { id: character.id, name: "Hero", description: "A much longer description than before." }), full);
  // Renaming to something no larger still works, and removing is never blocked.
  assert.deepEqual(await saveLibraryCharacter(db, userId, { id: character.id, name: "Hero", description: "Short." }), { id: character.id });
  assert.equal(await count(db, "library_backups"), 1);
  assert.equal(await count(db, "library_characters"), 1);
  assert.ok(backup.id);
  // Below the guard, uploads work again.
  await usageRow(db, STORAGE_GUARD_BYTES - 1, now - 30_000);
  await saveLibraryBackup(db, userId, { name: "After", payload: small, campaignKey: "device:a" });
  await saveLibraryCharacter(db, userId, { name: "Second" });
});

test("H2: a missing, failed or stale reading never blocks (the guard fails open)", async () => {
  const db = localAccountDb();
  const now = Date.now();
  const userId = await account(db, "open-dm");
  assert.equal((await storageGuard(db, now)).state, "unknown");
  await saveLibraryCharacter(db, userId, { name: "No reading yet" });
  await usageRow(db, STORAGE_GUARD_BYTES * 2, now - 3 * 3_600_000);
  assert.equal((await storageGuard(db, now)).state, "unknown", "older than two hours is stale");
  await saveLibraryBackup(db, userId, { name: "Stale reading", payload: small });
  await usageRow(db, null, now - 60_000);
  assert.equal((await storageGuard(db, now)).state, "unknown");
  await saveLibraryCharacter(db, userId, { name: "Failed reading" });
  await usageRow(db, STORAGE_GUARD_BYTES, now - 30_000);
  assert.equal((await storageGuard(db, now)).state, "refusing");
});

test("H2: the owner is alerted: Database storage turns red with the refusal named", () => {
  const reading = (bytes) => ({ state: "ready", checkedAt: 1, data: { metrics: [{ key: "d1StorageBytes", state: "ready", current: { value: bytes } }] } });
  const below = storageCheck(reading(STORAGE_GUARD_BYTES - 1));
  assert.equal(below.state, "warning");
  const past = storageCheck(reading(STORAGE_GUARD_BYTES));
  assert.equal(past.state, "error");
  assert.equal(past.errorCode, "STORAGE_GUARD");
  assert.match(past.symptom, /new account backups and character uploads are refused/);
  assert.equal(STORAGE_GUARD_BYTES, 4_000_000_000);
});
