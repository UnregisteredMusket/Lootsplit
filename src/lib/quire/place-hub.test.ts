import test from "node:test";
import assert from "node:assert/strict";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { campaignMapSchema } from "./world-schema.ts";
import { projectRecord } from "./session-records.ts";
import {
  PLACE_UNAVAILABLE,
  browsableMaps,
  mapServiceAllowed,
  parseRecordParam,
  partyAt,
  recordLocationId,
  recordMapHref,
  recordMapSpots,
  recordMapStatus,
  recordParam,
} from "./place-hub.ts";

const dm: CloudSeat = { id: "dm", name: "DM", role: "dm", token: "t", purseIds: [] };
const player: CloudSeat = { ...dm, id: "p", name: "Aria", role: "player", purseIds: ["aria"] };
const shop = (id: string, name: string, locationId: string) => ({
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
});
const map = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  campaignMapSchema.parse({
    id,
    name,
    image: "data:image/png;base64,YQ==",
    locationId: "town",
    visible: true,
    type: "city",
    anchors: [],
    markers: [],
    ...extra,
  });
const pin = (kind: string, id: string, visibility: "party" | "dm", x = 0.3, y = 0.4) => ({
  id: `${kind}-${id}`,
  record: { kind, id },
  visibility,
  x,
  y,
});
/** Harrowgate (town) › Lantern Row (street); Fenwick Ford elsewhere in the region. */
function fixture(maps: unknown[], extra: Partial<CloudTable> = {}): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "aria", name: "Aria", kind: "character", coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } },
      { id: "tamsin", name: "Old Tamsin", kind: "character", control: "npc", nonParty: true, coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } },
    ] as CloudTable["purses"],
    shops: [shop("lantern", "Brass Lantern", "street"), shop("ford", "Ford Store", "ford")],
    ...extra,
    journal: readJournal({
      market: {
        currentLocationId: "street",
        locations: [
          { id: "region", name: "Vale", kind: "region", parentId: null, description: "" },
          { id: "town", name: "Harrowgate", kind: "town", parentId: "region", description: "" },
          { id: "street", name: "Lantern Row", kind: "area", parentId: "town", description: "" },
          { id: "ford", name: "Fenwick Ford", kind: "town", parentId: "region", description: "" },
        ],
      },
      world: {
        maps,
        npcs: [
          {
            id: "tamsin",
            name: "Old Tamsin",
            description: "Herbalist",
            locationId: "town",
            visible: true,
            barterAllowed: true,
            controllerPurseId: null,
          },
        ],
      },
    }),
  };
}

test("record links parse only bounded kind:id values and round-trip through the URL", () => {
  assert.deepEqual(parseRecordParam("shop:brass-lantern"), { kind: "shop", id: "brass-lantern" });
  assert.deepEqual(parseRecordParam("entry:a:b"), { kind: "entry", id: "a:b" });
  for (const bad of [
    undefined,
    7,
    "",
    "shop",
    ":x",
    "shop:",
    "dragon:x",
    "__proto__:x",
    "shop:" + "x".repeat(151),
    "shop:a\nb",
    "x".repeat(171),
  ])
    assert.equal(parseRecordParam(bad), undefined, String(bad));
  const ref = { kind: "npc" as const, id: "old tamsin/&?" };
  const href = recordMapHref("harrow gate", ref);
  assert.equal(href, "/maps?map=harrow+gate&record=npc%3Aold+tamsin%2F%26%3F");
  const url = new URL(href, "https://lootsplitter.invalid");
  assert.equal(url.searchParams.get("map"), "harrow gate");
  assert.deepEqual(parseRecordParam(url.searchParams.get("record")), ref);
  assert.equal(recordParam(ref), "npc:old tamsin/&?");
  assert.equal(recordMapHref(undefined, ref, "place"), "/maps?place=npc%3Aold+tamsin%2F%26%3F");
});

test("Show on map prefers the active scene's exact pin, then exact pins, then the nearest anchor", () => {
  const t = fixture([
    map("vale", "Vale of Harrow", { type: "regional", anchors: [{ locationId: "town", x: 0.5, y: 0.5 }] }),
    map("harrow", "Harrowgate", {
      anchors: [{ locationId: "street", x: 0.2, y: 0.2 }],
      connected: { links: [], placements: [pin("shop", "lantern", "party", 0.31, 0.62)] },
    }),
    map("atlas", "Atlas", { connected: { links: [], placements: [pin("shop", "lantern", "party")] } }),
    map("default", "Zeta town map", {
      anchors: [{ locationId: "town", x: 0.1, y: 0.1 }],
      connected: { defaultForLocation: "local", links: [], placements: [] },
    }),
  ]);
  const ids = (seat: CloudSeat) =>
    recordMapSpots(t, { kind: "shop", id: "lantern" }, seat).map((s) => [s.map.id, s.exact]);
  assert.deepEqual(ids(player), [
    ["atlas", true],
    ["harrow", true],
    ["default", false],
    ["vale", false],
  ]);
  t.journal.world!.tabletop = { activeMapId: "harrow", playerBrowsing: true } as never;
  assert.deepEqual(ids(player)[0], ["harrow", true]);
  assert.deepEqual(recordMapSpots(t, { kind: "shop", id: "lantern" }, player)[0].point, {
    x: 0.31,
    y: 0.62,
  });
  // Restricting players to the active scene limits links to that scene.
  t.journal.world!.tabletop = { activeMapId: "harrow", playerBrowsing: false } as never;
  assert.deepEqual(ids(player), [["harrow", true]]);
  assert.equal(ids(dm).length, 4);
  // A location shows on maps that anchor it.
  assert.deepEqual(
    recordMapSpots(t, { kind: "location", id: "street" }, dm).map((s) => s.map.id),
    ["harrow"],
  );
});

test("a DM-only or hidden pin reads exactly like 'not on a map yet' for players", () => {
  const ref = { kind: "shop" as const, id: "lantern" };
  const hidden = fixture([
    map("harrow", "Harrowgate", {
      anchors: [{ locationId: "town", x: 0.5, y: 0.5 }],
      connected: { links: [], placements: [pin("shop", "lantern", "dm")] },
    }),
  ]);
  const none = fixture([map("other", "Other", { locationId: "ford" })]);
  for (const t of [hidden, projectRecord(hidden, player)]) {
    const spots = recordMapSpots(t, ref, player);
    assert.deepEqual(spots, recordMapSpots(none, ref, player));
    assert.deepEqual(recordMapStatus(spots), { kind: "none", spots: [] });
  }
  // A missing record, a hidden map and a deleted record give the same empty answer.
  assert.deepEqual(recordMapSpots(hidden, { kind: "shop", id: "gone" }, player), []);
  const privateMap = fixture([
    map("harrow", "Harrowgate", {
      visible: false,
      connected: { links: [], placements: [pin("shop", "lantern", "party")] },
    }),
  ]);
  assert.deepEqual(recordMapSpots(privateMap, ref, player), []);
  assert.deepEqual(recordMapSpots(projectRecord(privateMap, player), ref, player), []);
  // The DM sees the DM-only pin and is told so.
  const dmSpots = recordMapSpots(hidden, ref, dm);
  assert.equal(dmSpots.length, 1);
  assert.equal(recordMapStatus(dmSpots).kind, "dm-only");
  assert.equal(PLACE_UNAVAILABLE, "That place isn't on a map you can open.");
});

test("records players can't see on the map are never offered, and remote shops are not sent", () => {
  const t = fixture([
    map("region", "Vale", {
      type: "regional",
      locationId: "region",
      anchors: [
        { locationId: "town", x: 0.4, y: 0.4 },
        { locationId: "ford", x: 0.8, y: 0.8 },
      ],
    }),
  ]);
  // The Ford Store is elsewhere: the DM can find it, the player gets the neutral answer.
  assert.equal(recordMapSpots(t, { kind: "shop", id: "ford" }, dm).length, 1);
  assert.deepEqual(recordMapSpots(t, { kind: "shop", id: "ford" }, player), []);
  const projected = projectRecord(t, player);
  assert.deepEqual(
    projected.shops.map((s) => s.id),
    ["lantern"],
    "players receive no shop (or stock) outside the party's location",
  );
  // A hidden NPC is unknown to players.
  t.journal.world!.npcs[0].visible = false;
  assert.deepEqual(recordMapSpots(t, { kind: "npc", id: "tamsin" }, player), []);
  assert.deepEqual(recordMapSpots(projectRecord(t, player), { kind: "npc", id: "tamsin" }, player), []);
  assert.equal(recordMapSpots(t, { kind: "npc", id: "tamsin" }, dm).length, 1);
});

test("map services keep their presence checks; viewing a pin grants no remote access", () => {
  const t = fixture([map("harrow", "Harrowgate")]);
  const seat = { ...player, shopIds: ["lantern", "ford"] };
  assert.equal(mapServiceAllowed(t, { kind: "shop", id: "lantern" }, seat), true);
  assert.equal(mapServiceAllowed(t, { kind: "shop", id: "ford" }, seat), false);
  assert.equal(mapServiceAllowed(t, { kind: "shop", id: "ford" }, dm), true);
  assert.equal(mapServiceAllowed(t, { kind: "npc", id: "tamsin" }, seat), true);
  // Travelling closes located shops and leaves the party nowhere.
  t.journal.world!.partyPosition = { environment: "roads" } as never;
  assert.equal(mapServiceAllowed(t, { kind: "shop", id: "lantern" }, seat), false);
  assert.equal(partyAt(t, "town"), false);
  delete t.journal.world!.partyPosition;
  assert.equal(partyAt(t, "town"), true);
  assert.equal(partyAt(t, "ford"), false);
  assert.equal(recordLocationId(t, { kind: "shop", id: "lantern" }), "street");
  assert.equal(recordLocationId(t, { kind: "npc", id: "tamsin" }), "town");
  assert.deepEqual(
    browsableMaps(t, player).map((m) => m.id),
    ["harrow"],
  );
});

test("an NPC pin opens the conversation hub unless a player controls the NPC", async () => {
  const { npcPinOpensHub } = await import("./place-hub.ts");
  assert.equal(npcPinOpensHub({ controllerPurseId: null }), true);
  assert.equal(npcPinOpensHub({ controllerPurseId: "aria" }), false);
});
