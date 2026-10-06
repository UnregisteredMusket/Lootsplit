import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { quireDb } from "./db.ts";
import {
  applyCloudTable,
  blankPurse,
  blankShop,
  buyFromShop,
  buyListing,
  economySnapshot,
} from "./economy.ts";
import { emptyCloudTable } from "./cloud.ts";
import { fromCopper, toCopper, priceAfterCharisma } from "./money.ts";

for (const listing of [false, true])
  test(`${listing ? "market" : "shop"} purchase prices against the character committed with the purchase`, async () => {
    const purse = { ...blankPurse("character"), id: "hero", coins: fromCopper(10000) };
    purse.sheet!.scores.cha = 10;
    const shop = { ...blankShop(), id: "shop" };
    await applyCloudTable({
      ...emptyCloudTable(),
      purses: [purse],
      shops: [shop],
      stock: [
        {
          id: "stock",
          shopId: shop.id,
          name: "Sword",
          quantity: 2,
          copper: 1000,
          baseCopper: 1000,
          rarity: "common",
          notes: "",
        },
      ],
      listings: [
        { id: "listing", name: "Sword", kind: "item", quantity: 2, copper: 1000, notes: "" },
      ],
    });
    const db = await quireDb(),
      original = db.transaction.bind(db);
    let injected = false;
    db.transaction = ((stores: string | string[], mode?: IDBTransactionMode) => {
      const names = typeof stores === "string" ? [stores] : stores;
      if (!injected && mode === "readwrite" && names.includes("holdings")) {
        injected = true;
        // A second tab commits an approved Charisma change immediately before
        // the purchase transaction. Its price must use that same character state.
        const write = original("purses", "readwrite");
        write
          .objectStore("purses")
          .put({
            ...purse,
            sheet: { ...purse.sheet!, scores: { ...purse.sheet!.scores, cha: 20 } },
          });
      }
      return original(stores, mode);
    }) as typeof db.transaction;
    try {
      if (listing) await buyListing({ listingId: "listing", purseId: purse.id, quantity: 1 });
      else await buyFromShop({ stockId: "stock", purseId: purse.id, quantity: 1 });
    } finally {
      db.transaction = original;
    }
    const result = await economySnapshot();
    assert.equal(injected, true);
    assert.equal(result.purses[0]!.sheet!.scores.cha, 20);
    assert.equal(toCopper(result.purses[0]!.coins), 10000 - priceAfterCharisma(1000, 20));
    assert.equal(result.ledger.length, 1);
    assert.equal(result.ledger[0]!.copper, -priceAfterCharisma(1000, 20));
    assert.equal(result.holdings[0]!.quantity, 1);
    assert.equal(listing ? result.listings[0]!.quantity : result.stock[0]!.quantity, 1);
  });
