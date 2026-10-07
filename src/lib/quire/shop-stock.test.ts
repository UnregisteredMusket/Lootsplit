import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { quireDb } from "./db.ts";
import {
  addShelfStock,
  applyCloudTable,
  blankShop,
  economySnapshot,
  snapshot,
  readQuireFile,
} from "./economy.ts";
import { emptyCloudTable } from "./cloud.ts";
import { catalogStockDraft } from "./compose.ts";
import { DEFAULT_REALM } from "./scale.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { applyCommand } from "./commands.ts";

test("bulk stock imports preserve existing goods, deduplicate competing imports, and retain metadata in backups", async () => {
  setSeat(DM_SEAT);
  const shop = { ...blankShop(), id: "bulk-shop" };
  const existing = {
    id: "existing",
    shopId: shop.id,
    name: "Existing",
    copper: 17,
    baseCopper: 23,
    quantity: 3,
    notes: "custom",
    rarity: "rare" as const,
  };
  const table = { ...emptyCloudTable(), shops: [shop], stock: [existing] };
  await applyCloudTable(table);
  const rows = Array.from({ length: 60 }, (_, i) =>
    catalogStockDraft(
      {
        id: `catalog-${i}`,
        name: `Selected ${i}`,
        category: "general",
        rarity: "common",
        baseCopper: 100,
        notes: "Original source retained",
        origin: "hand",
        service: i === 0,
      },
      shop,
      DEFAULT_REALM,
      25,
    ),
  );
  const duplicates = [
    ...rows,
    { ...rows[1]!, name: " EXISTING " },
    { ...rows[2]!, name: "selected 2" },
  ];
  const results = await Promise.all([
    addShelfStock(shop.id, duplicates),
    addShelfStock(shop.id, duplicates),
  ]);
  assert.equal(
    results.reduce((a, b) => a + b, 0),
    60,
  );
  const after = await economySnapshot();
  assert.equal(after.stock.length, 61);
  assert.deepEqual(
    after.stock.find((row) => row.id === existing.id),
    existing,
  );
  assert.equal(after.stock.find((row) => row.name === "Selected 0")?.quantity, null);
  assert.equal(after.stock.find((row) => row.name === "Selected 1")?.quantity, 25);
  assert.equal(
    after.stock.find((row) => row.name === "Selected 1")?.notes,
    "Original source retained",
  );
  assert.equal(after.journal?.events.length, 1);
  assert.equal(after.ledger.length, 0);
  const backup = readQuireFile(JSON.parse(JSON.stringify(await snapshot())));
  assert.deepEqual(backup.stock, after.stock);

  setSeat({ ...DM_SEAT, role: "player", purseIds: [] });
  try {
    await assert.rejects(addShelfStock(shop.id, rows), /Only the DM/);
  } finally {
    setSeat(DM_SEAT);
  }
  assert.throws(
    () =>
      applyCommand(
        table,
        { id: "player", token: "p", name: "Player", role: "player", purseIds: [] },
        {
          id: "hostile",
          kind: "patch",
          changes: [
            {
              store: "stock",
              id: "hostile-stock",
              before: null,
              after: { ...existing, id: "hostile-stock" },
            },
          ],
        },
      ),
    /[Dd]ungeon|DM/,
  );
});

test("a failed bulk stock write rolls back both stock and its audit event", async () => {
  const shop = { ...blankShop(), id: "atomic-shop" };
  await applyCloudTable({ ...emptyCloudTable(), shops: [shop] });
  const rows = ["First", "Second"].map((name) => ({
    name,
    copper: 10,
    baseCopper: 10,
    quantity: 1,
    rarity: "common" as const,
    notes: "",
  }));
  const db = await quireDb(),
    original = db.transaction.bind(db);
  db.transaction = ((stores: string | string[], mode?: IDBTransactionMode) => {
    const tx = original(stores, mode);
    if (
      mode === "readwrite" &&
      Array.from(typeof stores === "string" ? [stores] : stores).includes("stock")
    ) {
      const getStore = tx.objectStore.bind(tx);
      tx.objectStore = ((name: string) => {
        const store = getStore(name);
        if (name === "stock") {
          const put = store.put.bind(store);
          let writes = 0;
          store.put = ((...args: Parameters<typeof put>) => {
            if (++writes === 2) throw new Error("Injected disk failure");
            return put(...args);
          }) as typeof put;
        }
        return store;
      }) as typeof tx.objectStore;
    }
    return tx;
  }) as typeof db.transaction;
  try {
    await assert.rejects(addShelfStock(shop.id, rows), /Injected disk failure/);
  } finally {
    db.transaction = original;
  }
  const after = await economySnapshot();
  assert.equal(after.stock.length, 0);
  assert.equal(after.journal?.events.length, 0);
  await assert.rejects(addShelfStock("deleted-shop", rows), /no longer exists/);
  await assert.rejects(addShelfStock(shop.id, [{ ...rows[0]!, quantity: NaN }]), /invalid/);
  assert.equal((await economySnapshot()).stock.length, 0);
});
