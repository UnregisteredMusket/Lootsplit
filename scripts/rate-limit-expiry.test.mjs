import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localAccountDb } from "./account-dev-db.mjs";
import {
  expireRateLimits,
  rateLimitExpiryDue,
  RATE_LIMIT_RETENTION_MS,
  RATE_LIMIT_EXPIRY_MINUTE,
} from "../cloudflare/rate-limit-expiry.mjs";

const now = 1_800_000_000_000;
const minute = (ms) => Math.floor(ms / 60_000);

test("stale per-IP rate-limit rows expire and current ones keep counting", async () => {
  const db = localAccountDb();
  const limit = db.prepare("INSERT INTO library_limits (key, window, hits) VALUES (?, ?, ?)");
  await limit.bind("ancient", minute(now - 30 * 24 * 3600_000), 60).run();
  await limit.bind("stale", minute(now - RATE_LIMIT_RETENTION_MS) - 1, 3).run();
  await limit.bind("edge", minute(now - RATE_LIMIT_RETENTION_MS), 3).run();
  await limit.bind("current", minute(now), 59).run();
  const auth = db.prepare(
    'INSERT INTO "rateLimit" (id, key, count, "lastRequest") VALUES (?, ?, ?, ?)',
  );
  await auth.bind("a", "ip-old/sign-in", 40, now - RATE_LIMIT_RETENTION_MS - 1).run();
  await auth.bind("b", "ip-new/sign-in", 39, now - 1000).run();

  assert.deepEqual(await expireRateLimits(db, now), { library_limits: 2, rateLimit: 1 });
  const left = await db.prepare("SELECT key, hits FROM library_limits ORDER BY key").all();
  assert.deepEqual(
    left.results.map((r) => [r.key, r.hits]),
    [
      ["current", 59],
      ["edge", 3],
    ],
  );
  const authLeft = await db.prepare('SELECT key, count FROM "rateLimit"').all();
  assert.deepEqual(
    authLeft.results.map((r) => [r.key, r.count]),
    [["ip-new/sign-in", 39]],
  );
  // Running again changes nothing; the active window's counter was not reset.
  assert.deepEqual(await expireRateLimits(db, now), { library_limits: 0, rateLimit: 0 });
});

test("expiry never touches history tables", async () => {
  const source = readFileSync(
    new URL("../cloudflare/rate-limit-expiry.mjs", import.meta.url),
    "utf8",
  );
  const tables = [...source.matchAll(/DELETE FROM "?(\w+)"?/g)].map((m) => m[1]);
  assert.deepEqual(tables, ["library_limits", "rateLimit"]);
});

test("the minute cron runs expiry once an hour, independently of monitoring", () => {
  const hour = Math.floor(now / 3600_000) * 3600_000;
  const due = [];
  for (let m = 0; m < 120; m++) if (rateLimitExpiryDue(hour + m * 60_000 + 5_000)) due.push(m);
  assert.deepEqual(due, [RATE_LIMIT_EXPIRY_MINUTE, 60 + RATE_LIMIT_EXPIRY_MINUTE]);
  const worker = readFileSync(new URL("../cloudflare/worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /Promise\.allSettled\(\[\s*scheduledMonitor\(/);
  assert.match(worker, /expireRateLimits\(env\.DB, controller\.scheduledTime\)/);
});
