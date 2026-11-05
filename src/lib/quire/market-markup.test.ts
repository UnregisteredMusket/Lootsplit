// Black-market markup labels (owner, 2026-11-04): players see a black-market vendor's markup as a
// description tier ("Fair Deal" … "Highway Robbery") or, if the DM chooses, the percent. The DM
// always sees the percent. One DM-only `black-market-markup` command (protocol 25) changes the
// setting: the tiers, the breakdown each viewer sees (copper unchanged), the command's permission,
// stale check and replay in rooms and on the device, old data, older clients' journal writes, the
// player projection, and (owner decision, no change) charges on unidentified items.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type Command } from "./commands.ts";
import { preserveJournalMetadata, readJournal } from "./journal.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { projectRecord } from "./session-records.ts";
import { projectIdentities } from "./item-identity.ts";
import { fromCopper } from "./money.ts";
import { breakdownLines, shopBuyBreakdown, viewerBreakdown } from "./price-breakdown.ts";
import {
  MARKUP_TIERS,
  markupDisplay,
  markupPercent,
  markupTier,
  playerMarkupText,
  shopMarkupNote,
} from "./market-markup.ts";
import {
  CURRENT_TABLETOP_PROTOCOL,
  ITEM_IDENTITY_PROTOCOL,
  MARKET_MARKUP_PROTOCOL,
  tableForProtocol,
  tabletopResponse,
} from "./tabletop-protocol.ts";
import type { Shop } from "./types.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of [
  "0001_campaign_rooms.sql",
  "0019_campaign_room_reports.sql",
  "0024_campaign_room_receipts.sql",
  "0026_campaign_room_sections.sql",
  "0029_campaign_room_report_parts.sql",
  "0030_campaign_room_archive_keys.sql",
  "0003_accounts.sql",
  "0008_encounters.sql",
])
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

const shop: Shop = {
  id: "bm",
  name: "Back room",
  keeper: "",
  place: "",
  notes: "",
  sellRate: 1.1,
  buyRate: 0.5,
  wealth: "modest",
  category: "general",
  priceScale: 1,
  blackMarket: true,
  blackMarketPremium: 1.5,
};
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "aria", name: "Aria Thorne", kind: "character", coins: fromCopper(100000) },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: fromCopper(100000) },
    ],
    shops: [shop],
    stock: [{ id: "blade", shopId: "bm", name: "Blade", copper: 1000, baseCopper: 1000, rarity: "common", quantity: null, notes: "", category: "smith" }],
    journal: readJournal({ world: { blackMarketActive: true } }),
  };
}
const dmSeat: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const ariaSeat: CloudSeat = { id: "a", token: "", name: "Aria", role: "player", purseIds: ["aria"] };
const setTo = (t: CloudTable, id: string, display: "descriptions" | "percentages"): Command => ({
  id,
  kind: "black-market-markup",
  before: markupDisplay(t.journal),
  display,
});

test("tiers: by percent over list from the premium alone, with inclusive boundaries", () => {
  const cases: [number, string][] = [
    [1.01, "Fair Deal"],
    [1.1, "Fair Deal"],
    [1.1001, "Fair Deal"], // 10.0% after rounding to one decimal, as shown
    [1.101, "Slightly Above Average"],
    [1.25, "Slightly Above Average"],
    [1.251, "Pricey"],
    [1.5, "Pricey"], // the default premium
    [1.501, "Steep"],
    [2, "Steep"],
    [2.001, "Highway Robbery"],
    [3.3, "Highway Robbery"],
    [100, "Highway Robbery"],
  ];
  for (const [premium, label] of cases) assert.equal(markupTier(premium), label, String(premium));
  assert.deepEqual(MARKUP_TIERS.map((t) => t.label), ["Fair Deal", "Slightly Above Average", "Pricey", "Steep", "Highway Robbery"]);
  assert.equal(markupPercent(1.1), 10);
  assert.equal(markupPercent(1.333), 33.3);
  assert.equal(playerMarkupText(1.5, "descriptions"), "Pricey");
  assert.equal(playerMarkupText(1.5, "percentages"), "+50%");
  // The shop's own sell rate is not part of the tier.
  assert.equal(markupTier(shop.blackMarketPremium!), "Pricey");
  assert.equal(shopMarkupNote(1.5, "descriptions", false), "Pricey");
  assert.equal(shopMarkupNote(1.5, "percentages", false), "+50%");
  assert.equal(shopMarkupNote(1.5, "descriptions", true), "+50%, players see Pricey");
  assert.equal(shopMarkupNote(1.5, "percentages", true), "+50%, players see the percent");
});

test("old data: a campaign without the setting means descriptions", () => {
  assert.equal(markupDisplay(undefined), "descriptions");
  assert.equal(markupDisplay(readJournal({})), "descriptions");
  assert.equal(markupDisplay(readJournal({ blackMarketMarkup: "percentages" })), "percentages");
  // An unknown stored value is refused by the schema; a lenient read never shows percentages.
  assert.throws(() => readJournal({ blackMarketMarkup: "shout" }));
  assert.equal(markupDisplay({ blackMarketMarkup: "shout" as never }), "descriptions");
});

test("breakdown: players see the description or the percent; the DM sees both; copper unchanged", () => {
  const descriptions = shopBuyBreakdown(shop, 1000, 14, 2);
  const percents = shopBuyBreakdown(shop, 1000, 14, 2, { markup: "percentages" });
  for (const b of [descriptions, percents]) assert.equal(b.total, shopBuyBreakdown(shop, 1000, 14, 2, { markup: "descriptions" }).total);
  // 1000 × 1.1 = 1100; × 1.5 = 1650 (+550); Charisma 14 takes 4% (−66).
  const player = viewerBreakdown(descriptions, false);
  const lines = breakdownLines(player);
  assert.deepEqual(lines.slice(0, -1), [
    "List price: 1,000 cp",
    "Shop sells at 110%: +100 cp",
    "Black-market markup: Pricey: +550 cp",
    "Charisma 14, 4% off: −66 cp",
    "1,584 cp each × 2",
  ]);
  assert.match(lines.at(-1)!, /^Total: 3,168 cp/);
  const markup = player.factors.find((f) => f.key === "black-market")!;
  assert.equal(markup.percent, undefined, "description mode carries no percent");
  assert.equal("player" in markup, false);
  assert.doesNotMatch(JSON.stringify(player), /\+50|50%|"percent":50/);
  const playerPercent = viewerBreakdown(percents, false).factors.find((f) => f.key === "black-market")!;
  assert.equal(playerPercent.label, "Black-market markup +50%");
  assert.equal(playerPercent.percent, 50);
  assert.equal(playerPercent.copper, 550);
  // The DM always sees the percent and what players get.
  assert.equal(viewerBreakdown(descriptions, true).factors[1]!.label, 'Black-market markup +50% (players see "Pricey")');
  assert.equal(viewerBreakdown(percents, true).factors[1]!.label, "Black-market markup +50% (players see the percent)");
  // Not folded into "Other adjustments" any more.
  assert.equal(player.factors.some((f) => f.key === "other"), false);
  // The default premium (no stored premium) is the 1.5 the engine charges.
  const { blackMarketPremium: _p, ...plain } = shop;
  assert.match(JSON.stringify(viewerBreakdown(shopBuyBreakdown(plain, 1000, null), false)), /Pricey/);
});

test("the setting: DM-only, stale-checked, logged once, and removed again for descriptions", () => {
  const t = campaign();
  assert.throws(() => applyCommand(t, ariaSeat, setTo(t, "p1", "percentages")), /Only the DM/);
  assert.throws(
    () => applyCommand(t, dmSeat, { id: "p2", kind: "black-market-markup", before: "percentages", display: "descriptions" }),
    /changed\. Refresh/,
  );
  const on = applyCommand(t, dmSeat, setTo(t, "p3", "percentages"));
  assert.equal(on.journal!.blackMarketMarkup, "percentages");
  const events = on.journal!.events.filter((e) => e.id.startsWith("p3"));
  assert.deepEqual(events.map((e) => e.summary), ["Players see black-market markup as percentages"]);
  // Resending the same change is refused by the stale check (receipts make retries no-ops in
  // rooms and on the device: tested below).
  assert.throws(() => applyCommand(on, dmSeat, setTo(t, "p3", "percentages")), /changed\. Refresh/);
  const off = applyCommand(on, dmSeat, setTo(on, "p4", "descriptions"));
  assert.equal("blackMarketMarkup" in off.journal!, false, "descriptions restore the stored shape of a campaign that never had it");
  // No money or stock moves.
  assert.deepEqual(off.purses, t.purses);
  assert.deepEqual(off.stock, t.stock);
});

test("older clients: their whole-journal writes keep the stored setting; protocol 25 drafts finish on the website", () => {
  const on = applyCommand(campaign(), dmSeat, setTo(campaign(), "p1", "percentages"));
  const current = readJournal(on.journal);
  // An older client drops the unknown key and writes the journal back.
  const { blackMarketMarkup: _dropped, ...old } = current;
  assert.equal(preserveJournalMetadata(old, current).blackMarketMarkup, "percentages");
  // A journal write can't change it either: only the command does.
  assert.equal(preserveJournalMetadata({ ...current, blackMarketMarkup: "descriptions" }, readJournal({})).blackMarketMarkup, undefined);
  // The journal schema is not strict, so every protocol gets the same table.
  assert.equal(tableForProtocol(on, 0).journal!.blackMarketMarkup, "percentages");
  assert.equal(MARKET_MARKUP_PROTOCOL, 25);
  assert.ok(CURRENT_TABLETOP_PROTOCOL >= MARKET_MARKUP_PROTOCOL);
  const table = projectRecord(on, ariaSeat);
  const draft = JSON.stringify([{ id: "d", kind: "black-market-markup", before: "descriptions", display: "percentages" }]);
  assert.throws(() => tabletopResponse({ table, draft }, ITEM_IDENTITY_PROTOCOL), /updated Lootsplitter client/);
  assert.throws(() => tabletopResponse({ table, draft }, 0), /updated Lootsplitter client/);
  assert.equal(tabletopResponse({ table, draft }, MARKET_MARKUP_PROTOCOL).table, table);
  assert.equal(tabletopResponse({ table, draft: "[]" }, ITEM_IDENTITY_PROTOCOL).table.journal!.blackMarketMarkup, "percentages");
});

test("projection: players receive the setting and the premium (owner decision), nothing else changes", () => {
  const on = applyCommand(campaign(), dmSeat, setTo(campaign(), "p1", "percentages"));
  const view = projectRecord(on, ariaSeat);
  assert.equal(view.journal!.blackMarketMarkup, "percentages");
  assert.equal(view.shops.find((s) => s.id === "bm")!.blackMarketPremium, 1.5);
  assert.equal(markupDisplay(projectRecord(campaign(), ariaSeat).journal), "descriptions");
  // The setting's event is a public management event, never another player's data.
  assert.ok(view.journal!.events.some((e) => e.summary === "Players see black-market markup as percentages"));
  assert.equal(view.journal!.events.some((e) => "change" in e), false);
});

test("shared rooms: the server refuses players, a retry applies once, and players' views follow", async () => {
  const dm = await openRoom({ name: "Markup DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const DT = { code: dm.code, token: dm.token };
  const AT = { code: dm.code, token: aria.token };
  await choosePace({ ...DT, live: true });
  const state = async () => (await roomState(DT)).table;
  await assert.rejects(
    submitCommands({ ...AT, batchId: "r0", commands: [setTo(await state(), "r0", "percentages")] }),
  );
  assert.equal((await state()).journal!.blackMarketMarkup, undefined);
  const cmd = setTo(await state(), "r1", "percentages");
  await submitCommands({ ...DT, batchId: "r1", commands: [cmd] });
  await submitCommands({ ...DT, batchId: "r1", commands: [cmd] });
  const table = await state();
  assert.equal(table.journal!.blackMarketMarkup, "percentages");
  assert.equal(table.journal!.events.filter((e) => e.id.startsWith("r1")).length, 1, "a retry changes nothing");
  assert.equal((await roomState(AT)).table.journal!.blackMarketMarkup, "percentages");
  // The buy price is unchanged by the setting.
  await submitCommands({ ...AT, batchId: "r2", commands: [{ id: "r2", kind: "buy", stockId: "blade", purseId: "aria", quantity: 1 }] });
  const paid = (await state()).ledger.find((l) => l.purseId === "aria" && l.copper < 0)!;
  assert.equal(-paid.copper, shopBuyBreakdown(shop, 1000, null, 1, { markup: "percentages" }).total);
  assert.equal(-paid.copper, shopBuyBreakdown(shop, 1000, null, 1).total);
});

test("offline: the device runs the same command with the same result, and a retry applies once", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  let shared = campaign();
  const steps: Command[] = [];
  for (const [id, display] of [["d1", "percentages"], ["d2", "descriptions"], ["d3", "percentages"]] as const) {
    const c = setTo(shared, id, display);
    steps.push(c);
    shared = applyCommand(shared, dmSeat, c);
  }
  for (const s of steps) await executeLocalCommand(s);
  const once = await economySnapshot();
  for (const s of steps) await executeLocalCommand(s);
  const twice = await economySnapshot();
  const summaries = (t: { journal?: CloudTable["journal"] }) =>
    (t.journal?.events ?? []).filter((e) => /black-market markup/.test(e.summary)).map((e) => [e.id, e.summary]);
  assert.equal(once.journal!.blackMarketMarkup, shared.journal!.blackMarketMarkup);
  assert.equal(once.journal!.blackMarketMarkup, "percentages");
  assert.deepEqual(summaries(once), summaries(shared));
  assert.deepEqual(summaries(twice), summaries(once), "retries change nothing");
  const stale = await executeLocalCommand({ ...steps[0]!, id: "d4" }).catch((e: Error) => e.message);
  assert.match(String(stale), /changed/);
  setSeat({ role: "player", purseIds: ["aria"], shopIds: [], openedAt: 0 });
  const link = await executeLocalCommand(setTo(shared, "d5", "descriptions")).catch((e: Error) => e.message);
  assert.match(String(link), /DM/);
  setSeat(DM_SEAT);
});

test("charges (owner decision, unchanged): a player's view of an unidentified item still carries its charges", () => {
  const t = campaign();
  t.holdings.push({
    id: "wand",
    purseId: "aria",
    name: "Wand of Secret Things",
    kind: "item",
    quantity: 1,
    unitCopper: 50000,
    notes: "True notes",
    uses: { current: 5, max: 7, whenEmpty: "keep" },
    unidentified: { name: "Carved stick" },
  });
  // As the server builds a player's room view (cloud.server.ts seatTable).
  const view = projectIdentities(t, projectRecord(t, ariaSeat));
  const wand = view.holdings.find((h) => h.id === "wand")!;
  assert.equal(wand.name, "Carved stick");
  assert.deepEqual(wand.uses, { current: 5, max: 7, whenEmpty: "keep" });
  assert.doesNotMatch(JSON.stringify(view), /Secret Things|True notes/);
});
