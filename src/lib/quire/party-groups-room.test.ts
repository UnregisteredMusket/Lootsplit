// Split the party in shared rooms and on the device: the projection each seat receives (player A,
// player B, the DM, a hidden group), idempotent command IDs, older apps refused on the server,
// per-group services, and the device engine writing exactly what the room writes.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import type { CloudTable } from "./cloud.ts";
import { applyCommand } from "./commands.ts";
import { toCopper } from "./money.ts";
import { applyCloudTable, buyFromShop, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { partyGroupsFingerprint } from "./party-groups.ts";
import { providerLock } from "./services.ts";
import { partyFixture, splitFixture, dm as dmSeat } from "./test-fixtures/party-groups.ts";
import { orderCommand, request, servicesFixture, svcDm, svcThorn } from "./test-fixtures/services.ts";

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

async function room(table: CloudTable = partyFixture()) {
  const dm = await openRoom({ name: "Sunken Crown DM", table });
  const sam = await joinRoom({ code: dm.code, purseId: "brannoc", name: "Sam" });
  const alex = await joinRoom({ code: dm.code, purseId: "tamsin", name: "Alex" });
  await choosePace({ ...dm, live: true });
  return { dm, sam, alex };
}
const split = (t: CloudTable, id = "split-room") => ({
  id,
  kind: "party-split" as const,
  before: partyGroupsFingerprint(t),
  main: { name: "Harbour watch", colour: "green" as const },
  groups: [{ id: "riders", name: "Ironhold riders", colour: "blue" as const, locationId: "ironhold", memberIds: ["tamsin", "kettle", "maud"] }],
});
const P = 10;

test("room: the split is applied once however often its command ID is retried", async () => {
  const { dm } = await room();
  const host = (await roomState(dm)).table;
  const cmd = split(host);
  await submitCommands({ ...dm, tabletopProtocol: P, batchId: "s1", commands: [cmd] });
  const once = (await roomState(dm)).table;
  await submitCommands({ ...dm, tabletopProtocol: P, batchId: "s1-retry", commands: [cmd] });
  const twice = (await roomState(dm)).table;
  assert.deepEqual(twice.journal!.world!.groups, once.journal!.world!.groups);
  assert.equal(twice.journal!.events.length, once.journal!.events.length);
});

test("room projection: both groups keep party balances; each sees its own place's shops; hidden group is Elsewhere", async () => {
  const { dm, sam, alex } = await room();
  await submitCommands({ ...dm, tabletopProtocol: P, batchId: "s", commands: [split((await roomState(dm)).table)] });
  const forSam = (await roomState({ code: dm.code, token: sam.token })).table;
  const forAlex = (await roomState({ code: dm.code, token: alex.token })).table;
  // Shared while split (owner decision): Brannoc reads Tamsin's coins and vice versa.
  assert.equal(toCopper(forSam.purses.find((p) => p.id === "tamsin")!.coins), 1794);
  assert.equal(toCopper(forAlex.purses.find((p) => p.id === "brannoc")!.coins), 4130);
  assert.deepEqual(forSam.shops.map((s) => s.id).sort(), ["chandlery", "peddler"]);
  assert.deepEqual(forAlex.shops.map((s) => s.id).sort(), ["armoury", "peddler"]);
  // Players see where the other group is unless it is hidden.
  assert.equal(forSam.journal!.world!.groups![0]!.locationId, "ironhold");
  // Hidden NPC members never show up for players.
  assert.equal(JSON.stringify(forSam).includes("Sister Maud"), false);
  assert.equal(JSON.stringify(forAlex).includes("Sister Maud"), false);
  // The DM hides the riders.
  const host = (await roomState(dm)).table;
  await submitCommands({
    ...dm,
    tabletopProtocol: P,
    batchId: "hide",
    commands: [{ id: "hide", kind: "party-group-edit", before: partyGroupsFingerprint(host), groupId: "riders", name: "Ironhold riders", colour: "blue", hidden: true }],
  });
  const hiddenSam = (await roomState({ code: dm.code, token: sam.token })).table;
  const hiddenAlex = (await roomState({ code: dm.code, token: alex.token })).table;
  const forDm = (await roomState(dm)).table;
  assert.equal(hiddenSam.journal!.world!.groups![0]!.locationId, null);
  assert.equal(hiddenSam.journal!.world!.groups![0]!.position!.description, "Elsewhere");
  assert.equal(hiddenSam.journal!.events.some((e) => /Ironhold riders at Ironhold/.test(e.summary)), false);
  assert.equal(hiddenAlex.journal!.world!.groups![0]!.locationId, "ironhold");
  assert.equal(forDm.journal!.world!.groups![0]!.locationId, "ironhold");
  assert.equal(forDm.journal!.world!.characterPositions.find((s) => s.purseId === "maud")!.groupId, "riders");
  // Balances stay shared even when the other group is hidden.
  assert.equal(toCopper(hiddenSam.purses.find((p) => p.id === "tamsin")!.coins), 1794);
});

test("room: older apps (protocol 9) are refused when acting for a character outside the main group", async () => {
  const { dm, sam, alex } = await room();
  await submitCommands({ ...dm, tabletopProtocol: P, batchId: "s", commands: [split((await roomState(dm)).table)] });
  const alexAuth = { code: dm.code, token: alex.token };
  await assert.rejects(
    submitCommands({ ...alexAuth, tabletopProtocol: 9, batchId: "old-buy", commands: [{ id: "old-buy", kind: "buy", stockId: "sword", purseId: "tamsin", quantity: 1 }] }),
    /The party is split into groups. Update Lootsplitter to act for Tamsin Reed\./,
  );
  await assert.rejects(
    submitCommands({ ...alexAuth, batchId: "no-protocol", commands: [{ id: "no-protocol", kind: "buy", stockId: "sword", purseId: "tamsin", quantity: 1 }] }),
    /Update Lootsplitter/,
  );
  // Nothing changed.
  assert.equal(toCopper((await roomState(dm)).table.purses.find((p) => p.id === "tamsin")!.coins), 1794);
  // The main group's players keep playing on an older app.
  await submitCommands({ code: dm.code, token: sam.token, tabletopProtocol: 9, batchId: "old-rope", commands: [{ id: "old-rope", kind: "buy", stockId: "rope", purseId: "brannoc", quantity: 1 }] });
  // An updated app acts for Tamsin at Ironhold.
  await submitCommands({ ...alexAuth, tabletopProtocol: P, batchId: "new-buy", commands: [{ id: "new-buy", kind: "buy", stockId: "sword", purseId: "tamsin", quantity: 1 }] });
  assert.equal(toCopper((await roomState(dm)).table.purses.find((p) => p.id === "tamsin")!.coins), 1794 - 1500);
  // Group commands themselves need the updated app.
  await assert.rejects(
    submitCommands({ ...alexAuth, tabletopProtocol: 9, batchId: "old-req", commands: [{ id: "old-req", kind: "party-group-request", requestId: "r", groupId: "riders", purseId: "tamsin", locationId: "undercroft" }] }),
    /Update Lootsplitter/,
  );
});

test("services follow the paying character's group", () => {
  let t = servicesFixture();
  // Thorn and Kael split: Thorn's group goes to Saltmere, away from the Temple of the Dawn.
  t = applyCommand(t, svcDm, {
    id: "svc-split",
    kind: "party-split",
    before: partyGroupsFingerprint(t),
    groups: [{ id: "thorn-group", name: "Saltmere road", colour: "blue", locationId: "saltmere", memberIds: ["thorn"] }],
  } as never);
  const provider = t.journal!.services!.providers.find((p) => p.id === "dawn-temple")!;
  assert.equal(providerLock(t, provider as never, "kael"), "");
  assert.equal(providerLock(t, provider as never, "thorn"), "Thorn isn't at Temple of the Dawn.");
  assert.throws(() => applyCommand(t, svcThorn, orderCommand(t, "thorn-rc", "remove-curse", "thorn", request("thorn"))), /isn't at Temple of the Dawn/);
});

/** What group commands may change, without wall-clock times. */
function outcome(t: CloudTable) {
  const byId = <T extends { purseId: string }>(rows: T[]) => [...rows].sort((x, y) => x.purseId.localeCompare(y.purseId));
  const w = t.journal!.world!;
  return {
    groups: (w.groups ?? []).map((g) => ({ ...g, createdAt: 0, ...(g.mergedAt ? { mergedAt: 0 } : {}) })),
    main: w.mainGroup ?? null,
    requests: (w.groupRequests ?? []).map((r) => ({ ...r, createdAt: 0, ...(r.decidedAt ? { decidedAt: 0 } : {}) })),
    positions: byId(w.characterPositions),
    location: t.journal!.market!.currentLocationId,
    events: t.journal!.events.map(({ at: _at, id: _id, ...e }) => e),
    purses: [...t.purses].sort((a, b) => a.id.localeCompare(b.id)).map((p) => ({ id: p.id, coins: toCopper(p.coins) })),
  };
}

test("differential: the device engine writes exactly what the shared room writes", async () => {
  const { dm } = await room();
  setSeat(DM_SEAT);
  await applyCloudTable((await roomState(dm)).table);
  const steps: ((t: CloudTable) => Record<string, unknown>)[] = [
    (t) => split(t, "diff-split"),
    () => ({ id: "diff-move", kind: "party-location", groupId: "riders", before: "ironhold", locationId: "undercroft" }),
    (t) => ({ id: "diff-edit", kind: "party-group-edit", before: partyGroupsFingerprint(t), groupId: "riders", name: "Undercroft riders", colour: "teal", hidden: false }),
    (t) => ({ id: "diff-assign", kind: "party-group-assign", before: partyGroupsFingerprint(t), purseId: "kettle", groupId: "main" }),
    () => ({ id: "diff-buy", kind: "buy", stockId: "sword", purseId: "tamsin", quantity: 1 }),
    () => ({ id: "diff-back", kind: "party-location", groupId: "riders", before: "undercroft", locationId: "harbour" }),
    (t) => ({ id: "diff-merge", kind: "party-merge", before: partyGroupsFingerprint(t), groupIds: ["main", "riders"], intoLocationId: "harbour" }),
  ];
  let last: Record<string, unknown> = {};
  for (const step of steps) {
    // Each engine stamps its own times, so each command compares against its own table.
    const cmd = step((await roomState(dm)).table) as never as { id: string };
    await submitCommands({ ...dm, tabletopProtocol: P, batchId: cmd.id, commands: [cmd] });
    last = step(await economySnapshot());
    await executeLocalCommand(last as never);
    assert.deepEqual(outcome(await economySnapshot()), outcome((await roomState(dm)).table), cmd.id);
  }
  // A replayed command ID is a no-op on the device too.
  const before = outcome(await economySnapshot());
  await executeLocalCommand(last as never);
  assert.deepEqual(outcome(await economySnapshot()), before);
});

test("device: an offline player buys only at their own group's place", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(splitFixture());
  setSeat({ ...DM_SEAT, role: "player", purseIds: ["tamsin"] });
  await assert.rejects(buyFromShop({ stockId: "rope", purseId: "tamsin", quantity: 1 }), /not available at the current location/);
  await buyFromShop({ stockId: "sword", purseId: "tamsin", quantity: 1 });
  await buyFromShop({ stockId: "sack", purseId: "tamsin", quantity: 1 });
  setSeat({ ...DM_SEAT, role: "player", purseIds: ["brannoc"] });
  await assert.rejects(buyFromShop({ stockId: "sword", purseId: "brannoc", quantity: 1 }), /not available at the current location/);
  await buyFromShop({ stockId: "rope", purseId: "brannoc", quantity: 1 });
  setSeat(DM_SEAT);
  const t = await economySnapshot();
  assert.equal(toCopper(t.purses.find((p) => p.id === "tamsin")!.coins), 1794 - 1500 - 10);
  assert.equal(toCopper(t.purses.find((p) => p.id === "brannoc")!.coins), 4130 - 100);
  void dmSeat;
});
