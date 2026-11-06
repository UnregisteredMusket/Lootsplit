// Coin parity between the shared command engine and the device (economy parity review,
// 2026-11-06): a credit keeps the coins a purse already holds, the device's loan approval,
// coin posting and coin edit apply the shared commands' rules, and a partial-stack gift moves
// full charges the way the shared give does.
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand } from "./commands.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import {
  applyCloudTable,
  decideLoan,
  economySnapshot,
  giveToPlayer,
  postCopper,
  sellToShop,
  setCoins,
} from "./economy.ts";
import { itemForGift, loadGifts, saveGifts, saveRoster } from "./gift.ts";
import { readJournal } from "./journal.ts";
import { readFinance } from "./finance.ts";
import { toCopper } from "./money.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import type { Coins, Holding } from "./types.ts";

type SharedCommand = Parameters<typeof applyCommand>[2];
const localDm: CloudSeat = { id: "local", token: "", name: "Dungeon master", role: "dm", purseIds: [] };
const coins = (c: Partial<Coins>): Coins => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
const shop = {
  id: "s",
  name: "Shop",
  keeper: "",
  place: "",
  notes: "",
  sellRate: 1,
  buyRate: 0.5,
  wealth: "modest" as const,
  category: "mixed" as const,
  priceScale: 1,
};
const wand: Holding = {
  id: "wand",
  purseId: "a",
  kind: "item",
  name: "Wand of sparks",
  quantity: 3,
  unitCopper: 500,
  notes: "",
  category: "general",
  uses: { current: 1, max: 3, whenEmpty: "keep" },
};
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "a", name: "Aria", kind: "character", coins: coins({ pp: 5, ep: 3 }) },
      { id: "b", name: "Bran", kind: "character", coins: coins({ pp: 2, ep: 1, gp: 4 }) },
    ],
    holdings: [
      { id: "rope", purseId: "a", kind: "item", name: "Rope", quantity: 5, unitCopper: 100, notes: "", category: "general" },
      { ...wand },
    ],
    shops: [shop],
    loans: [{ id: "L1", at: 1, purseId: "a", purseName: "Aria", copper: 150, note: "New boots", status: "pending" }],
    journal: readJournal({ finance: readFinance() }),
  };
}
// A gift's holding carries every holding field the schema allows, charges included.
const usesOf = (h: object) => (h as Partial<Holding>).uses;
const coinsOf = (t: CloudTable, id: string) => t.purses.find((p) => p.id === id)!.coins;
const lineOf = (t: CloudTable, purseId: string, copper: number) =>
  t.ledger.find((l) => l.purseId === purseId && l.copper === copper);

test("shared credits keep the coins the purse already holds (give, sell, loan approval)", () => {
  const give = applyCommand(campaign(), localDm, { id: "g1", kind: "give", fromId: "b", toId: "a", copper: 1, holdingId: null, quantity: 0 });
  assert.deepEqual(coinsOf(give, "a"), coins({ pp: 5, ep: 3, cp: 1 }));
  assert.equal(toCopper(coinsOf(give, "b")), toCopper(coinsOf(campaign(), "b")) - 1);

  const sell = applyCommand(campaign(), localDm, { id: "s1", kind: "sell", holdingId: "rope", shopId: "s", quantity: 1 });
  const paid = sell.ledger.find((l) => l.id === "s1")!.copper;
  assert.ok(paid > 0);
  assert.equal(toCopper(coinsOf(sell, "a")), toCopper(coinsOf(campaign(), "a")) + paid);
  assert.equal(coinsOf(sell, "a").pp, 5);
  assert.equal(coinsOf(sell, "a").ep, 3);

  const loan = applyCommand(campaign(), localDm, { id: "d1", kind: "decision", loanId: "L1", status: "approved" });
  assert.deepEqual(coinsOf(loan, "a"), coins({ pp: 5, ep: 3, gp: 1, sp: 5 }));
});

test("a shared credit above the 1,000,000,000,000 cp limit is still refused", () => {
  const t = campaign();
  t.purses[0].coins = coins({ gp: 1e10 - 1 });
  assert.throws(
    () => applyCommand(t, localDm, { id: "d1", kind: "decision", loanId: "L1", status: "approved" }),
    /Insufficient funds or invalid amount/,
  );
});

test("device give and sale keep the recipient's coins, exactly as the shared engine", async () => {
  setSeat(DM_SEAT);
  for (const [id, shared, device] of [
    ["give-1", { kind: "give", fromId: "b", toId: "a", copper: 7, holdingId: null, quantity: 0 }, () => giveToPlayer({ fromId: "b", toId: "a", copper: 7, holdingId: null, quantity: 0 }, { commandId: "give-1" })],
    ["sell-1", { kind: "sell", holdingId: "rope", shopId: "s", quantity: 2 }, () => sellToShop({ holdingId: "rope", shopId: "s", quantity: 2 }, { commandId: "sell-1" })],
  ] as const) {
    await applyCloudTable(campaign());
    const base = await economySnapshot();
    const expected = applyCommand(structuredClone(base), localDm, { ...shared, id } as SharedCommand);
    await device();
    const after = await economySnapshot();
    for (const p of ["a", "b"]) assert.deepEqual(coinsOf(after, p), coinsOf(expected, p), `${id}: ${p}`);
    assert.equal(coinsOf(after, "a").pp, 5, id);
  }
});

test("differential: device loan approval matches the shared decision command", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const base = await economySnapshot();
  const shared = applyCommand(structuredClone(base), localDm, { id: "d1", kind: "decision", loanId: "L1", status: "approved" });
  await decideLoan("L1", "approved");
  const device = await economySnapshot();
  assert.deepEqual(coinsOf(device, "a"), coinsOf(shared, "a"));
  assert.deepEqual(coinsOf(device, "a"), coins({ pp: 5, ep: 3, gp: 1, sp: 5 }));
  const strip = ({ id: _id, at: _at, ...rest }: { id: string; at: number }) => rest;
  assert.deepEqual(strip(lineOf(device, "a", 150)!), strip(lineOf(shared, "a", 150)!));
  assert.equal(lineOf(device, "a", 150)!.summary, "Finance: Loan approved");
  assert.equal(device.loans.find((l) => l.id === "L1")!.status, "approved");
  assert.deepEqual(
    device.journal!.finance!.loans.map(({ ...l }) => ({ ...l, startedAt: 0 })),
    shared.journal!.finance!.loans.map(({ ...l }) => ({ ...l, startedAt: 0 })),
  );
  // The device keeps its decision note for the DM's messages.
  assert.ok(device.notes.some((n) => n.id === "L1-decision-note" && n.text === "Loan of 1 gp, 5 sp approved."));
  // A second press on a decided loan changes nothing.
  await decideLoan("L1", "approved");
  await decideLoan("L1", "denied");
  const again = await economySnapshot();
  assert.deepEqual(again.purses, device.purses);
  assert.deepEqual(again.ledger, device.ledger);
  assert.deepEqual(again.loans, device.loans);
  assert.equal(again.journal!.finance!.loans.length, 1);
});

test("device loan denial and the shared denial move no coin", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const base = await economySnapshot();
  const shared = applyCommand(structuredClone(base), localDm, { id: "d2", kind: "decision", loanId: "L1", status: "denied" });
  await decideLoan("L1", "denied");
  const device = await economySnapshot();
  assert.deepEqual(device.purses, shared.purses);
  assert.deepEqual(device.ledger, shared.ledger);
  assert.equal(device.loans[0].status, "denied");
  assert.ok(device.notes.some((n) => n.id === "L1-decision-note" && n.text.endsWith("denied.")));
});

test("device loan approval past the coin limit is refused like the shared command", async () => {
  setSeat(DM_SEAT);
  const t = campaign();
  t.purses[0].coins = coins({ gp: 1e10 - 1 });
  await applyCloudTable(t);
  await assert.rejects(decideLoan("L1", "approved"), /Insufficient funds or invalid amount/);
  const after = await economySnapshot();
  assert.equal(after.loans[0].status, "pending");
  assert.deepEqual(coinsOf(after, "a"), coins({ gp: 1e10 - 1 }));
  assert.equal(after.ledger.length, 0);
});

test("device coin posting applies the shared bounds (coin limit, 500-character note)", async () => {
  setSeat(DM_SEAT);
  const t = campaign();
  t.purses[0].coins = coins({ gp: 1e10 });
  await applyCloudTable(t);
  const shared = (cmd: object) => () => applyCommand(t, localDm, { kind: "post", purseId: "a", ...cmd } as SharedCommand);
  assert.throws(shared({ id: "p1", copper: 5, summary: "x" }), /Insufficient funds/);
  await assert.rejects(postCopper("a", 5, "x", { commandId: "p1" }), /Insufficient funds/);
  assert.throws(shared({ id: "p2", purseId: "b", copper: 5, summary: "y".repeat(501) }));
  await assert.rejects(postCopper("b", 5, "y".repeat(501), { commandId: "p2" }));
  await assert.rejects(postCopper("b", 1e12 + 1, "z", { commandId: "p3" }));
  const after = await economySnapshot();
  assert.deepEqual(after.purses, t.purses);
  assert.equal(after.ledger.length, 0);
  // A 500-character note is still accepted, and a credit keeps the coins held.
  await postCopper("b", 5, "y".repeat(500), { commandId: "p4" });
  assert.deepEqual(coinsOf(await economySnapshot(), "b"), coins({ pp: 2, ep: 1, gp: 4, cp: 5 }));
});

test("device coin edit refuses coins that changed meanwhile, as the shared set-coins does", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const stale = coins({ pp: 1 });
  const target = coins({ gp: 9 });
  assert.throws(
    () => applyCommand(campaign(), localDm, { id: "e1", kind: "set-coins", purseId: "a", before: stale, coins: target }),
    /These coins changed/,
  );
  await assert.rejects(setCoins("a", target, undefined, { commandId: "e1", before: stale }), /These coins changed/);
  assert.deepEqual(coinsOf(await economySnapshot(), "a"), coins({ pp: 5, ep: 3 }));
  // The coins the DM edited from: applied once, and a retry of the same ID is a no-op.
  await setCoins("a", target, undefined, { commandId: "e2", before: coins({ pp: 5, ep: 3 }) });
  await setCoins("a", target, undefined, { commandId: "e2", before: coins({ pp: 5, ep: 3 }) });
  const after = await economySnapshot();
  assert.deepEqual(coinsOf(after, "a"), target);
  assert.equal(after.ledger.filter((l) => l.id === "e2").length, 1);
  // Callers that do not pass the coins they edited from keep working.
  await setCoins("b", coins({ gp: 1 }), undefined, { commandId: "e3" });
  assert.deepEqual(coinsOf(await economySnapshot(), "b"), coins({ gp: 1 }));
});

test("a partial-stack gift moves full charges, as the shared give does; a whole stack keeps them", async () => {
  // The gift record itself.
  assert.deepEqual(usesOf(itemForGift(wand, 1)), { current: 3, max: 3, whenEmpty: "keep" });
  assert.deepEqual(usesOf(itemForGift(wand, 3)), { current: 1, max: 3, whenEmpty: "keep" });
  assert.equal(usesOf(itemForGift({ ...wand, uses: undefined }, 1)), undefined);
  // The shared give for comparison.
  const shared = applyCommand(campaign(), localDm, { id: "g", kind: "give", fromId: "a", toId: "b", copper: 0, holdingId: "wand", quantity: 1 });
  const sharedMoved = shared.holdings.find((h) => h.purseId === "b")!;
  // A player link's pending gift.
  const base = campaign();
  await applyCloudTable(base);
  await saveGifts([]);
  await saveRoster(base.purses);
  setSeat({ role: "player", purseIds: ["a"], shopIds: [], openedAt: 0 });
  try {
    await giveToPlayer({ fromId: "a", toId: "b", copper: 0, holdingId: "wand", quantity: 1 }, { commandId: "gift-1" });
    const [gift] = await loadGifts();
    assert.deepEqual(usesOf(gift.holding!), sharedMoved.uses);
    const kept = (await economySnapshot()).holdings.find((h) => h.id === "wand")!;
    assert.deepEqual(kept.uses, shared.holdings.find((h) => h.id === "wand")!.uses);
    assert.equal(kept.quantity, 2);
  } finally {
    setSeat(DM_SEAT);
  }
});
