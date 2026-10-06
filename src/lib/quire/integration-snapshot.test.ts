import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { quireDb } from "./db.ts";
import { applyCloudTable, economySnapshot, snapshot, economyView } from "./economy.ts";
import { emptyCloudTable } from "./cloud.ts";
import { fromCopper, toCopper } from "./money.ts";

for (const [name, read] of [
  ["shared campaign", economySnapshot],
  ["device backup", snapshot],
  ["financial views", economyView],
] as const) {
  test(`${name} keeps balances and session records from one committed state`, async () => {
    await applyCloudTable({
      ...emptyCloudTable(),
      purses: [{ id: "hero", name: "Hero", kind: "character", coins: fromCopper(100) }],
      journal: { sessions: [], requests: [], events: [] },
    });
    const db = await quireDb();
    const original = db.transaction.bind(db);
    let injected = false;
    db.transaction = ((stores: string | string[], mode?: IDBTransactionMode) => {
      const tx = original(stores, mode);
      if (
        !injected &&
        Array.from(typeof stores === "string" ? [stores] : stores).includes("purses") &&
        mode !== "readwrite"
      ) {
        injected = true;
        // Queue a real atomic save immediately behind the first read. Separate
        // follow-up metadata reads will observe it while balances remain old.
        const write = original(["purses", "meta"], "readwrite");
        write
          .objectStore("purses")
          .put({ id: "hero", name: "Hero", kind: "character", coins: fromCopper(200) });
        write
          .objectStore("meta")
          .put({
            id: "journal",
            value: {
              sessions: [],
              requests: [],
              events: [{ id: "award", at: 1, kind: "management", summary: "Award committed" }],
            },
          });
      }
      return tx;
    }) as typeof db.transaction;
    try {
      const result = await read();
      assert.equal(injected, true);
      const amount = toCopper(result.purses[0]!.coins);
      assert.equal(
        result.journal?.events.length,
        amount === 100 ? 0 : 1,
        "A snapshot must never combine old funds with newer session records",
      );
    } finally {
      db.transaction = original;
    }
  });
}
