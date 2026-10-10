import test from "node:test";
import assert from "node:assert/strict";
import { emptyCloudTable, readCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type CommandInput } from "./commands.ts";
import { readJournal, readArchivedSnapshot } from "./journal.ts";
import {
  characterPosition,
  characterLocation,
  inParty,
  canReadCharacter,
} from "./character-position.ts";
import { sessionTimeFingerprint } from "./session-time.ts";
import { projectRecord, archiveSession } from "./session-records.ts";
import { npcAvailableHere } from "./world.ts";
import { blankSheet } from "../characters/model.mjs";
import { characterSheet } from "../characters/campaign-sheet.mjs";
import { fromCopper } from "./money.ts";
import { libraryRecords } from "./library-records.ts";
const dm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const player: CloudSeat = {
  id: "player",
  token: "player",
  name: "Player",
  role: "player",
  purseIds: ["hero"],
};
let sequence = 0;
const act = (t: CloudTable, cmd: CommandInput, seat = dm) =>
  applyCommand(t, seat, { ...cmd, id: `placement-${++sequence}` });
function fixture() {
  let t: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      {
        id: "hero",
        name: "Hero",
        kind: "character",
        coins: fromCopper(250),
        sheet: { ...blankSheet(), name: "Hero", description: "Private hero sheet" },
      },
    ],
    journal: readJournal({
      sessions: [{ id: "session", name: "Adventure", startedAt: 1 }],
      market: {
        currentLocationId: "town",
        locations: [
          { id: "region", name: "Region", kind: "region", parentId: null, description: "" },
          { id: "town", name: "Town", kind: "city", parentId: "region", description: "" },
          { id: "away", name: "Other town", kind: "city", parentId: "region", description: "" },
        ],
      },
      finance: { day: 0, loans: [], rules: [], downtime: [] },
    }),
  };
  t = act(t, {
    kind: "npc-create",
    npc: {
      id: "npc",
      name: "Mara",
      description: "Broker",
      locationId: "town",
      visible: true,
      barterAllowed: true,
      controllerPurseId: null,
    },
    copper: 500,
    inventory: [{ name: "Gem", quantity: 2, unitCopper: 100, notes: "Carried" }],
  });
  return t;
}
const position = (t: CloudTable, id = "npc") =>
  characterPosition(
    t,
    t.purses.find((p) => p.id === id)!,
  );
function move(t: CloudTable, id: string, changes: Partial<ReturnType<typeof position>>) {
  const s = position(t, id);
  return act(t, {
    kind: "character-position",
    purseId: id,
    before: s,
    inParty: s.inParty,
    locationId: s.locationId,
    visible: s.visible,
    sheetVisible: s.sheetVisible,
    ...changes,
  });
}
test("legacy membership defaults and NPC party/list transfers preserve one wallet, sheet, items and identity", () => {
  let t = fixture();
  const original = t.purses.find((p) => p.id === "npc")!,
    holdings = structuredClone(t.holdings);
  assert.equal(inParty(t, t.purses[0]), true);
  assert.equal(position(t).inParty, false);
  t = move(t, "npc", { inParty: true, locationId: null, sheetVisible: true });
  const p = t.purses.find((p) => p.id === "npc")!;
  assert.equal(p.nonParty, false);
  assert.equal(p.sheet?.description, "Broker");
  assert.deepEqual(p.coins, original.coins);
  t = act(t, {
    kind: "character",
    purseId: p.id,
    before: characterSheet(p, t.holdings),
    sheet: { ...characterSheet(p, t.holdings), hp: 17, maxHp: 20 },
  });
  t = move(t, "npc", { inParty: false, locationId: "away" });
  assert.equal(
    characterLocation(
      t,
      t.purses.find((p) => p.id === "npc")!,
    ),
    "away",
  );
  t = act(t, { kind: "party-location", before: "town", locationId: null });
  assert.equal(
    characterLocation(
      t,
      t.purses.find((p) => p.id === "npc")!,
    ),
    "away",
  );
  t = move(t, "npc", { locationId: null });
  assert.equal(npcAvailableHere(t.journal!.world!.npcs[0], t), false);
  t = move(t, "npc", { inParty: true });
  assert.equal(t.purses.find((p) => p.id === "npc")!.sheet?.hp, 17);
  assert.deepEqual(t.holdings, holdings);
  assert.equal(t.purses.filter((p) => p.id === "npc").length, 1);
  assert.ok(readCloudTable(JSON.parse(JSON.stringify(t))));
  archiveSession(t, "archive", "Record", 1);
  assert.equal(
    readArchivedSnapshot(t.journal!.reports!.at(-1)!.snapshot).purses.find((p) => p.id === "npc")!
      .sheet?.hp,
    17,
  );
});
test("players cannot forge placement, stale placement is atomic, and assigned/return locations remain protected", () => {
  let t = fixture();
  const s = position(t, "hero");
  const cmd: CommandInput = {
    kind: "character-position",
    purseId: "hero",
    before: s,
    inParty: false,
    locationId: "away",
    visible: true,
    sheetVisible: true,
  };
  assert.throws(() => act(t, cmd, player), /Only the DM/);
  assert.equal(inParty(t, t.purses[0]), true);
  t = act(t, cmd);
  assert.throws(() => act(t, cmd), /placement changed/);
  assert.throws(() => move(t, "hero", { locationId: "missing" }), /existing location/);
  const l = t.journal!.market!.locations.find((l) => l.id === "away")!;
  assert.throws(
    () => act(t, { kind: "market-location", locationId: l.id, before: l, after: null }),
    /before removing/,
  );
});
test("NPC sheet visibility is independent from visible records, with no hidden character payload or Library entry", () => {
  let t = move(fixture(), "npc", { inParty: true, locationId: null, sheetVisible: true });
  let view = projectRecord(t, player, { directory: true });
  assert.equal(view.purses.find((p) => p.id === "npc")!.sheet?.description, "Broker");
  assert.deepEqual(view.purses.find((p) => p.id === "npc")!.coins, fromCopper(0));
  t = move(t, "npc", { sheetVisible: false });
  view = projectRecord(t, player, { directory: true });
  assert.equal(view.purses.find((p) => p.id === "npc")!.sheet, undefined);
  assert.equal(view.journal!.world!.npcs[0].name, "Mara");
  assert.equal(
    canReadCharacter(
      t,
      t.purses.find((p) => p.id === "npc")!,
      player,
    ),
    false,
  );
  t = move(t, "hero", { visible: false });
  t = move(t, "npc", { visible: false });
  view = projectRecord(t, player, { directory: true });
  assert.equal(view.purses.length, 0);
  assert.equal(view.sheets.length, 0);
  assert.equal(view.holdings.length, 0);
  assert.ok(!JSON.stringify(view).includes("Private hero sheet"));
  assert.ok(!JSON.stringify(view).includes("Mara"));
  assert.equal(
    libraryRecords(view, player).some((r) => r.kind === "Character" || r.kind === "NPC"),
    false,
  );
  assert.throws(
    () =>
      act(
        t,
        {
          kind: "character",
          purseId: "hero",
          before: characterSheet(t.purses[0]),
          sheet: characterSheet(t.purses[0]),
        },
        player,
      ),
    /unavailable/,
  );
});
test("downtime advances only through approved campaign time and restores once at the exact hour", () => {
  let t = move(fixture(), "npc", { inParty: true, locationId: null, sheetVisible: true });
  const assets = structuredClone(t.holdings),
    coins = structuredClone(t.purses.map((p) => p.coins));
  t = act(t, {
    kind: "character-downtime-start",
    purseId: "npc",
    before: position(t),
    name: "Research",
    days: 1,
    locationId: "away",
  });
  assert.equal(position(t).inParty, false);
  assert.equal(
    characterLocation(
      t,
      t.purses.find((p) => p.id === "npc")!,
    ),
    "away",
  );
  t = act(t, {
    kind: "session-time",
    before: sessionTimeFingerprint(t),
    hours: 23,
    rest: "none",
    purseIds: [],
    allowDowntime: false,
    note: "Travel",
  });
  assert.ok(position(t).downtime);
  t = act(t, {
    kind: "session-time",
    before: sessionTimeFingerprint(t),
    hours: 1,
    rest: "none",
    purseIds: [],
    allowDowntime: false,
    note: "Finish",
  });
  assert.equal(position(t).downtime, undefined);
  assert.equal(position(t).inParty, true);
  t = act(t, {
    kind: "session-time",
    before: sessionTimeFingerprint(t),
    hours: 1,
    rest: "none",
    purseIds: [],
    allowDowntime: false,
    note: "Later",
  });
  assert.equal(t.journal!.events.filter((e) => e.summary.includes("completed Research")).length, 1);
  assert.deepEqual(t.holdings, assets);
  assert.deepEqual(
    t.purses.map((p) => p.coins),
    coins,
  );
});
test("DM approval completes PC downtime; cancellation restores away NPCs without rewards or lost state", () => {
  let t = fixture();
  t = act(t, {
    kind: "character-downtime-start",
    purseId: "hero",
    before: position(t, "hero"),
    name: "Training",
    days: 2,
    locationId: "away",
  });
  t = act(t, { kind: "downtime-plan", name: "Between sessions", days: 1 });
  const d = t.journal!.finance!.downtime.at(-1)!;
  assert.throws(() => move(t, "hero", { inParty: true }), /pending campaign downtime/);
  t = act(t, { kind: "downtime-apply", downtimeId: d.id, endSession: false });
  assert.ok(position(t, "hero").downtime);
  t = act(t, { kind: "downtime-plan", name: "Second day", days: 1 });
  t = act(t, {
    kind: "downtime-apply",
    downtimeId: t.journal!.finance!.downtime.at(-1)!.id,
    endSession: false,
  });
  assert.equal(position(t, "hero").inParty, true);
  assert.equal(position(t, "hero").downtime, undefined);
  t = act(t, {
    kind: "character-downtime-start",
    purseId: "npc",
    before: position(t),
    name: "Crafting",
    days: 3,
    locationId: "away",
  });
  t = act(t, { kind: "character-downtime-cancel", purseId: "npc", before: position(t) });
  assert.equal(position(t).inParty, false);
  assert.equal(position(t).locationId, "town");
  assert.throws(
    () => act(t, { kind: "character-downtime-cancel", purseId: "npc", before: position(t) }),
    /no active downtime/,
  );
});
