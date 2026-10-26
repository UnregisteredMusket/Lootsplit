// Command palette (design D5, Q1, Q12): the index respects seat visibility, actions only open
// screens, search ranks label matches first, and single-key shortcuts stay out of text fields.
import test from "node:test";
import assert from "node:assert/strict";
import { emptyCloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import {
  GO_SHORTCUTS,
  paletteActions,
  paletteRecords,
  paletteScreens,
  searchPalette,
  singleKeyShortcutsAllowed,
} from "./command-palette.ts";

const dm = { role: "dm" as const, purseIds: [] },
  player = { role: "player" as const, purseIds: ["hero"] };
const purse = (id: string, name: string, kind: string) =>
  ({ id, name, kind, coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }) as never;
const holding = (id: string, purseId: string, name: string, kind = "item") =>
  ({ id, purseId, name, kind, quantity: 1, unitCopper: 100, notes: "" }) as never;

function fixture() {
  const table = emptyCloudTable();
  table.purses = [
    purse("party", "Party treasury", "party"),
    purse("hero", "Mira", "character"),
    purse("rival", "Bram", "character"),
  ];
  table.holdings = [
    holding("h1", "hero", "Rope"),
    holding("h2", "rival", "Secret letter"),
    holding("h3", "party", "Pearl necklace"),
  ];
  table.journal = readJournal({
    market: {
      currentLocationId: "city",
      locations: [
        { id: "region", kind: "region", parentId: null, name: "Valika", description: "North" },
        { id: "city", kind: "city", parentId: "region", name: "Erlefurt", description: "Town" },
      ],
    },
    world: {
      npcs: [
        { id: "npc", name: "Jarl Birger", description: "", locationId: "city", visible: true, barterAllowed: true, controllerPurseId: null },
        { id: "hidden", name: "Hidden Spy", description: "Secret plot", locationId: "city", visible: false, barterAllowed: false, controllerPurseId: null },
      ],
      maps: [
        {
          id: "atlas", name: "Atlas", image: "data:image/png;base64,AAAA", visible: true, locationId: "region", anchors: [],
          markers: [{ id: "m", label: "Secret marker", description: "", x: 0.5, y: 0.5, visibility: "dm" }],
        },
        { id: "dm-map", name: "DM vault", image: "data:image/png;base64,AAAA", visible: false, locationId: null, anchors: [], markers: [] },
      ],
    },
  });
  return table;
}

test("a player finds only what their projection shows", () => {
  const labels = paletteRecords(fixture(), player).map((e) => e.label);
  for (const shown of ["Jarl Birger", "Erlefurt", "Atlas", "Rope", "Pearl necklace"])
    assert.ok(labels.includes(shown), `${shown} is found`);
  for (const hidden of ["Hidden Spy", "Secret marker", "DM vault", "Secret letter"])
    assert.ok(!labels.includes(hidden), `${hidden} stays hidden from players`);
});

test("the DM finds every record, with links to their screens", () => {
  const entries = paletteRecords(fixture(), dm);
  const by = (label: string) => entries.find((e) => e.label === label)!;
  assert.equal(by("Hidden Spy").href, "/features/npcs?npc=hidden");
  assert.equal(by("DM vault").href, "/maps?map=dm-map");
  assert.equal(by("Mira").href, "/characters?id=party%3Ahero");
  assert.equal(by("Secret letter").hint, "Item · Bram");
  assert.match(by("Erlefurt").href, /^\/library\?record=/);
});

test("players never see DM-only screens or DM actions", () => {
  const screens = paletteScreens(false).map((e) => e.href);
  for (const href of ["/features/review", "/features/time", "/features/shops", "/encounters"])
    assert.ok(!screens.includes(href), href);
  const actions = paletteActions(false, true).map((e) => e.label);
  assert.ok(!actions.includes("Award loot"));
  assert.ok(!actions.includes("End session"));
});

test("actions only open existing screens (no command runs from the palette)", () => {
  const actions = paletteActions(true, true);
  for (const a of actions) assert.match(a.href, /^\/[a-z?#]/);
  assert.ok(actions.some((a) => a.label === "End session"));
  assert.ok(paletteActions(true, false).some((a) => a.label === "Start session"));
  assert.equal(actions.find((a) => a.label === "Advance 8 h")!.href, "/features/time?hours=8");
});

test("search ranks label matches and needs every word", () => {
  const entries = [...paletteScreens(true), ...paletteActions(true, true), ...paletteRecords(fixture(), dm)];
  assert.equal(searchPalette(entries, "award")[0].label, "Award loot");
  assert.equal(searchPalette(entries, "jarl")[0].label, "Jarl Birger");
  assert.equal(searchPalette(entries, "erle")[0].label, "Erlefurt");
  assert.deepEqual(searchPalette(entries, "zzz nothing"), []);
  // Empty query: actions and screens, never a dump of records.
  assert.ok(searchPalette(entries, "").every((e) => e.group !== "Records"));
});

test("single-key shortcuts stay out of text fields, dialogs and Maps", () => {
  const none = { ctrlKey: false, metaKey: false, altKey: false };
  const inside = (selector: string) => ({ closest: (s: string) => (s.includes(selector) ? {} : null) });
  const plain = { closest: () => null };
  assert.equal(singleKeyShortcutsAllowed(plain, "/party", none), true);
  assert.equal(singleKeyShortcutsAllowed(inside("input"), "/party", none), false);
  assert.equal(singleKeyShortcutsAllowed(inside("textarea"), "/party", none), false);
  assert.equal(singleKeyShortcutsAllowed(inside('[role="dialog"]'), "/party", none), false);
  assert.equal(singleKeyShortcutsAllowed(plain, "/maps", none), false);
  assert.equal(singleKeyShortcutsAllowed(plain, "/", { ...none, ctrlKey: true }), false);
  assert.deepEqual(Object.keys(GO_SHORTCUTS).sort(), ["d", "k", "l", "m", "p"]);
});
