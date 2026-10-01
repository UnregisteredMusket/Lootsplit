import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand, tablePatch } from "./commands.ts";
import { emptyCloudTable, readCloudTable, type CloudTable, type CloudSeat } from "./cloud.ts";
import { fromCopper, toCopper } from "./money.ts";
import { sessionSummary } from "./journal.ts";
import { applyCloudTable, economySnapshot, snapshot, restore, readQuireFile } from "./economy.ts";
const dm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const player: CloudSeat = {
  id: "player",
  token: "player",
  name: "Player",
  role: "player",
  purseIds: ["a"],
};
function fixture(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "a", name: "A", kind: "character" as const, coins: fromCopper(1000) },
      { id: "b", name: "B", kind: "character" as const, coins: fromCopper(500) },
    ],
    shops: [
      {
        id: "s",
        name: "Shop",
        keeper: "Keeper",
        place: "Village",
        notes: "Custom",
        sellRate: 1,
        buyRate: 0.5,
        wealth: "modest" as const,
        category: "general" as const,
        priceScale: 1,
      },
    ],
    stock: [
      {
        id: "x",
        shopId: "s",
        name: "Custom rope",
        copper: 10,
        quantity: 3,
        notes: "Do not replace",
        baseCopper: 10,
        rarity: "common" as const,
      },
      {
        id: "u",
        shopId: "s",
        name: "Water",
        copper: 1,
        quantity: null,
        notes: "",
        baseCopper: 1,
        rarity: "common" as const,
      },
    ],
  };
}
test("old campaigns gain empty journal, retain finance, and keep legacy shops open", () => {
  const old = fixture();
  const next = readCloudTable(old)!;
  assert.deepEqual(next.journal, { sessions: [], requests: [], events: [] });
  assert.deepEqual(next.purses, old.purses);
  assert.equal(
    applyCommand(next, player, { id: "buy", kind: "buy", stockId: "x", purseId: "a", quantity: 1 })
      .stock[0]?.quantity,
    2,
  );
});
test("closed shops reject buy and sell server commands without mutating balances", () => {
  const t = fixture();
  t.shops[0]!.closed = true;
  assert.throws(
    () =>
      applyCommand(t, player, { id: "x", kind: "buy", stockId: "x", purseId: "a", quantity: 1 }),
    /closed/,
  );
  assert.equal(toCopper(t.purses[0]!.coins), 1000);
});
test("restock is DM only and preserves custom items, price and unlimited stock", () => {
  const t = fixture();
  assert.throws(
    () => applyCommand(t, player, { id: "r", kind: "restock", shopId: "s", quantity: 5 }),
    /Only the DM/,
  );
  const next = applyCommand(t, dm, { id: "r", kind: "restock", shopId: "s", quantity: 5 });
  assert.equal(next.stock[0]!.quantity, 8);
  assert.equal(next.stock[1]!.quantity, null);
  assert.equal(next.stock[0]!.notes, "Do not replace");
  assert.equal(next.stock[0]!.copper, 10);
});
test("payment approvals require DM, debit once, and fail atomically on insufficient funds", () => {
  const request = applyCommand(fixture(), player, {
    id: "r",
    kind: "payment-request",
    purseId: "a",
    copper: 100,
    note: "Inn bill",
  });
  assert.equal(toCopper(request.purses[0]!.coins), 1000);
  assert.throws(
    () =>
      applyCommand(request, player, {
        id: "d",
        kind: "payment-decision",
        requestId: "r",
        status: "approved",
      }),
    /Only the DM/,
  );
  const approved = applyCommand(request, dm, {
    id: "d",
    kind: "payment-decision",
    requestId: "r",
    status: "approved",
  });
  assert.equal(toCopper(approved.purses[0]!.coins), 900);
  assert.throws(
    () =>
      applyCommand(approved, dm, {
        id: "d2",
        kind: "payment-decision",
        requestId: "r",
        status: "approved",
      }),
    /already/,
  );
  const large = applyCommand(fixture(), player, {
    id: "r2",
    kind: "payment-request",
    purseId: "a",
    copper: 2000,
    note: "Too large",
  });
  assert.throws(
    () =>
      applyCommand(large, dm, {
        id: "d3",
        kind: "payment-decision",
        requestId: "r2",
        status: "approved",
      }),
    /Insufficient/,
  );
  assert.equal(large.journal!.requests[0]!.status, "pending");
});
test("players can update only owned portraits and cannot smuggle financial patches", () => {
  const t = fixture();
  assert.throws(
    () =>
      applyCommand(t, player, {
        id: "p",
        kind: "portrait",
        purseId: "b",
        portrait: "/art/portrait-default.webp",
      }),
    /permission/,
  );
  const next = applyCommand(t, player, {
    id: "p",
    kind: "portrait",
    purseId: "a",
    portrait: "/art/portrait-default.webp",
  });
  assert.equal(next.purses[0]!.portrait, "/art/portrait-default.webp");
  assert.throws(
    () =>
      applyCommand(t, player, {
        id: "hack",
        kind: "patch",
        changes: [
          {
            store: "purses",
            id: "a",
            before: t.purses[0],
            after: { ...t.purses[0], coins: fromCopper(99999) },
          },
        ],
      }),
    /Only the DM/,
  );
});
test("named sessions exclude internal transfers from receipts and spending", () => {
  let t = applyCommand(fixture(), dm, {
    id: "session",
    kind: "session",
    name: "Into the woods",
    end: false,
  });
  t = applyCommand(t, player, {
    id: "give",
    kind: "give",
    fromId: "a",
    toId: "b",
    copper: 100,
    holdingId: null,
    quantity: 0,
  });
  assert.deepEqual(sessionSummary(t.ledger, t.journal!.sessions[0]!), {
    received: 0,
    spent: 0,
    net: 0,
  });
  t = applyCommand(t, player, { id: "buy", kind: "buy", purseId: "a", stockId: "x", quantity: 1 });
  assert.equal(sessionSummary(t.ledger, t.journal!.sessions[0]!).spent, 10);
  assert.equal(sessionSummary(t.ledger, t.journal!.sessions[0]!).net, -10);
});
test("new journal and artwork survive room persistence and backup round trip", async () => {
  let t = applyCommand(fixture(), dm, {
    id: "session",
    kind: "session",
    name: "Preservation",
    end: false,
  });
  t = applyCommand(t, player, {
    id: "p",
    kind: "portrait",
    purseId: "a",
    portrait: "/art/portrait-default.webp",
  });
  await applyCloudTable(t);
  const file = await snapshot();
  await restore(readQuireFile(JSON.parse(JSON.stringify(file))));
  const next = await economySnapshot();
  assert.deepEqual(next.journal, t.journal);
  assert.equal(next.purses.find((p) => p.id === "a")?.portrait, "/art/portrait-default.webp");
  assert.deepEqual(
    [...next.stock].sort((a, b) => a.id.localeCompare(b.id)),
    [...t.stock].sort((a, b) => a.id.localeCompare(b.id)),
  );
});
test("journal changes travel through existing optimistic patches with conflict protection", () => {
  const t = readCloudTable(fixture())!;
  const changed = applyCommand(t, dm, { id: "session", kind: "session", name: "One", end: false });
  const patch = tablePatch(t, changed);
  const next = applyCommand(t, dm, { ...patch, id: "patch" });
  assert.deepEqual(next.journal, changed.journal);
  assert.throws(() => applyCommand(changed, dm, { ...patch, id: "again" }), /changed elsewhere/);
});

test("session boundaries remain exact for transactions in the same millisecond", () => {
  let t = fixture();
  const now = Date.now;
  Date.now = () => 1000;
  try {
    t = applyCommand(t, player, {
      id: "before",
      kind: "buy",
      stockId: "x",
      purseId: "a",
      quantity: 1,
    });
    t = applyCommand(t, dm, { id: "s", kind: "session", name: "Boundary", end: false });
    t = applyCommand(t, player, {
      id: "during",
      kind: "buy",
      stockId: "x",
      purseId: "a",
      quantity: 1,
    });
    t = applyCommand(t, dm, { id: "end", kind: "session", name: "Boundary", end: true });
    t = applyCommand(t, player, {
      id: "after",
      kind: "buy",
      stockId: "x",
      purseId: "a",
      quantity: 1,
    });
    assert.deepEqual(sessionSummary(t.ledger, t.journal!.sessions[0]!), {
      net: -10,
      received: 0,
      spent: 10,
    });
  } finally {
    Date.now = now;
  }
});
