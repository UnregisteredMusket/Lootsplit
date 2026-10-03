import { test } from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { publicAnalytics, ownerAnalytics } from "../cloudflare/game-analytics.mjs";

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
        .prepare("INSERT INTO campaign_rooms VALUES (?,1,?)")
        .bind(String(i).padStart(4, "0"), JSON.stringify(body))
        .run();
    }
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
