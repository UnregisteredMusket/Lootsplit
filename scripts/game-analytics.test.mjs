import { test } from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { collect, publicAnalytics, ownerAnalytics } from "../cloudflare/game-analytics.mjs";

test("public analytics aggregates multiple pages and publishes only spending", async () => {
  const db = localAccountDb();
  try {
    for (let i = 0; i < 101; i++) {
      const body = {
        seats: [{ token: "SECRET" }],
        table: {
          ledger: [
            {
              id: "same-local-id",
              purseId: "p",
              copper: -123,
              transactionType: "purchase",
              summary: "private",
            },
          ],
          purses: [],
          holdings: [],
        },
      };
      await db
        .prepare("INSERT INTO campaign_rooms (code,revision,body) VALUES (?,1,?)")
        .bind(String(i).padStart(4, "0"), JSON.stringify(body))
        .run();
    }
    await collect(db);
    const result = await publicAnalytics(db);
    assert.deepEqual(result.metrics, { spentCopper: 12423 });
    assert.deepEqual(Object.keys(result).sort(), ["asOf", "metrics", "scope", "version"]);
    assert.equal(JSON.stringify(result).includes("SECRET"), false);
    assert.deepEqual(await publicAnalytics(db), result);
    await assert.rejects(ownerAnalytics(db, "ordinary-member"), { status: 403 });
    await db
      .prepare(
        "INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES ('owner','Owner','owner@example.com',0,1,1)",
      )
      .run();
    await db.prepare("INSERT INTO site_roles VALUES ('owner','owner',1)").run();
    const privateResult = await ownerAnalytics(db, "owner");
    assert.equal(privateResult.sharedCampaigns, 101);
    assert.equal(privateResult.metrics.purchaseCount, 101);
  } finally {
    db.close();
  }
});

test("empty database is zero; database errors never become fabricated zero totals", async () => {
  const db = localAccountDb();
  try {
    await collect(db);
    assert.equal((await publicAnalytics(db)).metrics.spentCopper, 0);
  } finally {
    db.close();
  }
  const broken = {
    prepare() {
      throw Error("Unavailable");
    },
  };
  await assert.rejects(publicAnalytics(broken), /Unavailable/);
  await assert.rejects(publicAnalytics(broken), /Unavailable/);
});

test("running totals: unchanged campaigns are not reread, and the totals equal a full recount", async () => {
  const db = localAccountDb();
  const room = (copper) => JSON.stringify({ seats: [], table: { ledger: [{ id: "l1", purseId: "p", copper, transactionType: "purchase", summary: "" }], purses: [], holdings: [] } });
  const put = (code, revision, copper) =>
    db.prepare("INSERT INTO campaign_rooms (code,revision,body) VALUES (?,?,?) ON CONFLICT(code) DO UPDATE SET revision=excluded.revision,body=excluded.body").bind(code, revision, room(copper)).run();
  try {
    for (let i = 0; i < 60; i++) await put(`R${String(i).padStart(3, "0")}`, 1, -100);
    const first = await collect(db);
    assert.equal(first.recounted, 60, "the first collection counts every campaign");
    assert.equal(first.metrics.spentCopper, 6000);
    assert.equal(first.sharedCampaigns, 60);
    const second = await collect(db);
    assert.equal(second.recounted, 0, "nothing changed, nothing reread");
    assert.deepEqual(second.metrics, first.metrics);
    // One campaign changes (a new revision): only it is reread, and the totals follow.
    await put("R007", 2, -250);
    const third = await collect(db);
    assert.equal(third.recounted, 1);
    assert.equal(third.metrics.spentCopper, 6150);
    // A deleted campaign stops counting and its cache row is removed.
    await db.prepare("DELETE FROM campaign_rooms WHERE code='R010'").run();
    const fourth = await collect(db);
    assert.equal(fourth.recounted, 0);
    assert.equal(fourth.sharedCampaigns, 59);
    assert.equal(fourth.metrics.spentCopper, 6050);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM game_analytics_cache WHERE code<>'SITE-TOTALS'").first()).n, 59);
    // An unreadable or older-version cache row is recounted, never trusted.
    await db.prepare("UPDATE game_analytics_cache SET metrics='{broken' WHERE code='R001'").run();
    await db.prepare("UPDATE game_analytics_cache SET analytics_version=0 WHERE code='R002'").run();
    const fifth = await collect(db);
    assert.equal(fifth.recounted, 2);
    assert.deepEqual(fifth.metrics, fourth.metrics);
    // Test-mode campaigns never count and leave no cache row.
    await db.prepare("UPDATE campaign_rooms SET body=json_set(body,'$.testMode',1), revision=3 WHERE code='R003'").run();
    const sixth = await collect(db);
    assert.equal(sixth.sharedCampaigns, 58);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM game_analytics_cache WHERE code='R003'").first()).n, 0);
  } finally {
    db.close();
  }
});

/** Records every SQL statement the code under test prepares on the D1 stand-in. */
function recording(db) {
  const statements = [];
  return {
    statements,
    db: new Proxy(db, {
      get(target, key) {
        if (key === "prepare")
          return (sql) => {
            statements.push(sql);
            return target.prepare(sql);
          };
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
  };
}

test("the public statistics read sums the collected totals and reads no campaign or history", async () => {
  const db = localAccountDb();
  const room = (copper) =>
    JSON.stringify({ seats: [{ token: "SECRET" }], table: { ledger: [{ id: "l1", purseId: "p", copper, transactionType: "purchase", summary: "" }], purses: [], holdings: [] } });
  try {
    for (let i = 0; i < 5; i++)
      await db.prepare("INSERT INTO campaign_rooms (code,revision,body) VALUES (?,1,?)").bind(`ROOM${i}`, room(-100)).run();
    // The scheduled owner-monitor collection (every 30 minutes) maintains the totals.
    const collected = await collect(db, 1_700_000_000_000);
    // A campaign changes after the collection: the public figure stays at the collected total until
    // the next collection instead of recounting on the request path.
    await db.prepare("UPDATE campaign_rooms SET revision=2, body=? WHERE code='ROOM0'").bind(room(-900)).run();
    const { db: watched, statements } = recording(db);
    const result = await publicAnalytics(watched);
    assert.deepEqual(result.metrics, { spentCopper: collected.metrics.spentCopper });
    assert.equal(result.metrics.spentCopper, 500);
    assert.equal(result.scope, "current-shared-campaigns");
    assert.ok(Number.isSafeInteger(result.asOf) && result.asOf > 0);
    assert.ok(statements.length > 0 && statements.length <= 2, `one bounded read, got ${statements.length}`);
    for (const sql of statements) {
      assert.doesNotMatch(sql, /campaign_room|report|history|archive/i, `public read touched campaign data: ${sql}`);
      assert.doesNotMatch(sql, /^\s*(INSERT|UPDATE|DELETE)/i, `public read wrote: ${sql}`);
    }
    // The next collection picks the change up.
    await collect(db);
    assert.equal((await publicAnalytics(db)).metrics.spentCopper, 1300);
  } finally {
    db.close();
  }
});

test("before any collection the public figure is unavailable, never a fabricated zero", async () => {
  const db = localAccountDb();
  try {
    await db.prepare("INSERT INTO campaign_rooms (code,revision,body) VALUES ('ROOM1',1,'{}')").run();
    await assert.rejects(publicAnalytics(db), { status: 503 });
  } finally {
    db.close();
  }
});
