// The map menu's items per seat (map tokens PR 4; mockup context-menu-desktop): the DM's empty-map
// groups and order, the token and selection menus, and the players' short menus with no DM item.
import assert from "node:assert/strict";
import test from "node:test";
import { enabledActions, mapActions, sizeHint, type MapMenuContext } from "./map-actions.ts";
import type { MapToken } from "./world-schema.ts";

const base: MapMenuContext = {
  dm: true,
  grid: true,
  selected: 0,
  purseIds: [],
  canPlaceOwn: false,
  canPing: true,
  mapVisible: true,
  destinations: true,
};
const ogre: MapToken = { id: "ogre", kind: "creature", label: "Ogre", column: 17, row: 9, visibility: "party", sizeClass: "large", anchor: "corner" };
const mira: MapToken = { id: "mira-token", kind: "character", entityId: "mira", label: "Mira", column: 12, row: 7, visibility: "party" };
const DM_ONLY = new Set([
  "start-encounter",
  "add-creatures",
  "add-characters",
  "place-party",
  "place-selected",
  "move-party",
  "party-position",
  "place-record",
  "marker",
  "entrance",
  "share-view",
  "reveal",
  "light",
  "open-tracker",
  "move-to",
  "hide",
  "show",
  "lock",
  "unlock",
  "add-initiative",
  "remove-combat",
  "size",
  "controllers",
  "send-to",
  "remove",
]);

test("DM on the empty map: the mockup's groups, items, order and shortcuts", () => {
  const list = mapActions({ kind: "map", square: { column: 10, row: 2 } }, base);
  assert.equal(list.title, "Map actions");
  assert.equal(list.subtitle, "Col 11 · Row 3");
  assert.equal(list.announce, "Map actions at column 11, row 3");
  assert.deepEqual(
    list.sections.map((s) => [s.label, s.items.map((i) => i.label + (i.shortcut ? ` ${i.shortcut}` : ""))]),
    [
      ["Encounter", ["Start encounter here…", "Add creatures here…", "Add characters here…"]],
      ["Party", ["Place party here ⇧A", "Place selected here", "Move party to", "Set party position here"]],
      ["Place", ["Place record here… ⇧R", "Marker here ⇧M", "Entrance here ⇧E"]],
      ["Table", ["Ping here P", "Measure from here M", "Share this view with players"]],
      ["Reveal", ["Reveal around here", "Add light here ⇧I"]],
    ],
  );
  const selected = list.sections[1].items[1];
  assert.equal(selected.disabled, true);
  assert.equal(selected.hint, "none selected");
  assert.equal(list.sections[0].items[1].hint, "SRD");
  assert.equal(list.sections[1].items[2].submenu, true);
  assert.equal(mapActions({ kind: "map" }, { ...base, selected: 3 }).sections[1].items[1].disabled, undefined);
});

test("DM without a grid: token items are unavailable, places and reveals stay", () => {
  const list = mapActions({ kind: "map" }, { ...base, grid: false });
  const ids = enabledActions(list).map((i) => i.id);
  assert.ok(!ids.includes("place-party") && !ids.includes("place-selected") && !ids.includes("add-characters"));
  assert.ok(ids.includes("marker") && ids.includes("reveal") && ids.includes("party-position"));
  assert.equal(list.subtitle, "Here");
});

test("DM on a token: the mockup's token menu; in-combat state drives Add and Remove", () => {
  const list = mapActions({ kind: "tokens", tokens: [ogre] }, { ...base, encounterId: "fight", combatants: new Set() });
  assert.equal(list.title, "Ogre");
  assert.equal(list.subtitle, "Large · DM-only stats");
  assert.deepEqual(
    list.sections.map((s) => s.items.map((i) => i.label)),
    [
      ["Open in tracker", "Move to…", "Hide from players", "Lock movement"],
      ["Add to initiative", "Remove from combat", "Size", "Controllers…", "Send to map"],
      ["Remove token…"],
    ],
  );
  const flat = list.sections.flatMap((s) => s.items);
  assert.equal(flat.find((i) => i.id === "remove-combat")?.disabled, true);
  assert.equal(flat.find((i) => i.id === "add-initiative")?.disabled, undefined);
  assert.equal(flat.find((i) => i.id === "size")?.hint, "Large 2×2");
  assert.equal(flat.find((i) => i.id === "remove")?.danger, true);
  const fighting = mapActions({ kind: "tokens", tokens: [ogre] }, { ...base, encounterId: "fight", combatants: new Set(["ogre"]) });
  const f = fighting.sections.flatMap((s) => s.items);
  assert.equal(f.find((i) => i.id === "add-initiative")?.disabled, true);
  assert.equal(f.find((i) => i.id === "remove-combat")?.disabled, undefined);
  // No encounter on the map: Add says why.
  const none = mapActions({ kind: "tokens", tokens: [ogre] }, base).sections.flatMap((s) => s.items);
  assert.equal(none.find((i) => i.id === "add-initiative")?.hint, "no encounter");
  // Hidden and locked tokens offer the reverse.
  const hidden = mapActions({ kind: "tokens", tokens: [{ ...mira, visibility: "dm", locked: true }] }, base).sections[0].items.map((i) => i.label);
  assert.deepEqual(hidden, ["Open sheet", "Move to…", "Show to players", "Unlock movement"]);
});

test("DM on a selection: the header counts the tokens and every item applies to all", () => {
  const list = mapActions({ kind: "tokens", tokens: [ogre, mira, { ...mira, id: "b" }, { ...mira, id: "c" }] }, base);
  assert.equal(list.title, "4 tokens");
  const ids = list.sections.flatMap((s) => s.items).map((i) => i.id);
  assert.ok(!ids.includes("open-sheet") && !ids.includes("open-tracker") && !ids.includes("controllers"));
  assert.equal(list.sections[2].items[0].label, "Remove 4 tokens…");
});

test("players never get a DM item: the empty map and their own token", () => {
  const player = { ...base, dm: false, purseIds: ["mira"], canPlaceOwn: true };
  const empty = mapActions({ kind: "map", square: { column: 3, row: 4 } }, player);
  assert.deepEqual(empty.sections.flatMap((s) => s.items).map((i) => i.label), ["Place my token here", "Ping here", "Measure from here"]);
  const own = mapActions({ kind: "tokens", tokens: [mira] }, player);
  assert.deepEqual(own.sections.flatMap((s) => s.items).map((i) => i.label), ["Open my sheet", "Ping", "Centre"]);
  for (const list of [empty, own, mapActions({ kind: "tokens", tokens: [ogre] }, player), mapActions({ kind: "map" }, { ...player, canPlaceOwn: false, canPing: false })])
    for (const item of list.sections.flatMap((s) => s.items)) assert.ok(!DM_ONLY.has(item.id), `${item.id} is DM-only`);
  // Without a free spot or with movement off, Place my token isn't offered.
  assert.ok(!enabledActions(mapActions({ kind: "map" }, { ...player, canPlaceOwn: false })).some((i) => i.id === "place-mine"));
});

test("size hints name the footprint", () => {
  assert.equal(sizeHint(ogre), "Large 2×2");
  assert.equal(sizeHint(mira), "Medium 1×1");
  assert.equal(sizeHint({ ...mira, sizeClass: "tiny", footprint: 0.25 }), "Tiny ¼");
});

test("radial: the mockup's DM, token and player slices, clockwise from the top", async () => {
  const { radialSlices, shortMapName } = await import("./map-actions.ts");
  const dmMap = radialSlices(mapActions({ kind: "map", square: { column: 11, row: 9 } }, base), { dm: true, tokens: false, purseIds: [], pills: { "place-party": "cluster, 4 tokens" } });
  assert.deepEqual(dmMap.map((s) => s.label), ["Encounter", "Creatures", "Characters", "Place party", "Move party ▸", "Ping", "Reveal", "More"]);
  assert.equal(dmMap[3].pill, "Place party here · cluster, 4 tokens");
  assert.equal(dmMap[4].submenu, true);
  const token = radialSlices(mapActions({ kind: "tokens", tokens: [ogre] }, { ...base, encounterId: "fight", combatants: new Set() }), { dm: true, tokens: true, purseIds: [] });
  assert.deepEqual(token.map((s) => s.label), ["Tracker", "Hide", "Lock", "Initiative", "Size ▸", "Send to ▸", "Remove", "More"]);
  assert.equal(token[3].id, "add-initiative");
  const fighting = radialSlices(mapActions({ kind: "tokens", tokens: [ogre] }, { ...base, encounterId: "fight", combatants: new Set(["ogre"]) }), { dm: true, tokens: true, purseIds: [] });
  assert.equal(fighting[3].id, "remove-combat");
  const player = { ...base, dm: false, purseIds: ["mira"], canPlaceOwn: true };
  const p = radialSlices(mapActions({ kind: "map" }, player), { dm: false, tokens: false, purseIds: ["mira"] });
  assert.deepEqual(p.map((s) => s.label), ["Place me", "Ping", "Measure", "My sheet"]);
  assert.ok(p.every((s) => !DM_ONLY.has(s.id)));
  assert.deepEqual(radialSlices(mapActions({ kind: "map" }, { ...player, canPlaceOwn: false }), { dm: false, tokens: false, purseIds: ["mira"] }).map((s) => s.label), ["Ping", "Measure", "My sheet"]);
  assert.deepEqual(radialSlices(mapActions({ kind: "tokens", tokens: [mira] }, player), { dm: false, tokens: true, purseIds: ["mira"] }).map((s) => s.label), ["My sheet", "Ping", "Centre"]);
  assert.deepEqual(["The Cellar", "Keep — Upper floor", "City-Testville", "Forest outside of Testville"].map(shortMapName), ["The Cellar", "Upper floor", "Testville", "Forest"]);
});
