import test from "node:test";
import assert from "node:assert/strict";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { campaignMapSchema } from "./world-schema.ts";
import { applyCommand } from "./commands.ts";
import { projectRecord } from "./session-records.ts";
import { hereSheet, placementMap, placementSave } from "./place-hub.ts";
import {
  hasPlacementStyles,
  tableForProtocol,
  tabletopResponse,
  withoutPlacementStyles,
} from "./tabletop-protocol.ts";

const dm: CloudSeat = { id: "dm", name: "DM", role: "dm", token: "t", purseIds: [] };
const player: CloudSeat = { ...dm, id: "p", name: "Aria", role: "player", purseIds: ["aria"] };
const coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
const shop = (id: string, name: string, locationId: string, extra = {}) => ({
  id,
  name,
  keeper: "",
  place: "",
  notes: "",
  sellRate: 1,
  buyRate: 0.5,
  wealth: "modest" as const,
  category: "general" as const,
  priceScale: 1,
  locationId,
  ...extra,
});
const npc = (id: string, name: string, locationId: string, visible = true) => ({
  id,
  name,
  description: `${name} of ${locationId}\nSecond line`,
  locationId,
  visible,
  barterAllowed: true,
  controllerPurseId: null,
});
const map = (id: string, locationId: string, extra: Record<string, unknown> = {}) =>
  campaignMapSchema.parse({
    id,
    name: id,
    image: "data:image/png;base64,YQ==",
    locationId,
    visible: true,
    type: "city",
    anchors: [{ locationId, x: 0.5, y: 0.5 }],
    markers: [],
    ...extra,
  });
/** Party in Harrowgate; Kestrel Watch elsewhere in the Vale. */
function fixture(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "aria", name: "Aria", kind: "character", coins },
      { id: "tamsin", name: "Old Tamsin", kind: "character", control: "npc", nonParty: true, coins },
      { id: "spy", name: "The Spy", kind: "character", control: "npc", nonParty: true, coins },
      { id: "ilse", name: "Ilse Marr", kind: "character", control: "npc", nonParty: true, coins },
    ] as CloudTable["purses"],
    shops: [
      shop("lantern", "Brass Lantern", "town"),
      shop("post", "Harrowgate Post", "town"),
      shop("tradepost", "Kestrel Trading Post", "kestrel"),
    ],
    holdings: [
      {
        id: "house",
        purseId: "aria",
        name: "Riverside Townhouse",
        kind: "property",
        quantity: 1,
        unitCopper: 0,
        notes: "",
        locationId: "town",
      },
    ] as CloudTable["holdings"],
    journal: readJournal({
      market: {
        currentLocationId: "town",
        locations: [
          { id: "region", name: "Vale", kind: "region", parentId: null, description: "" },
          { id: "town", name: "Harrowgate", kind: "town", parentId: "region", description: "" },
          { id: "kestrel", name: "Kestrel Watch", kind: "town", parentId: "region", description: "" },
        ],
      },
      propertyOperations: { postal: { feeCopper: 2, deliveryDays: 2, offices: [{ shopId: "post", allowTown: false }] } },
      world: {
        maps: [
          map("harrow", "town", {
            connected: {
              links: [],
              placements: [
                { id: "pin-t", record: { kind: "npc", id: "tamsin" }, visibility: "party", x: 0.2, y: 0.2, style: "portrait" },
              ],
            },
          }),
          map("kestrel-map", "kestrel", {
            connected: {
              links: [],
              placements: [
                { id: "pin-tp", record: { kind: "shop", id: "tradepost" }, visibility: "party", x: 0.3, y: 0.3 },
                { id: "pin-ilse", record: { kind: "npc", id: "ilse" }, visibility: "party", x: 0.4, y: 0.4 },
              ],
            },
          }),
        ],
        npcs: [npc("tamsin", "Old Tamsin", "town"), npc("spy", "The Spy", "town", false), npc("ilse", "Ilse Marr", "kestrel")],
      },
    }),
  };
}

test("the place command writes one exact pin through map-save, DM only, keeping identity", () => {
  const t = fixture(),
    harrow = t.journal!.world!.maps[0];
  const ref = { kind: "shop" as const, id: "lantern" };
  const input = placementSave(harrow, ref, { x: 0.31, y: 0.62, visibility: "dm" }, () => "pin-l");
  assert.throws(() => applyCommand(t, player, { id: "c1", ...input }), /DM/i);
  const placed = applyCommand(t, dm, { id: "c1", ...input });
  const pins = placed.journal!.world!.maps.find((m) => m.id === "harrow")!.connected!.placements;
  assert.deepEqual(pins.find((p) => p.id === "pin-l"), {
    id: "pin-l",
    record: ref,
    x: 0.31,
    y: 0.62,
    visibility: "dm",
  });
  // The shop still belongs where it was; nothing else on the map changed.
  assert.equal(placed.shops.find((s) => s.id === "lantern")!.locationId, "town");
  assert.deepEqual(pins.find((p) => p.id === "pin-t"), harrow.connected!.placements[0]);
  // Moving and making it visible keep the pin's identity; shops never get a portrait style.
  const moved = placed.journal!.world!.maps.find((m) => m.id === "harrow")!;
  const move = placementSave(moved, ref, { x: 0.4, y: 0.4, visibility: "party", style: "portrait" });
  const after = applyCommand(placed, dm, { id: "c2", ...move });
  const harrowOf = (x: CloudTable) => x.journal!.world!.maps.find((m) => m.id === "harrow")!;
  const pin = harrowOf(after).connected!.placements.find((p) => p.record.id === "lantern")!;
  assert.equal(pin.id, "pin-l");
  assert.equal(pin.visibility, "party");
  assert.equal(pin.style, undefined);
  // A stale map is refused; removing restores the inferred position.
  assert.throws(() => applyCommand(after, dm, { id: "c3", ...move }), /changed/);
  const removed = applyCommand(after, dm, {
    id: "c4",
    ...placementSave(harrowOf(after), ref, null),
  });
  assert.equal(
    harrowOf(removed).connected!.placements.some((p) => p.record.id === "lantern"),
    false,
  );
  assert.throws(() => placementSave(harrowOf(removed), ref, null), /no exact pin/);
  assert.throws(() => placementSave(harrow, ref, { visibility: "party" }), /Choose where/);
});

test("portrait pins are opt-in per pin and stay invisible to, and safe from, older clients", () => {
  const t = fixture(),
    harrow = t.journal!.world!.maps[0];
  assert.equal(harrow.connected!.placements[0].style, "portrait");
  // Toggle back to the round icon (absent style) and on again.
  const icon = applyCommand(t, dm, {
    id: "s1",
    ...placementSave(harrow, { kind: "npc", id: "tamsin" }, { style: "icon" }),
  });
  assert.equal(icon.journal!.world!.maps.find((m) => m.id === "harrow")!.connected!.placements[0].style, undefined);
  // Protocols 0-4 never receive the style; 5 does. Players' projection keeps the shared pin.
  assert.equal(hasPlacementStyles(t), true);
  for (const protocol of [0, 1, 2, 3, 4])
    assert.equal(hasPlacementStyles(tableForProtocol(t, protocol)), false, `protocol ${protocol}`);
  assert.equal(tableForProtocol(t, 5), t);
  assert.equal(projectRecord(t, player).journal!.world!.maps[0].connected!.placements[0].style, "portrait");
  // An older app saves the map it saw (without styles): the stored style survives.
  const seen = withoutPlacementStyles(harrow);
  const legacy = applyCommand(t, dm, {
    id: "s2",
    kind: "map-save",
    mapId: "harrow",
    before: seen,
    map: { ...seen, name: "Harrowgate renamed" },
  });
  const saved = legacy.journal!.world!.maps.find((m) => m.id === "harrow")!;
  assert.equal(saved.name, "Harrowgate renamed");
  assert.equal(saved.connected!.placements[0].style, "portrait");
  // An older app is told to finish newer pending map work on the updated website.
  const styledDraft = JSON.stringify([
    { id: "d", kind: "map-save", mapId: "harrow", before: harrow, map: harrow },
  ]);
  for (const protocol of [3, 4])
    assert.throws(
      () => tabletopResponse({ table: t, draft: styledDraft }, protocol),
      /updated Lootsplitter client/,
    );
  assert.equal(
    hasPlacementStyles(tabletopResponse({ table: t, draft: "[]" }, 4).table),
    false,
  );
  assert.equal(hasPlacementStyles(tabletopResponse({ table: t, draft: styledDraft }, 5).table), true);
});

test("the Here sheet lists only what each audience may use at the party's location", () => {
  const t = fixture();
  const seat = { ...player, shopIds: ["lantern", "post"] };
  const rows = (sheet: ReturnType<typeof hereSheet>) =>
    sheet.mode === "here" ? sheet.rows.map((r) => [r.reference.id, r.group, r.action, r.dmOnly]) : sheet.mode;
  const harrow = t.journal!.world!.maps[0];
  assert.deepEqual(rows(hereSheet(t, seat, harrow)), [
    ["lantern", "shops", "Shop", false],
    ["tamsin", "people", "Talk", false],
    ["post", "services", "Send", false],
    ["house", "services", "Open", false],
  ]);
  // The projected room gives the player the same list: the hidden NPC and remote shop are absent.
  assert.deepEqual(rows(hereSheet(projectRecord(t, player), seat, harrow)), rows(hereSheet(t, seat, harrow)));
  // The DM also sees the hidden NPC, tagged DM only.
  assert.deepEqual(rows(hereSheet(t, dm, harrow)), [
    ["lantern", "shops", "Shop", false],
    ["tamsin", "people", "Talk", false],
    ["spy", "people", "Talk", true],
    ["post", "services", "Send", false],
    ["house", "services", "Open", false],
  ]);
  // Another player's property is not listed.
  const other = { ...seat, purseIds: ["someone-else"] };
  assert.equal(
    (hereSheet(t, other, harrow) as { rows: { reference: { id: string } }[] }).rows.some(
      (r) => r.reference.id === "house",
    ),
    false,
  );
  // On the road: nothing to use.
  const road = structuredClone(t);
  road.journal!.world!.partyPosition = { environment: "Wilderness", biome: "Forest", description: "" } as never;
  assert.deepEqual(hereSheet(road, seat, harrow), { mode: "road", environment: "Wilderness · Forest" });
  const nowhere = structuredClone(t);
  nowhere.journal!.market!.currentLocationId = null;
  assert.deepEqual(hereSheet(nowhere, seat), { mode: "nowhere" });
});

test("viewing another place is read only and shows names and kinds of shared pins only", () => {
  const t = fixture();
  const kestrel = t.journal!.world!.maps[1];
  const away = hereSheet(t, player, kestrel);
  assert.equal(away.mode, "away");
  if (away.mode !== "away") return;
  assert.equal(away.placeName, "Kestrel Watch");
  assert.equal(away.partyPlace, "Harrowgate");
  assert.deepEqual(
    away.rows.map((r) => [r.label, r.kind, r.action]),
    [
      ["Kestrel Trading Post", "Shop", "Visit to shop"],
      ["Ilse Marr", "Person", "Visit to talk"],
    ],
  );
  for (const row of away.rows) assert.deepEqual(Object.keys(row).sort(), ["action", "dmOnly", "kind", "label", "reference"]);
  // With the projected room the remote shop and NPC are not sent at all, so nothing is listed.
  const projected = projectRecord(t, player);
  const remote = hereSheet(projected, player, projected.journal!.world!.maps.find((m) => m.id === "kestrel-map"));
  assert.equal(remote.mode, "away");
  assert.deepEqual(remote.mode === "away" ? remote.rows : null, []);
  // A DM-only pin is never listed for players.
  kestrel.connected!.placements[1].visibility = "dm";
  const hidden = hereSheet(t, player, kestrel);
  assert.deepEqual(hidden.mode === "away" ? hidden.rows.map((r) => r.label) : null, ["Kestrel Trading Post"]);
  const dmView = hereSheet(t, dm, kestrel);
  assert.deepEqual(dmView.mode === "away" ? dmView.rows.map((r) => r.dmOnly) : null, [false, true]);
});

test("Place on map opens the record's best map, else its location's map", () => {
  const t = fixture();
  const maps = t.journal!.world!.maps;
  assert.equal(placementMap(t, { kind: "npc", id: "tamsin" }, maps)?.id, "harrow");
  assert.equal(placementMap(t, { kind: "shop", id: "tradepost" }, maps)?.id, "kestrel-map");
  assert.equal(placementMap(t, { kind: "shop", id: "lantern" }, maps)?.id, "harrow");
});

test("current clients declare the placement-style protocol on every room request", async () => {
  const { readFileSync } = await import("node:fs");
  const { CURRENT_TABLETOP_PROTOCOL } = await import("./tabletop-protocol.ts");
  const source = readFileSync(new URL("./cloud-client.ts", import.meta.url), "utf8");
  const declared = [...source.matchAll(/tabletopProtocol: (\d+)/g)].map((m) => Number(m[1]));
  // One deliberate protocol 3 read remains: the inline-image fallback.
  assert.deepEqual(
    declared.filter((n) => n !== CURRENT_TABLETOP_PROTOCOL),
    [3],
  );
  assert.ok(declared.length > 5);
  const account = readFileSync(new URL("../account/client.ts", import.meta.url), "utf8");
  assert.match(account, new RegExp(`"x-lootsplit-tabletop", "${CURRENT_TABLETOP_PROTOCOL}"`));
});
