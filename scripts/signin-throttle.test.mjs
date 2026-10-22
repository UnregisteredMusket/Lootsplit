import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localAccountDb } from "./account-dev-db.mjs";
import { assertAdditiveSql } from "./production-migrations.mjs";
import {
  SIGNIN_THROTTLE,
  signinDelay,
  signinKey,
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
async function attempt(db, time, email, password = "a wrong password") {
  const response = await throttledSignin(db, email, fakeSignin(email, password), time.now);
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
  const rows = await db.prepare("SELECT count(*) AS n FROM signin_throttle").first();
  assert.equal(rows.n, 0);
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
    [await signinKey("hero@example.com"), await signinKey("nobody@example.com")].sort(),
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
