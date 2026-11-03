// Sell and split in shared rooms and on the device: one atomic action (sale lines, fund split,
// receipt and note together), idempotent retries, server-side refusals with nothing sold,
// shared/offline differential parity, treasure-pool rules and the player projection.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace, manageRoom } from "./cloud.server.ts";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { toCopper } from "./money.ts";
import { planSaleSplit, type SaleSplitInput } from "./sale-split.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { splitActivity } from "./split-activity.ts";
import type { Holding, Purse, Shop } from "./types.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of ["0001_campaign_rooms.sql", "0024_campaign_room_receipts.sql", "0026_campaign_room_sections.sql", "0029_campaign_room_report_parts.sql", "0030_campaign_room_archive_keys.sql", "0003_accounts.sql", "0008_encounters.sql"])
  sql.exec(readFileSync(new URL(`../../../cloudflare/migrations/${file}`, import.meta.url), "utf8"));
(globalThis as any).__env__ = {
  DB: {
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(query: string) {
      let values: any[] = [];
      return {
        bind(...args: any[]) {
          values = args;
          return this;
        },
        async all() {
          if (query.includes("FROM play_characters")) return { results: [] };
          return { results: sql.prepare(query).all(...values) };
        },
        async first() {
          return sql.prepare(query).get(...values) ?? null;
        },
        async run() {
          return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } };
        },
      };
    },
  },
};

const coins = (c: Partial<Purse["coins"]>) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
const item = (id: string, name: string, unitCopper: number, quantity = 1, extra: Partial<Holding> = {}): Holding => ({
  id, purseId: "hoard", name, kind: "item", quantity, unitCopper, notes: "", category: "curios", ...extra,
});
const shop = (id: string, name: string, extra: Partial<Shop> = {}): Shop => ({
  id, name, keeper: "", place: "Port Ashby", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest",
  category: "curios", priceScale: 1, acceptedCategories: ["curios", "cloth", "smith"], ...extra,
});
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: coins({ gp: 1, cp: 3 }) },
      { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 25, cp: 1 }) },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins({ gp: 12, sp: 4 }) },
      { id: "cass", name: "Cass of the Reeds", kind: "character", coins: coins({ gp: 8, sp: 7, cp: 2 }) },
      { id: "dunstan", name: "Dunstan the porter", kind: "character", control: "npc", coins: coins({ gp: 1 }) },
      { id: "mirelle", name: "Mirelle", kind: "character", coins: coins({ gp: 4 }) },
    ],
    holdings: [
      item("chalice", "Silver chalice", 2500, 1, { pool: { at: 1, source: "dm" } }),
      item("silk", "Bolt of silk", 1000, 2, { category: "cloth" }),
      item("dagger", "Jewelled dagger", 4000, 1, { category: "smith", pool: { at: 1, source: "dm" } }),
      item("potion", "Potion of healing", 5000, 3, { category: "apothecary" }),
      { ...item("aria-ring", "Aria's ring", 900), purseId: "aria" },
    ],
    shops: [shop("marlow", "Marlow's Curios"), shop("salt", "Saltmarket", { closed: true })],
    ledger: [
      { id: "legacy-line", at: 1, purseId: "aria", shopId: null, summary: "Old purchase", copper: -10, transactionType: "purchase" },
    ],
    notes: [{ id: "old-note", at: 1, from: "dm", to: "party", purseId: "aria", text: "Welcome." }],
    journal: readJournal({
      lootClaims: { claims: [{ holdingId: "chalice", purseId: "aria", choice: "greed", at: 1, by: "player", commandId: "c1" }] },
      world: {
        characterPositions: [
          { purseId: "mirelle", inParty: false, locationId: null, visible: true, sheetVisible: true },
        ],
      },
    }),
  };
}
const party = ["aria", "bram", "cass"];
const mockup: SaleSplitInput = {
  fundId: "hoard",
  shopId: "marlow",
  lots: [{ holdingId: "chalice", quantity: 1 }, { holdingId: "silk", quantity: 2 }, { holdingId: "dagger", quantity: 1 }],
  recipientIds: party,
  rule: "party-fund",
};
function command(t: CloudTable, id: string, input: SaleSplitInput, actor: "dm" | "player" = "dm") {
  const plan = planSaleSplit(t, input, { actor });
  return {
    id,
    kind: "sale-split" as const,
    fundId: input.fundId,
    shopId: input.shopId,
    lots: input.lots,
    recipientIds: input.recipientIds,
    remainder: { rule: input.rule, ...(input.purseId ? { purseId: input.purseId } : {}) },
    expect: { proceeds: plan.proceeds, share: plan.split.share, remainderTo: plan.split.remainderTo },
  };
}
async function room() {
  const dm = await openRoom({ name: "Sale DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const mirelle = await joinRoom({ code: dm.code, purseId: "mirelle", name: "Mirelle" });
  await choosePace({ ...dm, live: true });
  return { dm, aria, mirelle };
}
function outcome(t: CloudTable) {
  const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((x, y) => x.id.localeCompare(y.id));
  return {
    purses: byId(t.purses).map((p) => ({ id: p.id, coins: p.coins })),
    holdings: byId(t.holdings),
    ledger: byId(t.ledger).map((l) => ({ ...l, at: 0 })),
    notes: byId(t.notes).map((n) => ({ ...n, at: 0 })),
    events: (t.journal?.events ?? []).map(({ at: _at, id: _id, ...e }) => e),
    claims: (t.journal as { lootClaims?: unknown } | undefined)?.lootClaims ?? null,
    coinSplit: t.journal?.coinSplit ?? null,
  };
}
const total = (t: CloudTable) => t.purses.reduce((sum, p) => sum + toCopper(p.coins), 0);

test("planner: the mockup's sale prices at the buy rate and splits 42 gp 5 sp three ways", () => {
  const plan = planSaleSplit(campaign(), mockup, { actor: "dm" });
  assert.deepEqual(plan.lots.map((l) => l.paid), [1250, 1000, 2000]);
  assert.equal(plan.proceeds, 4250);
  assert.equal(plan.split.share, 1416);
  assert.equal(plan.split.remainder, 2);
  assert.equal(plan.split.remainderTo, "hoard");
  assert.throws(() => planSaleSplit(campaign(), { ...mockup, lots: [{ holdingId: "potion", quantity: 1 }] }, { actor: "dm" }), /does not buy that item category/);
  assert.throws(() => planSaleSplit(campaign(), { ...mockup, shopId: "salt" }, { actor: "dm" }), /closed/);
  assert.throws(() => planSaleSplit(campaign(), { ...mockup, lots: [{ holdingId: "aria-ring", quantity: 1 }] }, { actor: "dm" }), /no longer in The Hoard/);
  assert.throws(() => planSaleSplit(campaign(), { ...mockup, lots: [{ holdingId: "silk", quantity: 3 }] }, { actor: "dm" }), /Only 2/);
  assert.throws(() => planSaleSplit(campaign(), mockup, { actor: "player" }), /treasure pool. Only the DM/);
  // Too little to split refuses the whole action: nothing is sold unsplit.
  const cheap = campaign();
  cheap.holdings.push(item("button", "Brass button", 2));
  assert.throws(() => planSaleSplit(cheap, { ...mockup, lots: [{ holdingId: "button", quantity: 1 }] }, { actor: "dm" }), /Too little to split/);
});

test("shared sell and split: one atomic action, conserved copper, claims dropped; a retry changes nothing", async () => {
  const { dm } = await room();
  const host = (await roomState(dm)).table;
  const sale = command(host, "sale-1", mockup);
  await submitCommands({ ...dm, batchId: "sale-first", commands: [sale] });
  const once = (await roomState(dm)).table;
  // Coins: the purses gain exactly the proceeds; each recipient +1,416 cp; 2 cp stays in the fund.
  assert.equal(total(once) - total(host), 4250);
  for (const id of party)
    assert.equal(toCopper(once.purses.find((p) => p.id === id)!.coins) - toCopper(host.purses.find((p) => p.id === id)!.coins), 1416);
  assert.equal(toCopper(once.purses.find((p) => p.id === "hoard")!.coins), 103 + 2);
  // Items: chalice, both silks and the dagger left; potions stay. The chalice's claim is gone.
  assert.deepEqual(once.holdings.map((h) => h.id).sort(), ["aria-ring", "potion"]);
  assert.equal((once.journal as any).lootClaims?.claims.length ?? 0, 0);
  // Ledger: three sale lines and the split lines, which net to the proceeds.
  const lines = once.ledger.filter((l) => l.id.startsWith("sale-1"));
  assert.deepEqual(lines.filter((l) => l.transactionType === "sale").map((l) => l.copper), [1250, 1000, 2000]);
  assert.equal(lines.filter((l) => l.split?.id === "sale-1").length, 4);
  assert.equal(lines.reduce((sum, l) => sum + l.copper, 0), 4250);
  const event = once.journal!.events.find((e) => e.split?.id === "sale-1")!;
  assert.match(event.summary, /^Sold 3 items to Marlow's Curios and split 42 gp, 5 sp from The Hoard among 3$/);
  assert.match(once.notes.find((n) => n.id === "sale-1-note")!.text, /^The Hoard sold 4 items for 42 gp, 5 sp and split it: 14 gp, 1 sp, 6 cp each/);
  // Activity: one row that opens to the three sale lines and the split's lines.
  const rows = splitActivity(once.ledger, once.journal!.events, once.purses, { dm: true, ownPurseIds: [] });
  const row = rows.find((r) => r.id === "sale-1")!;
  assert.equal(row.title, "Sold 3 items to Marlow's Curios and split from The Hoard · 3 shares");
  assert.equal(row.copper, 4250);
  assert.deepEqual(row.lines.map((l) => l.transactionType), ["sale", "sale", "sale", "transfer", "transfer", "transfer", "transfer"]);
  // A forged ordinary sale using the split's ID pattern on another purse stays its own row.
  const forged = { ...once.ledger.find((l) => l.id === "sale-1-sale-0")!, id: "sale-1-sale-9", purseId: "aria", at: 1 };
  const again = splitActivity([...once.ledger, forged], once.journal!.events, once.purses, { dm: true, ownPurseIds: [] });
  assert.equal(again.find((r) => r.id === "sale-1")!.lines.some((l) => l.id === "sale-1-sale-9"), false);
  // Lost response: the same command ID again is applied once.
  await submitCommands({ ...dm, batchId: "sale-retry", commands: [sale] });
  assert.deepEqual(outcome((await roomState(dm)).table), outcome(once));
});

test("shared sell and split: refusals sell and split nothing", async () => {
  const { dm, aria } = await room();
  const host = (await roomState(dm)).table;
  // A player without the fund.
  const fundOnly = { ...mockup, lots: [{ holdingId: "silk", quantity: 2 }] };
  await assert.rejects(
    submitCommands({ code: dm.code, token: aria.token, batchId: "no-fund", commands: [command(host, "no-fund", fundOnly, "player")] }),
    /permission to spend from this account/,
  );
  // With "Allow party fund", still never a pooled item or an NPC share.
  await manageRoom({ ...dm, action: "permission", seatId: aria.seatId, allowParty: true });
  await assert.rejects(
    submitCommands({ code: dm.code, token: aria.token, batchId: "pooled", commands: [{ ...command(host, "pooled", fundOnly, "player"), lots: mockup.lots }] }),
    /Only the DM can sell it/,
  );
  await assert.rejects(
    submitCommands({ code: dm.code, token: aria.token, batchId: "npc", commands: [{ ...command(host, "npc", fundOnly, "player"), recipientIds: [...party, "dunstan"] }] }),
    /Only the DM can include NPCs/,
  );
  // A stale review (the shop's rate changed) is refused for the DM too.
  await assert.rejects(
    submitCommands({ ...dm, batchId: "stale", commands: [{ ...command(host, "stale", mockup), expect: { proceeds: 4000, share: 1333, remainderTo: "hoard" } }] }),
    /The sale or split changed/,
  );
  const after = (await roomState(dm)).table;
  assert.deepEqual(outcome(after).purses, outcome(host).purses);
  assert.deepEqual(outcome(after).holdings, outcome(host).holdings);
  // With the permission, the player sells the fund's own (unpooled) items and splits them.
  await submitCommands({ code: dm.code, token: aria.token, batchId: "allowed", commands: [command(host, "allowed", fundOnly, "player")] });
  const sold = (await roomState(dm)).table;
  assert.equal(sold.holdings.some((h) => h.id === "silk"), false);
  assert.equal(toCopper(sold.purses.find((p) => p.id === "aria")!.coins) - toCopper(host.purses.find((p) => p.id === "aria")!.coins), 333);
});

test("differential: the device engine writes exactly what the shared room writes", async () => {
  const { dm } = await room();
  const host = (await roomState(dm)).table;
  setSeat(DM_SEAT);
  await applyCloudTable(host);
  const cases: Array<[string, SaleSplitInput]> = [
    ["partial pooled", { ...mockup, lots: [{ holdingId: "silk", quantity: 1 }, { holdingId: "chalice", quantity: 1 }] }],
    ["rotate with npc", { ...mockup, lots: [{ holdingId: "dagger", quantity: 1 }], recipientIds: [...party, "dunstan"], rule: "rotate" }],
  ];
  for (const [name, input] of cases) {
    const shared = (await roomState(dm)).table;
    const sale = command(shared, `diff-${name.replace(/\W+/g, "-")}`, input);
    await submitCommands({ ...dm, batchId: sale.id, commands: [sale] });
    await executeLocalCommand(sale);
    const roomOut = outcome((await roomState(dm)).table);
    const device = outcome(await economySnapshot());
    for (const key of ["purses", "holdings", "ledger", "notes", "events", "claims", "coinSplit"] as const)
      assert.deepEqual(device[key], roomOut[key], `${name}: ${key}`);
  }
  // The same refusal text on both paths, and nothing changed by it.
  const shared = (await roomState(dm)).table;
  const gone = { ...command(campaign(), "diff-gone", { ...mockup, lots: [{ holdingId: "silk", quantity: 2 }] }) };
  const roomError = await submitCommands({ ...dm, batchId: "gone", commands: [gone] }).catch((e: Error) => e.message);
  const deviceError = await executeLocalCommand(gone).catch((e: Error) => e.message);
  assert.match(String(roomError), /Only 1 × Bolt of silk/);
  assert.equal(deviceError, roomError);
  assert.deepEqual(outcome((await roomState(dm)).table).purses, outcome(shared).purses);
});

test("offline sell and split retried with the same command ID is applied once", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const sale = command(campaign(), "offline-sale", mockup);
  await executeLocalCommand(sale);
  const once = outcome(await economySnapshot());
  await executeLocalCommand(sale);
  assert.deepEqual(outcome(await economySnapshot()), once);
  assert.ok(once.ledger.some((l) => l.id === "legacy-line" && l.copper === -10));
});

test("projection: party players see the sale and party shares; NPC sales stay DM-only; away players see nothing of it", async () => {
  const { dm, aria, mirelle } = await room();
  const host = (await roomState(dm)).table;
  await submitCommands({ ...dm, batchId: "seen", commands: [command(host, "seen", { ...mockup, lots: [{ holdingId: "silk", quantity: 2 }] })] });
  const next = (await roomState(dm)).table;
  await submitCommands({
    ...dm,
    batchId: "npc-sale",
    commands: [command(next, "npc-sale", { ...mockup, lots: [{ holdingId: "dagger", quantity: 1 }], recipientIds: [...party, "dunstan"] })],
  });
  const ariaView = (await roomState({ code: dm.code, token: aria.token })).table;
  assert.deepEqual(ariaView.ledger.filter((l) => l.id.startsWith("seen-")).map((l) => l.purseId).sort(), ["aria", "bram", "cass", "hoard", "hoard"]);
  assert.ok(ariaView.notes.some((n) => n.id === "seen-note"));
  assert.equal(ariaView.ledger.some((l) => l.purseId === "dunstan"), false);
  assert.equal(ariaView.notes.some((n) => n.id === "npc-sale-note"), false);
  assert.equal(JSON.stringify(ariaView.journal?.events ?? []).includes("npc-sale"), false);
  const away = (await roomState({ code: dm.code, token: mirelle.token })).table;
  assert.equal(away.ledger.some((l) => l.id.startsWith("seen-") || l.id.startsWith("npc-sale-")), false);
  // Party chat reaches everyone, so it never names the fund's items or the shop.
  const note = away.notes.find((n) => n.id === "seen-note");
  assert.ok(note);
  assert.equal(/silk|Marlow/.test(note.text), false);
  assert.equal(away.notes.some((n) => n.id === "npc-sale-note"), false);
});
