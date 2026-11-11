import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localAccountDb } from "./account-dev-db.mjs";
import { assertAdditiveSql } from "./production-migrations.mjs";
import {
  SIGNIN_THROTTLE,
  signinDelay,
  signinKey,
  signinNetwork,
  keyedDigest,
  reserveSigninAttempt,
  throttledSignin,
} from "../cloudflare/signin-throttle.mjs";

// Stand-in for Better Auth's email sign-in: 200 for the one right password, 401 otherwise,
// with the same 401 for unknown and known addresses (as Better Auth does).
const accounts = new Map([["hero@example.com", "the right password"]]);
const fakeSignin = (email, password) => () =>
  Promise.resolve(
    new Response(null, {
      status: accounts.get(email.trim().toLowerCase()) === password ? 200 : 401,
    }),
  );

function clock(start = 1_800_000_000_000) {
  let now = start;
  return { now: () => now, advance: (ms) => (now += ms) };
}
async function attempt(db, time, email, password = "a wrong password", ip = null) {
  const response = await throttledSignin(db, email, fakeSignin(email, password), time.now, ip);
  return {
    status: response.status,
    body: await response.text(),
    retry: response.headers.get("retry-after"),
  };
}

test("0018 is additive", () => {
  assertAdditiveSql(
    "0018_signin_throttle.sql",
    readFileSync("cloudflare/migrations/0018_signin_throttle.sql", "utf8"),
  );
});

test("waits start after the free failures, double each time and stop at 15 minutes", () => {
  for (let n = 0; n <= SIGNIN_THROTTLE.freeFailures; n++) assert.equal(signinDelay(n), 0);
  assert.equal(signinDelay(5), 30_000);
  assert.equal(signinDelay(6), 60_000);
  assert.equal(signinDelay(9), 480_000);
  assert.equal(signinDelay(10), 15 * 60_000);
  assert.equal(signinDelay(500), 15 * 60_000);
});

test("repeated wrong passwords slow one account down without locking it", async () => {
  const db = localAccountDb();
  const time = clock();
  for (let i = 0; i < 5; i++)
    assert.equal((await attempt(db, time, "hero@example.com")).status, 401);
  // Even the right password waits during the delay window...
  const waiting = await attempt(db, time, "Hero@Example.com ", "the right password");
  assert.equal(waiting.status, 429);
  assert.equal(waiting.retry, "30");
  assert.match(waiting.body, /Wait 30 seconds/);
  // ...and works as soon as it ends, which also clears the count.
  time.advance(30_000);
  assert.equal((await attempt(db, time, "hero@example.com", "the right password")).status, 200);
  // The network's wait is cleared; the email-wide count (no wait of its own) ends a day later.
  const rows = await db.prepare("SELECT key,blocked_until FROM signin_throttle").all();
  assert.deepEqual(rows.results.map((r) => ({ ...r })), [{ key: await signinKey("hero@example.com"), blocked_until: 0 }]);
  for (let i = 0; i < 5; i++)
    assert.equal((await attempt(db, time, "hero@example.com")).status, 401);
});

test("the wait grows to the cap, and the cap always ends", async () => {
  const db = localAccountDb();
  const time = clock();
  for (let i = 0; i < 30; i++) {
    const r = await attempt(db, time, "hero@example.com");
    if (r.status === 429) {
      assert.ok(Number(r.retry) <= SIGNIN_THROTTLE.maxDelayMs / 1000);
      time.advance(Number(r.retry) * 1000);
      assert.equal((await attempt(db, time, "hero@example.com")).status, 401);
    }
  }
  const capped = await attempt(db, time, "hero@example.com");
  assert.equal(capped.status, 429);
  assert.equal(capped.retry, String(SIGNIN_THROTTLE.maxDelayMs / 1000));
  assert.match(capped.body, /Wait 15 minutes/);
  time.advance(SIGNIN_THROTTLE.maxDelayMs);
  assert.equal((await attempt(db, time, "hero@example.com", "the right password")).status, 200);
});

test("registered and unregistered addresses get identical replies", async () => {
  const db = localAccountDb();
  const time = clock();
  const trace = async (email) => {
    const out = [];
    for (let i = 0; i < 8; i++) {
      out.push(await attempt(db, time, email));
      if (i === 6) time.advance(30_000);
    }
    return out;
  };
  const known = await trace("hero@example.com");
  const unknown = await trace("nobody@example.com");
  assert.deepEqual(unknown, known);
  assert.ok(known.some((r) => r.status === 429));
  // Stored state does not reveal the address either.
  const keys = await db.prepare("SELECT key FROM signin_throttle ORDER BY key").all();
  assert.deepEqual(
    keys.results.map((r) => r.key).sort(),
    [
      await signinKey("hero@example.com"),
      await signinKey("nobody@example.com"),
      await signinKey("hero@example.com", signinNetwork(null)),
      await signinKey("nobody@example.com", signinNetwork(null)),
    ].sort(),
  );
  assert.ok(keys.results.every((r) => !r.key.includes("example")));
});

test("parallel attempts are each counted before the password is checked", async () => {
  const db = localAccountDb();
  const time = clock();
  const key = await signinKey("hero@example.com");
  const results = await Promise.all(
    Array.from({ length: 12 }, () => reserveSigninAttempt(db, key, time.now())),
  );
  // Five attempts get through (the fifth starts the first wait); the rest must wait.
  assert.equal(results.filter((r) => r.ok).length, SIGNIN_THROTTLE.freeFailures + 1);
});

test("attempts whose password was never checked are refunded", async () => {
  const db = localAccountDb();
  const time = clock();
  for (const status of [400, 429, 500])
    for (let i = 0; i < 10; i++)
      assert.equal(
        (
          await throttledSignin(
            db,
            "hero@example.com",
            () => Promise.resolve(new Response(null, { status })),
            time.now,
          )
        ).status,
        status,
      );
  await assert.rejects(
    throttledSignin(db, "hero@example.com", () => Promise.reject(new Error("down")), time.now),
  );
  assert.equal((await db.prepare("SELECT count(*) AS n FROM signin_throttle").first()).n, 0);
  for (let i = 0; i < 5; i++)
    assert.equal((await attempt(db, time, "hero@example.com")).status, 401);
  assert.equal(
    (
      await throttledSignin(
        db,
        "hero@example.com",
        () => Promise.resolve(new Response(null, { status: 503 })),
        time.now,
      )
    ).status,
    429,
  );
});

test("failures older than a day are forgotten", async () => {
  const db = localAccountDb();
  const time = clock();
  for (let i = 0; i < 5; i++) await attempt(db, time, "hero@example.com");
  time.advance(SIGNIN_THROTTLE.resetAfterMs + 1);
  for (let i = 0; i < 5; i++)
    assert.equal((await attempt(db, time, "hero@example.com")).status, 401);
});

test("requests without a usable email go straight to Better Auth", async () => {
  const db = localAccountDb();
  for (const email of [undefined, 7, "", "   "]) {
    let called = 0;
    const response = await throttledSignin(db, email, () => {
      called++;
      return Promise.resolve(new Response(null, { status: 400 }));
    });
    assert.equal(response.status, 400);
    assert.equal(called, 1);
  }
});

// Audit 2026-11-10 H3: the wait was keyed on the email alone, so an outsider sending one wrong
// password as each wait ended kept the owner from signing in (288 of 288 correct attempts failed).
test("H3: wrong passwords from one network never stop the right password from another", async () => {
  const db = localAccountDb();
  const time = clock();
  const attacker = "203.0.113.7";
  const owner = "198.51.100.20";
  for (let i = 0; i <= SIGNIN_THROTTLE.freeFailures; i++)
    await attempt(db, time, "hero@example.com", "a wrong password", attacker);
  // One wrong password as each wait ends (288 of them), with the owner signing in each time.
  for (let round = 0; round < 288; round++) {
    let wrong = await attempt(db, time, "hero@example.com", "a wrong password", attacker);
    if (wrong.status === 429) {
      time.advance(Number(wrong.retry) * 1000);
      wrong = await attempt(db, time, "hero@example.com", "a wrong password", attacker);
    }
    assert.equal(wrong.status, 401);
    const right = await attempt(db, time, "Hero@Example.com", "the right password", owner);
    assert.equal(right.status, 200, `round ${round}: ${right.body}`);
    time.advance(60_000);
  }
  // The attacker's own network is still slowed down.
  const slowed = await attempt(db, time, "hero@example.com", "a wrong password", attacker);
  assert.equal(slowed.status, 429);
});

test("H3: addresses in one IPv6 /64 share a wait; another network does not", async () => {
  const db = localAccountDb();
  const time = clock();
  for (let i = 0; i < 5; i++)
    await attempt(db, time, "hero@example.com", "a wrong password", `2001:db8:1:2::${i + 1}`);
  const sameNetwork = await attempt(db, time, "hero@example.com", "the right password", "2001:db8:1:2:ffff::9");
  assert.equal(sameNetwork.status, 429);
  const elsewhere = await attempt(db, time, "hero@example.com", "the right password", "2001:db8:1:3::1");
  assert.equal(elsewhere.status, 200);
  assert.equal(signinNetwork("2001:DB8:1:2::1"), signinNetwork("2001:db8:0001:0002:ffff:ffff:ffff:ffff"));
  assert.equal(signinNetwork("::ffff:203.0.113.7"), "203.0.113.7");
  assert.notEqual(signinNetwork("203.0.113.7"), signinNetwork("203.0.113.8"));
  assert.equal(signinNetwork(null), signinNetwork(""));
});

test("H3: past the email-wide ceiling every network waits from its first failure, but a clean network still signs in", async () => {
  const db = localAccountDb();
  const time = clock();
  // A distributed attack: one wrong password from each of many networks.
  for (let i = 0; i < SIGNIN_THROTTLE.emailCeiling; i++) {
    const r = await attempt(db, time, "hero@example.com", "a wrong password", `10.${i >> 8}.${i & 255}.1`);
    assert.equal(r.status, 401);
    time.advance(1000);
  }
  const fresh = "10.200.0.1";
  assert.equal((await attempt(db, time, "hero@example.com", "a wrong password", fresh)).status, 401);
  const next = await attempt(db, time, "hero@example.com", "a wrong password", fresh);
  assert.equal(next.status, 429, "no free failures while the address is under attack");
  assert.match(next.body, /Wait 30 seconds/);
  // The owner, from a network with no failures, signs in at once.
  assert.equal((await attempt(db, time, "hero@example.com", "the right password", "198.51.100.20")).status, 200);
  // Under attack the longest wait is SIGNIN_THROTTLE.pressedMaxDelayMs.
  for (let i = 0; i < 12; i++) {
    const r = await attempt(db, time, "hero@example.com", "a wrong password", fresh);
    if (r.status === 429) time.advance(Number(r.retry) * 1000);
  }
  const capped = await attempt(db, time, "hero@example.com", "a wrong password", fresh);
  if (capped.status === 429) assert.ok(Number(capped.retry) * 1000 <= SIGNIN_THROTTLE.pressedMaxDelayMs);
  assert.equal(signinDelay(1, true), SIGNIN_THROTTLE.baseDelayMs);
  assert.equal(signinDelay(50, true), SIGNIN_THROTTLE.pressedMaxDelayMs);
  // A day after the last failure the address is no longer under attack.
  time.advance(SIGNIN_THROTTLE.resetAfterMs + 1);
  for (let i = 0; i < SIGNIN_THROTTLE.freeFailures; i++)
    assert.equal((await attempt(db, time, "hero@example.com", "a wrong password", "10.201.0.1")).status, 401);
});

// Privacy review of PR 494: a stored key that contains a network is keyed with the server secret,
// so a database reader who knows an email cannot brute-force which IPv4 network tried it.
test("network keys are HMAC with the server secret; the email-only key keeps its earlier form", async () => {
  const db = localAccountDb();
  const time = clock();
  const secret = "only-a-disposable-test-secret-12345678901234567890";
  const sha = async (value) =>
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, "0")).join("");
  for (let i = 0; i < 6; i++)
    await throttledSignin(db, "hero@example.com", fakeSignin("hero@example.com", "wrong"), time.now, "203.0.113.7", secret);
  const keys = (await db.prepare("SELECT key FROM signin_throttle ORDER BY key").all()).results.map((r) => r.key);
  const keyed = await signinKey("hero@example.com", signinNetwork("203.0.113.7"), secret);
  assert.deepEqual(keys, [await sha("signin:hero@example.com"), keyed].sort());
  assert.equal(await signinKey("hero@example.com"), await sha("signin:hero@example.com"), "unchanged email-only key");
  assert.notEqual(keyed, await signinKey("hero@example.com", signinNetwork("203.0.113.7")), "not the unkeyed digest");
  assert.notEqual(keyed, await signinKey("hero@example.com", signinNetwork("203.0.113.7"), secret + "x"));
  assert.notEqual(keyed, await sha("signin-net:203.0.113.7\nhero@example.com"));
  assert.equal(await keyedDigest(secret, "a"), await keyedDigest(secret, "a"));
  // The keyed wait works as before.
  const waiting = await throttledSignin(db, "hero@example.com", fakeSignin("hero@example.com", "the right password"), time.now, "203.0.113.7", secret);
  assert.equal(waiting.status, 429);
});
