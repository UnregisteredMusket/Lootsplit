// Hidden names (audit 2026-11-10, B2 and B3): a transfer to a hidden NPC or an exchange treasury
// never names it in player chat, a player cannot pay a purse they cannot see, and an NPC barter
// refusal never names an NPC the player cannot see. Shared rooms (protocols 11 and 33) and the
// device engine. Disposable in-memory campaigns only; never a real campaign.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type CommandInput } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { readTradeEconomy } from "./trade-economy-schema.ts";
import { fromCopper, toCopper } from "./money.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { projectRecord } from "./session-records.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { canonicalJson } from "./canonical-json.ts";
import { quoteNpcBarter } from "./npc-barter.ts";
import { worldImportFingerprint } from "./world.ts";
import { barterFixture } from "./test-fixtures/npc-barter.ts";

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

const dmSeat: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const UNKNOWN = "Choose a different recipient.";
let n = 0;
const run = (t: CloudTable, input: CommandInput, seat: CloudSeat = dmSeat) =>
  applyCommand(t, seat, { ...input, id: `hidden-names-${++n}` } as never);

/** Aria and Bram travel with the party; a hidden NPC, a visible NPC and two exchanges. */
function campaign(): CloudTable {
  let t: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: fromCopper(100000) },
      { id: "aria", name: "Aria Thorne", kind: "character", coins: fromCopper(5000) },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: fromCopper(5000) },
      { id: "harbor-treasury", name: "Harbor exchange treasury", kind: "character", nonParty: true, control: "npc", coins: fromCopper(50000) },
      { id: "smuggler-treasury", name: "SECRET Smugglers treasury", kind: "character", nonParty: true, control: "npc", coins: fromCopper(50000) },
    ],
    holdings: [
      { id: "gem", purseId: "hoard", name: "Ruby", kind: "item", quantity: 3, unitCopper: 1000, notes: "" },
      { id: "rope", purseId: "aria", name: "Silk rope", kind: "item", quantity: 2, unitCopper: 100, notes: "" },
    ],
    journal: readJournal({
      market: {
        currentLocationId: "city",
        locations: [
          { id: "region", name: "Eastmarch", kind: "region", parentId: null, description: "" },
          { id: "city", name: "Port", kind: "city", parentId: "region", description: "" },
        ],
      },
      sessions: [{ id: "session", name: "Adventure", startedAt: 1 }],
      tradeEconomy: readTradeEconomy({
        settings: { enabled: true },
        exchanges: [
          { id: "harbor", name: "Harbor exchange", locationId: "city", purseId: "harbor-treasury", open: true, visible: true, notes: "", offers: [] },
          { id: "smugglers", name: "SECRET Smugglers exchange", locationId: "city", purseId: "smuggler-treasury", open: true, visible: false, notes: "", offers: [] },
        ],
      }),
    }),
  };
  for (const [id, name, visible] of [
    ["spy", "SECRET Spymaster", false],
    ["guide", "Guide Hollin", true],
  ] as const)
    t = run(t, {
      kind: "npc-create",
      npc: { id, name, description: "", locationId: "city", visible, barterAllowed: false, controllerPurseId: null },
      copper: 1000,
      inventory: [],
    } as CommandInput);
  return t;
}

async function room() {
  const dm = await openRoom({ name: "Hidden names", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  await choosePace({ ...dm, live: true });
  return { dm, aria };
}
const give = (id: string, fromId: string, toId: string, copper: number, holdingId: string | null = null, quantity = 0) => ({
  id,
  kind: "give" as const,
  fromId,
  toId,
  copper,
  holdingId,
  quantity,
});
const copperOf = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);

test("B2: the DM's transfer to a hidden NPC or an exchange treasury is never named in a player's room (protocols 11 and 33)", async () => {
  const { dm, aria } = await room();
  const transfers = [
    give("to-spy", "hoard", "spy", 500),
    give("to-spy-item", "hoard", "spy", 0, "gem", 1),
    give("to-smugglers", "hoard", "smuggler-treasury", 700),
    give("to-harbor", "hoard", "harbor-treasury", 300),
  ];
  for (const command of transfers) await submitCommands({ ...dm, batchId: command.id, commands: [command] });
  const host = (await roomState(dm)).table;
  assert.equal(copperOf(host, "spy"), 1500);
  assert.equal(copperOf(host, "smuggler-treasury"), 50700);
  assert.equal(host.holdings.find((h) => h.purseId === "spy")?.quantity, 1);
  // The DM still reads every transfer note.
  for (const command of transfers) assert.ok(host.notes.some((note) => note.id === `${command.id}-note`), command.id);
  for (const tabletopProtocol of [11, 33]) {
    const player = await roomState({ ...aria, code: dm.code, tabletopProtocol });
    const text = JSON.stringify(player);
    assert.doesNotMatch(text, /SECRET/, `protocol ${tabletopProtocol}`);
    for (const command of transfers)
      assert.equal(player.table.notes.some((note) => note.id === `${command.id}-note`), false, `${command.id} protocol ${tabletopProtocol}`);
  }
  // A transfer between visible party characters still reaches the party.
  await submitCommands({ ...dm, batchId: "to-bram", commands: [give("to-bram", "hoard", "bram", 100)] });
  const player = await roomState({ ...aria, code: dm.code, tabletopProtocol: 33 });
  assert.match(player.table.notes.find((note) => note.id === "to-bram-note")!.text, /Bram Ironfoot/);
});

test("B2: a player cannot pay a hidden NPC, a hidden exchange treasury or with an item; the refusal reads as an unknown ID", async () => {
  const { dm, aria } = await room();
  const before = (await roomState(dm)).table;
  const refusal = async (command: ReturnType<typeof give>) =>
    submitCommands({ code: dm.code, token: aria.token, batchId: command.id, commands: [command] }).then(
      () => "accepted",
      (error: Error) => error.message,
    );
  const unknown = await refusal(give("p-unknown", "aria", "no-such-purse", 1));
  assert.match(unknown, new RegExp(UNKNOWN.replace(".", "\\.")));
  for (const command of [
    give("p-spy", "aria", "spy", 1),
    give("p-spy-item", "aria", "spy", 0, "rope", 1),
    give("p-smugglers", "aria", "smuggler-treasury", 1),
    give("p-smugglers-item", "aria", "smuggler-treasury", 0, "rope", 1),
  ]) {
    const message = await refusal(command);
    assert.equal(message, unknown, command.id);
    assert.doesNotMatch(message, /SECRET/);
  }
  const after = (await roomState(dm)).table;
  for (const id of ["aria", "spy", "smuggler-treasury"]) assert.equal(copperOf(after, id), copperOf(before, id), id);
  assert.deepEqual(after.holdings, before.holdings);
  assert.deepEqual(after.notes.map((note) => note.id), before.notes.map((note) => note.id));
  // A visible party character remains a valid recipient.
  await submitCommands({ code: dm.code, token: aria.token, batchId: "p-bram", commands: [give("p-bram", "aria", "bram", 1)] });
  assert.equal(copperOf((await roomState(dm)).table, "bram"), copperOf(before, "bram") + 1);
});

test("B2 device parity: the DM's device files the hidden recipient's note for the DM only, as the room does", async () => {
  const { dm } = await room();
  setSeat(DM_SEAT);
  await applyCloudTable((await roomState(dm)).table);
  for (const command of [give("d-spy", "hoard", "spy", 500), give("d-smugglers", "hoard", "smuggler-treasury", 0, "gem", 1), give("d-bram", "hoard", "bram", 100)]) {
    await submitCommands({ ...dm, batchId: command.id, commands: [command] });
    await executeLocalCommand(command);
    const roomNote = (await roomState(dm)).table.notes.find((note) => note.id === `${command.id}-note`)!;
    const deviceNote = (await economySnapshot()).notes.find((note) => note.id === `${command.id}-note`)!;
    // The seat's display name differs ("Dungeon master" on the device); everything else matches.
    const same = (note: typeof roomNote) => ({ ...note, at: 0, text: note.text.replace(/^.* transferred /, "") });
    assert.deepEqual(same(deviceNote), same(roomNote), command.id);
  }
  const device = await economySnapshot();
  const player = projectRecord(device, { role: "player", purseIds: ["aria"] }, { directory: true });
  assert.doesNotMatch(JSON.stringify(player.notes), /SECRET/);
  assert.ok(player.notes.some((note) => note.id === "d-bram-note"));
});

test("B2 shared engine: a player's give to a purse outside their projection is refused before anything moves", () => {
  const t = campaign();
  const aria: CloudSeat = { id: "a", token: "a", name: "Aria", role: "player", purseIds: ["aria"] };
  for (const toId of ["spy", "smuggler-treasury", "missing"])
    assert.throws(() => applyCommand(t, aria, give(`e-${toId}`, "aria", toId, 1)), { message: UNKNOWN });
  // Old saves: a DM's give to any purse still applies.
  const after = applyCommand(t, dmSeat, give("e-dm", "hoard", "spy", 1));
  assert.equal(copperOf(after, "spy"), 1001);
  assert.equal(after.notes.at(-1)!.to, "dm");
});

// B3: NPC barter refusals name no NPC the player cannot see.
const elsewhere = [
  { id: "far-region", name: "Far Reach", kind: "region" as const, parentId: null, description: "" },
  { id: "far", name: "Far Harbor", kind: "city" as const, parentId: "far-region", description: "" },
];
function barterCampaign(): { t: CloudTable; ids: { visible: string; hidden: string; away: string; off: string } } {
  let t = barterFixture();
  t.journal!.market!.locations.push(...elsewhere);
  const npc = (name: string, locationId: string, visible: boolean, barterAllowed: boolean) => ({
    name,
    description: "",
    locationId,
    visible,
    barterAllowed,
    controllerPurseId: null,
    copper: 1000,
    inventory: [{ name: "Trinket", quantity: 1, unitCopper: 100, notes: "", category: "curios" }],
  });
  const importId = "b3-import";
  const before = canonicalJson(t);
  const document = {
    format: "lootsplit.npcs" as const,
    schemaVersion: 1 as const,
    npcs: [
      npc("Visible Vendor", "row", true, true),
      npc("SECRET Hidden Barterer", "row", false, true),
      npc("SECRET Distant Trader", "far", true, true),
      npc("SECRET Quiet Spy", "row", false, false),
    ],
  };
  t = applyCommand(t, dmSeat, { id: importId, kind: "npc-import", before: worldImportFingerprint(t), document } as never);
  // Replaying the same import command on the same campaign gives the same IDs (idempotent).
  const again = applyCommand(JSON.parse(before), dmSeat, { id: importId, kind: "npc-import", before: worldImportFingerprint(JSON.parse(before)), document } as never);
  const named = (table: CloudTable, name: string) => table.journal!.world!.npcs.find((x) => x.name === name)!.id;
  for (const name of document.npcs.map((x) => x.name)) assert.equal(named(again, name), named(t, name));
  const ids = {
    visible: named(t, "Visible Vendor"),
    hidden: named(t, "SECRET Hidden Barterer"),
    away: named(t, "SECRET Distant Trader"),
    off: named(t, "SECRET Quiet Spy"),
  };
  return { t, ids };
}
const mira: CloudSeat = { id: "mira-seat", userId: "user-mira", token: "m", name: "Mira", role: "player", purseIds: ["mira"] };
function barterOffer(t: CloudTable, npcId: string) {
  const trinket = t.holdings.find((h) => h.purseId === npcId)!;
  return {
    npcId,
    purseId: "mira",
    give: { purseId: "mira", copper: 500, items: [] },
    ask: { purseId: npcId, copper: 0, items: [{ holdingId: trinket.id, quantity: 1, before: canonicalJson(trinket) }] },
  };
}

test("B3: imported NPC IDs are not sequential from the command ID", () => {
  const { ids } = barterCampaign();
  for (const id of Object.values(ids)) assert.doesNotMatch(id, /^b3-import-npc-\d+$/);
  assert.equal(new Set(Object.values(ids)).size, 4);
});

test("B3: quotes and offers against a hidden, distant or barter-off NPC answer only 'This NPC is no longer here.'", () => {
  const { t, ids } = barterCampaign();
  // The visible NPC still quotes for the player.
  assert.ok(quoteNpcBarter(t, mira, barterOffer(t, ids.visible)));
  for (const id of [ids.hidden, ids.away, ids.off, "b3-import-npc-1", "b3-import-npc-3"]) {
    const offer = barterOffer(t, id === "b3-import-npc-1" ? ids.hidden : id === "b3-import-npc-3" ? ids.off : id);
    if (id.startsWith("b3-import")) {
      offer.npcId = id;
      offer.ask.purseId = id;
    }
    assert.throws(() => quoteNpcBarter(t, mira, offer), { message: "This NPC is no longer here." }, id);
    assert.throws(
      () => applyCommand(t, mira, { id: `offer-${id}`, kind: "npc-barter-offer", ...offer, reply: "offer" } as never, { source: "server", random: () => 1 }),
      { message: "This NPC is no longer here." },
      id,
    );
  }
  // The DM keeps the named, specific reasons.
  assert.throws(() => quoteNpcBarter(t, dmSeat, barterOffer(t, ids.off)), /SECRET Quiet Spy doesn't trade on their own/);
});

test("B3 device parity: the device engine refuses a player's offer with the same generic text", async () => {
  const { t, ids } = barterCampaign();
  setSeat(DM_SEAT);
  await applyCloudTable(t);
  setSeat({ role: "player", purseIds: ["mira"], shopIds: [], openedAt: 0 });
  try {
    for (const id of [ids.hidden, ids.away, ids.off]) {
      const offer = { id: `device-${id}`, kind: "npc-barter-offer" as const, ...barterOffer(t, id), reply: "offer" as const };
      const device = await executeLocalCommand(offer as never).then(() => "accepted", (e: Error) => e.message);
      assert.equal(device, "This NPC is no longer here.", id);
    }
  } finally {
    setSeat(DM_SEAT);
  }
});
