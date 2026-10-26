// Quest log presentation (docs/QUESTS.md): tabs, labels, "Quests here", NPC strips and the
// per-device Follow/Updated state (which still works when storage is blocked).
import assert from "node:assert/strict";
import test from "node:test";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import {
  audienceLabel,
  npcQuests,
  questsByTab,
  questsHere,
  questUpdated,
  readQuestState,
  writeQuestState,
} from "./quest-view.ts";
import type { Quest } from "./quests-schema.ts";

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
