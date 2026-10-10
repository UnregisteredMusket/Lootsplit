import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyCloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import {
  libraryRecords,
  libraryRecordKey,
  libraryRecordHref,
  searchLibraryRecords,
} from "./library-records.ts";
import { readResourcePack } from "./resource-packs.ts";
const dm = { role: "dm" as const, purseIds: [] },
  player = { role: "player" as const, purseIds: ["hero"] };
function fixture() {
  const table = emptyCloudTable();
  const pack = readResourcePack(
    readFileSync(new URL("../../../docs/examples/resource-pack.json", import.meta.url), "utf8"),
  );
  table.journal = readJournal({
    market: {
      currentLocationId: "city",
      locations: [
        { id: "region", kind: "region", parentId: null, name: "Valika", description: "North" },
        {
          id: "city",
          kind: "city",
          parentId: "region",
          name: "Erlefurt",
          description: "A trading town",
        },
      ],
    },
    resourceLibrary: {
      packs: [pack, { ...pack, id: "second-pack", title: "Other source", revision: "2" }],
    },
    world: {
      npcs: [
        {
          id: "npc",
          name: "Jarl Birger",
          description: "Summerhelm's ruler",
          locationId: "city",
          visible: true,
          barterAllowed: true,
          controllerPurseId: null,
        },
        {
          id: "hidden",
          name: "Hidden NPC",
          description: "Secret plot",
          locationId: "city",
          visible: false,
          barterAllowed: false,
          controllerPurseId: null,
        },
      ],
      maps: [
        {
          id: "map",
          name: "Atlas",
          image: "data:image/png;base64,AAAA",
          visible: true,
          locationId: "region",
          anchors: [],
          markers: [
            {
              id: "marker",
              label: "Secret marker",
              description: "Secret passage",
              x: 0.5,
              y: 0.5,
              visibility: "dm",
            },
          ],
        },
      ],
    },
  });
  return table;
}
test("Library identities distinguish imported packs/revisions and duplicate names", () => {
  const rows = libraryRecords(fixture(), dm);
  const creatures = rows.filter((r) => r.name === "Reed Guardian");
  assert.equal(creatures.length, 2);
  assert.notEqual(creatures[0].key, creatures[1].key);
  assert.ok(creatures[0].description.includes("Reed Lash"));
  assert.ok(
    creatures[0].fields.some(
      ([label, value]) => label === "Sources" && value.includes("PDF p. 12"),
    ),
  );
  const key = libraryRecordKey("resource", "pack/[1]", "revision & 2", "entry?quoted");
  assert.equal(
    new URL(
      libraryRecordHref("resource", "pack/[1]", "revision & 2", "entry?quoted"),
      "https://lootsplit.invalid",
    ).searchParams.get("record"),
    key,
  );
});
test("Library exposes only permitted live records and keeps source packs/catalog private", () => {
  const rows = libraryRecords(fixture(), player, [
    {
      id: "secret-item",
      name: "Secret catalog item",
      category: "general",
      rarity: "common",
      baseCopper: 1,
      notes: "DM only",
      origin: "hand",
      service: false,
    },
  ]);
  assert.ok(rows.some((r) => r.key === libraryRecordKey("npc", "npc")));
  assert.ok(
    !rows.some(
      (r) => r.name.includes("Hidden") || r.name.includes("Secret") || r.kind === "Monster",
    ),
  );
  const table = fixture();
  table.journal!.market!.currentLocationId = null;
  assert.ok(!libraryRecords(table, player).some((r) => r.kind === "NPC"));
});
test("Library search finds names, descriptions, hierarchy and types with accents and separate words", () => {
  const rows = libraryRecords(fixture(), dm);
  assert.equal(searchLibraryRecords(rows, "  Valika   Erlefurt ", "Location").length, 1);
  assert.equal(searchLibraryRecords(rows, "SUMMERHELM")[0].name, "Jarl Birger");
  assert.equal(searchLibraryRecords([{ ...rows[0], name: "Dämmerich" }], "dammerich").length, 1);
  assert.equal(searchLibraryRecords(rows, "marsh", "Monster").length, 2);
});
test("Entries reflect saved edits without mutating or duplicating source data", () => {
  const table = fixture(),
    before = JSON.stringify(table);
  libraryRecords(table, dm);
  assert.equal(JSON.stringify(table), before);
  table.journal!.world!.npcs[0].description = "Updated lore";
  assert.equal(
    libraryRecords(table, dm).find((r) => r.key === libraryRecordKey("npc", "npc"))!.description,
    "Updated lore",
  );
  const entry = libraryRecords(table, dm).find((r) => r.key === libraryRecordKey("npc", "npc"))!;
  assert.equal(
    new URL(
      entry.links.find((l) => l.name === "Interact with this NPC")!.href,
      "https://lootsplit.invalid",
    ).searchParams.get("npc"),
    "npc",
  );
});
