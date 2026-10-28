// Quest log presentation (docs/QUESTS.md): tabs, labels, "Quests here", NPC strips and the
// per-device Follow/Updated state (which still works when storage is blocked).
import assert from "node:assert/strict";
import test from "node:test";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import {
  audienceLabel,
  noteOwner,
  npcQuests,
  questChanges,
  questsByTab,
  questsHere,
  questUpdated,
  readQuestState,
  writeQuestState,
} from "./quest-view.ts";
import type { Quest } from "./quests-schema.ts";
import { campaignMapSchema } from "./world-schema.ts";
import { areaRadiusFromUnits, areaRadiusUnits, linkableMapPins, questMapHref, questsOnMap } from "./quest-view.ts";

import { forgetQuestState } from "./campaigns.ts";

const quest = (id: string, extra: Partial<Quest> = {}): Quest => ({
  id,
  title: id,
  status: "active",
  audience: { kind: "party" },
  summary: "",
  locationIds: [],
  markers: [],
  areas: [],
  objectives: [],
  rewardLinks: [],
  log: [],
  createdAt: 1,
  updatedAt: 1,
  revision: 0,
  ...extra,
});
const coins = () => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
function table(quests: Quest[]): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "aria", name: "Aria", kind: "character", coins: coins() },
      { id: "bram", name: "Bram", kind: "character", coins: coins() },
    ],
    journal: readJournal({
      market: {
        currentLocationId: "town",
        locations: [
          { id: "region", name: "Vale", kind: "region", parentId: null, description: "" },
          { id: "town", name: "Harrowgate", kind: "town", parentId: "region", description: "" },
          { id: "road", name: "North Road", kind: "area", parentId: "town", description: "" },
          { id: "ford", name: "Fenwick Ford", kind: "town", parentId: "region", description: "" },
        ],
      },
      world: {
        npcs: [{ id: "hollin", name: "Hollin", description: "", locationId: "town", visible: true, barterAllowed: false, controllerPurseId: null }],
      },
      quests: { quests },
    }),
  };
}
const player = { role: "player" as const, purseIds: ["aria"] };
const dm = { role: "dm" as const, purseIds: [] };

test("tabs: drafts, in play, done, failed and archived; Main first", () => {
  const t = table([
    quest("draft", { audience: { kind: "none" } }),
    quest("side", { updatedAt: 5 }),
    quest("main", { main: true }),
    quest("won", { status: "completed" }),
    quest("lost", { status: "failed" }),
    quest("old", { archived: true }),
  ]);
  const tabs = questsByTab(t);
  assert.deepEqual(tabs.play.map((q) => q.id), ["main", "side"]);
  assert.deepEqual(tabs.drafts.map((q) => q.id), ["draft"]);
  assert.deepEqual([tabs.done[0]!.id, tabs.failed[0]!.id, tabs.archived[0]!.id], ["won", "lost", "old"]);
});

test("audience labels name co-recipients and say when only you know", () => {
  const t = table([]);
  assert.equal(audienceLabel(t, quest("a", { audience: { kind: "characters", purseIds: ["aria", "bram"] } }), player), "You, Bram");
  assert.equal(audienceLabel(t, quest("b", { audience: { kind: "characters", purseIds: ["aria"] } }), player), "Only you know this");
  assert.equal(audienceLabel(t, quest("c", { audience: { kind: "characters", purseIds: ["aria", "bram"] } }), dm), "Aria, Bram");
  assert.equal(audienceLabel(t, quest("d"), player), "Party");
});

test("Quests here: an open visible objective's place, the quest's place or its giver's place", () => {
  const t = table([
    quest("by-objective", { objectives: [{ id: "o", text: "Search the road", state: "open", locationId: "road" }] }),
    quest("by-place", { locationIds: ["town"] }),
    quest("by-giver", { giverNpcId: "hollin" }),
    quest("elsewhere", { locationIds: ["ford"] }),
    quest("done-objective", { objectives: [{ id: "o", text: "x", state: "done", locationId: "road" }] }),
    quest("hidden-objective", { objectives: [{ id: "o", text: "x", state: "open", hidden: true, locationId: "road" }] }),
    quest("closed", { status: "completed", locationIds: ["town"] }),
    quest("draft", { audience: { kind: "none" }, locationIds: ["town"] }),
  ]);
  assert.deepEqual(questsHere(t, player).map((q) => q.id).sort(), ["by-giver", "by-objective", "by-place"]);
  assert.ok(questsHere(t, dm).some((q) => q.id === "draft"));
  assert.deepEqual(npcQuests(t, "hollin", player).map((q) => q.id), ["by-giver"]);
});

test("Follow and Updated are per device and survive blocked storage in memory", () => {
  const saved = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw Error("blocked");
    },
  });
  try {
    const key = "quire.quests.v1.test.player.aria";
    const q = quest("q", { updatedAt: 10 });
    assert.equal(questUpdated(readQuestState(key), q), true);
    writeQuestState(key, { follow: "q", seen: { q: 10 } });
    assert.equal(readQuestState(key).follow, "q");
    assert.equal(questUpdated(readQuestState(key), q), false);
    assert.equal(questUpdated(readQuestState(key), { ...q, updatedAt: 11 }), true);
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: saved, writable: true });
  }
});

test("Quest updated toasts: none on first load; a newly visible quest toasts once as new", () => {
  const first = questChanges(null, [quest("a")]);
  assert.deepEqual(first.changed, []);
  const revealedLater = questChanges(first.next, [quest("a"), quest("b", { updatedAt: 3 })]);
  assert.deepEqual(revealedLater.changed.map((c) => [c.quest.id, c.isNew]), [["b", true]]);
  const again = questChanges(revealedLater.next, [quest("a"), quest("b", { updatedAt: 3 })]);
  assert.deepEqual(again.changed, []);
  const updated = questChanges(again.next, [quest("a", { updatedAt: 9 }), quest("b", { updatedAt: 3 })]);
  assert.deepEqual(updated.changed.map((c) => [c.quest.id, c.isNew]), [["a", false]]);
  // Archived quests never toast.
  assert.deepEqual(questChanges(updated.next, [quest("c", { archived: true })]).changed, []);
});

test("a private quest note is written as one of the seat's characters who know the quest", () => {
  const purses = [{ id: "aria", kind: "character" }, { id: "bram", kind: "character" }, { id: "fund", kind: "party" }];
  assert.equal(noteOwner(quest("q", { audience: { kind: "characters", purseIds: ["bram"] } }), ["fund", "aria", "bram"], purses), "bram");
  assert.equal(noteOwner(quest("q"), ["fund", "aria", "bram"], purses), "aria");
  assert.equal(noteOwner(quest("q", { audience: { kind: "characters", purseIds: ["cass"] } }), ["aria"], purses), undefined);
});

test("deleting a campaign forgets its quest Follow/Updated marks only", () => {
  const store = new Map<string, string>([
    ["quire.quests.v1.gone.player.aria", "{}"],
    ["quire.quests.v1.gone.dm.", "{}"],
    ["quire.quests.v1.gone2.player.aria", "{}"],
    ["quire.seat.v1.gone", "{}"],
  ]);
  const saved = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      removeItem: (k: string) => void store.delete(k),
    },
  });
  try {
    forgetQuestState("gone");
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: saved, writable: true });
  }
  assert.deepEqual([...store.keys()], ["quire.quests.v1.gone2.player.aria", "quire.seat.v1.gone"]);
});

// --- On the map ---

const cityMap = (extra: Record<string, unknown> = {}) =>
  campaignMapSchema.parse({
    id: "city",
    name: "Harrowgate",
    image: "data:image/png;base64,YQ==",
    locationId: "town",
    visible: true,
    type: "city",
    anchors: [{ locationId: "road", x: 0.2, y: 0.3 }],
    markers: [{ id: "stable", x: 0.6, y: 0.4, label: "Stable", description: "", visibility: "party" }],
    ...extra,
  });
function mapTable(quests: Quest[]) {
  const t = table(quests);
  t.journal!.world!.maps = [cityMap()];
  return t;
}

test("on the map: pins for linked map pins, open objectives' pins and places; areas follow their objective", () => {
  const t = mapTable([
    quest("mare", {
      markers: [{ mapId: "city", markerId: "stable" }],
      objectives: [
        { id: "o1", text: "Follow the tracks", state: "open", locationId: "road" },
        { id: "o2", text: "Done already", state: "done", locationId: "road" },
        { id: "o3", text: "Secret", state: "open", hidden: true, marker: { mapId: "city", markerId: "stable" } },
      ],
      areas: [
        { id: "a1", mapId: "city", x: 0.4, y: 0.4, r: 0.1, label: "Somewhere in here" },
        { id: "a2", mapId: "city", x: 0.5, y: 0.5, r: 0.1, objectiveId: "o2" },
        { id: "a3", mapId: "city", x: 0.5, y: 0.5, r: 0.1, objectiveId: "o3" },
        { id: "a4", mapId: "other", x: 0.5, y: 0.5, r: 0.1 },
      ],
    }),
    quest("elsewhere", { locationIds: ["ford"] }),
    quest("draft", { audience: { kind: "none" }, markers: [{ mapId: "city", markerId: "stable" }] }),
    quest("closed", { status: "completed", markers: [{ mapId: "city", markerId: "stable" }] }),
  ]);
  const map = t.journal!.world!.maps[0]!;
  const forPlayer = questsOnMap(t, map, player);
  assert.deepEqual(forPlayer.map((i) => i.quest.id), ["mare"]);
  const mare = forPlayer[0]!;
  assert.deepEqual(mare.pins.map((p) => [p.x, p.y]).sort(), [[0.2, 0.3], [0.6, 0.4]]);
  // Areas of a finished objective or a hidden one are not drawn for players; the DM sees the hidden one.
  assert.deepEqual(mare.areas.map((a) => a.areaId), ["a1"]);
  assert.deepEqual(questsOnMap(t, map, dm).find((i) => i.quest.id === "mare")!.areas.map((a) => a.areaId), ["a1", "a3"]);
  assert.ok(questsOnMap(t, map, dm).some((i) => i.quest.id === "draft"));
  assert.deepEqual(mare.openObjectives.map((o) => o.id), ["o1"]);
  assert.equal(questMapHref(t, mare.quest, player), "/maps?quest=mare");
  assert.deepEqual(linkableMapPins(t, map), [{ mapId: "city", markerId: "stable", label: "Stable" }]);
});

test("radius in map units: a grid wins (feet), then a scale bar; the inverse round-trips", () => {
  const grid = cityMap({ grid: { columns: 20, rows: 10, feetPerTile: 5, x: 0, y: 0, width: 1, height: 1 } });
  assert.deepEqual(areaRadiusUnits(grid, 0.1), { value: 10, unit: "ft" });
  const scaled = cityMap({ scale: { a: { x: 0, y: 0.5 }, b: { x: 0.5, y: 0.5 }, distance: 10, unit: "mi", aspect: 2 } });
  // Half the width is 10 mi, so a radius of a tenth of the width is 2 mi.
  assert.deepEqual(areaRadiusUnits(scaled, 0.1), { value: 2, unit: "mi" });
  assert.ok(Math.abs(areaRadiusFromUnits(scaled, 2)! - 0.1) < 1e-9);
  assert.equal(areaRadiusUnits(cityMap(), 0.1), undefined);
  assert.equal(areaRadiusFromUnits(cityMap(), 2), undefined);
});
