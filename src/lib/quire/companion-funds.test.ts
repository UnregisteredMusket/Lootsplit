import { applyCommand, type CommandInput } from "./commands.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { emptyCloudTable, type CloudTable, type CloudSeat } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { readFinance } from "./finance.ts";
import { readWorld } from "./world-schema.ts";
import { projectRecord } from "./session-records.ts";
import { characterPosition, companionFundsReadable } from "./character-position.ts";
import { fromCopper, toCopper } from "./money.ts";

// Owner decision 2026-10-22: party companion NPC funds are a DM toggle, off by default.
const dm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const hero: CloudSeat = { id: "h", token: "h", name: "Hero", role: "player", purseIds: ["hero"] };
const away: CloudSeat = { id: "w", token: "w", name: "Away", role: "player", purseIds: ["away"] };
const agent: CloudSeat = {
  id: "g",
  token: "g",
  name: "Agent",
  role: "player",
  purseIds: ["agent"],
};
let receipt = 0;
const command = (t: CloudTable, input: CommandInput, seat = dm) =>
  applyCommand(t, seat, { ...input, id: `companion-test-${++receipt}` });

const npc = (id: string, visible: boolean, controllerPurseId: string | null = null) =>
  ({
    kind: "npc-create",
    npc: {
      id,
      name: `NPC ${id}`,
      description: "",
      locationId: "city",
      visible,
      barterAllowed: true,
      controllerPurseId,
    },
    copper: 5000,
    inventory: [],
  }) as CommandInput;

function joinParty(t: CloudTable, purseId: string, visible = true) {
  const before = characterPosition(t, t.purses.find((p) => p.id === purseId)!);
  return command(t, {
    kind: "character-position",
    purseId,
    before,
    inParty: true,
    locationId: null,
    visible,
    sheetVisible: visible,
  } as CommandInput);
}

/** Hero and Agent travel with the party; Away is a player character elsewhere. */
function fixture(): CloudTable {
  let t: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      { id: "hero", name: "Alwen", kind: "character", coins: fromCopper(1000) },
      { id: "agent", name: "Cato", kind: "character", coins: fromCopper(1000) },
      { id: "away", name: "Dov", kind: "character", coins: fromCopper(1000) },
    ],
    journal: readJournal({
      market: {
        currentLocationId: "city",
        locations: [
          { id: "region", name: "Eastmarch", kind: "region", parentId: null, description: "" },
          { id: "city", name: "Port", kind: "city", parentId: "region", description: "" },
        ],
      },
      finance: readFinance(),
      sessions: [{ id: "session", name: "Adventure", startedAt: 1 }],
    }),
  };
  t = command(t, npc("guide", true));
  t = command(t, npc("ghost", false));
  t = command(t, npc("ward", true, "agent"));
  t = command(t, npc("stay", true));
  for (const id of ["guide", "ward"]) t = joinParty(t, id);
  for (const id of ["guide", "stay", "ghost"])
    t = command(t, { kind: "npc-funds", npcId: id, before: 5000, copper: 5100 } as CommandInput);
  t = joinParty(t, "ghost", false);
  const before = characterPosition(t, t.purses.find((p) => p.id === "away")!);
  t = command(t, {
    kind: "character-position",
    purseId: "away",
    before,
    inParty: false,
    locationId: "region",
    visible: true,
    sheetVisible: true,
  } as CommandInput);
  return t;
}
const coins = (t: CloudTable, id: string) => {
  const p = t.purses.find((p) => p.id === id);
  return p ? toCopper(p.coins) : undefined;
};
const toggle = (t: CloudTable, before: boolean, visible: boolean, seat = dm) =>
  command(t, { kind: "companion-funds-visibility", before, visible } as CommandInput, seat);

test("companion funds visibility is a DM-only, revision-checked setting that defaults to off", () => {
  const t = fixture();
  assert.equal(readWorld(t.journal!.world).companionFundsVisible, undefined);
  for (const seat of [hero, agent, away])
    assert.throws(() => toggle(t, false, true, seat), /Only the DM/);
  assert.throws(() => toggle(t, true, false), /changed\. Refresh/);
  const on = toggle(t, false, true);
  assert.equal(readWorld(on.journal!.world).companionFundsVisible, true);
  assert.ok(on.journal!.events.some((e) => /companion NPC funds shown/.test(e.summary)));
  assert.throws(() => toggle(on, false, true), /changed\. Refresh/);
  // Turning it off restores the stored shape of a campaign that never had the setting.
  const off = toggle(on, true, false);
  assert.equal("companionFundsVisible" in readWorld(off.journal!.world), false);
  // Toggling never moves money.
  for (const p of t.purses) assert.equal(coins(off, p.id), coins(t, p.id), p.id);
});

test("projection: off keeps companions private; on shows visible companions to party players only", () => {
  const off = fixture();
  assert.equal(coins(projectRecord(off, hero), "guide"), 0);
  assert.equal(
    projectRecord(off, hero).ledger.some((l) => l.purseId === "guide"),
    false,
  );

  const on = toggle(off, false, true);
  const heroView = projectRecord(on, hero);
  assert.equal(coins(heroView, "guide"), 5100);
  assert.equal(coins(heroView, "ward"), 5000);
  assert.ok(heroView.ledger.some((l) => l.purseId === "guide"));
  // Read-only: no permissions or editing flags come with the balance.
  const guide = heroView.purses.find((p) => p.id === "guide")!;
  assert.equal("permissions" in guide || "editingAllowed" in guide, false);
  // NPCs not travelling with the party stay private.
  assert.equal(coins(heroView, "stay"), 0);
  assert.equal(
    heroView.ledger.some((l) => l.purseId === "stay"),
    false,
  );
  // A hidden NPC in the party never leaks, setting on or not.
  assert.equal(JSON.stringify(heroView).includes("ghost"), false);
  assert.equal(companionFundsReadable(on, on.purses.find((p) => p.id === "ghost")!, hero), false);
  // A player whose character is not with the party does not get companions' funds.
  const awayView = projectRecord(on, away);
  assert.notEqual(coins(awayView, "guide"), 5100);
  assert.equal(
    awayView.ledger.some((l) => l.purseId === "guide"),
    false,
  );
  // The DM sees everything either way.
  assert.equal(coins(projectRecord(on, dm), "ghost"), 5100);
});

test("old campaigns without the setting load and project exactly as before", () => {
  const t = fixture();
  const expected = projectRecord(t, hero);
  // An older save may also carry an explicit false.
  const legacy = structuredClone(t);
  (legacy.journal!.world as Record<string, unknown>).companionFundsVisible = false;
  assert.deepEqual(projectRecord(legacy, hero).purses, expected.purses);
  assert.deepEqual(projectRecord(legacy, hero).ledger, expected.ledger);
  assert.equal(coins(expected, "guide"), 0);
  assert.equal(readWorld(legacy.journal!.world).companionFundsVisible, false);
});
