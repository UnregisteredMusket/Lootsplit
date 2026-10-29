// Token follows the player's map view (map tokens PR 7, plan section 6): derived zones, the
// same-place rule, the DM's setting, control, hidden maps (generic refusal), combat, movement and
// locks, the journey rule, an existing token on the destination, Undo, and protocol 17.
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "./canonical-json.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, commandSchema, type CommandInput } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { projectRecord } from "./session-records.ts";
import { readTabletopSession } from "./tabletop.ts";
import { FOLLOW_VIEW_PROTOCOL, FOOTPRINT_PROTOCOL, tableForProtocol, tabletopResponse, upgradeOldClientCommands } from "./tabletop-protocol.ts";
import { mapGridSchema, type MapToken } from "./world-schema.ts";
import { followRefusal, zoneOf } from "./zones.ts";

const dm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const mira: CloudSeat = { id: "p1", token: "p1", name: "P1", role: "player", purseIds: ["mira"] };
const bram: CloudSeat = { id: "p2", token: "p2", name: "P2", role: "player", purseIds: ["bram"] };
const grid = mapGridSchema.parse({ columns: 20, rows: 12 });
const g = canonicalJson(grid);
const ch = (id: string, column: number, row: number): MapToken => ({ id: `${id}-token`, kind: "character", entityId: id, label: id, column, row, visibility: "party" });
function fixture(follow = true): CloudTable {
  const map = (id: string, extra: Record<string, unknown>) => ({ id, name: id[0].toUpperCase() + id.slice(1), image: "data:image/png;base64,AAAA", locationId: null, visible: true, anchors: [], markers: [], grid, tokens: [], ...extra });
  return {
    ...emptyCloudTable(),
    purses: ["mira", "bram"].map((id) => ({ id, kind: "character" as const, name: id[0].toUpperCase() + id.slice(1), coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } })),
    journal: readJournal({
      market: {
        currentLocationId: "testville",
        locations: [
          { id: "region", name: "Greenvale", kind: "region", parentId: null, description: "" },
          { id: "testville", name: "Testville", kind: "city", parentId: "region", description: "" },
          { id: "commons", name: "The Commons", kind: "area", parentId: "testville", description: "" },
          { id: "far", name: "Farbury", kind: "town", parentId: "region", description: "" },
        ],
      },
      finance: { day: 0, loans: [], rules: [], downtime: [] },
      world: {
        ...(follow ? { tabletop: { followView: true } } : {}),
        maps: [
          map("keep", { locationId: "testville", tokens: [ch("mira", 2, 2), ch("bram", 3, 2)] }),
          map("cellar", { connected: { parentMapId: "keep", links: [], placements: [] } }),
          map("commons", { locationId: "commons" }),
          map("wilds", { locationId: "region" }),
          map("farbury", { locationId: "far" }),
          map("secret", { locationId: "testville", visible: false }),
          map("loose", {}),
        ],
      },
    }),
  };
}
const mapOf = (t: CloudTable, id: string) => t.journal!.world!.maps.find((m) => m.id === id)!;
let n = 0;
const run = (t: CloudTable, c: object, seat = mira) => applyCommand(t, seat, commandSchema.parse({ ...c, id: `follow-${++n}` }));
const follow = (t: CloudTable, from: string | null, to: string, extra: Partial<Record<string, unknown>> = {}) => {
  const beforeFrom = from ? (mapOf(t, from).tokens ?? []).find((x) => x.entityId === "mira") ?? null : null;
  return {
    kind: "map-token-follow",
    mapId: to,
    grid: g,
    purseId: "mira",
    fromMapId: from,
    beforeFrom,
    beforeTo: (mapOf(t, to).tokens ?? []).find((x) => x.entityId === "mira") ?? null,
    tokenId: beforeFrom?.id ?? "new-token",
    at: { column: 5, row: 5 },
    ...extra,
  };
};

test("derived zones: a city and its areas, a region alone, maps without a place", () => {
  const t = fixture();
  assert.equal(zoneOf(t, "keep"), "loc:testville");
  assert.equal(zoneOf(t, "commons"), "loc:testville", "an area is in its city's zone");
  assert.equal(zoneOf(t, "cellar"), "loc:testville", "no location: the parent map's zone");
  assert.equal(zoneOf(t, "wilds"), "loc:region");
  assert.equal(zoneOf(t, "farbury"), "loc:far");
  assert.equal(zoneOf(t, "loose"), "map:loose", "nothing silently becomes the same place");
});

test("same zone: the token leaves the map it was on and arrives here, nothing else moves", () => {
  const t = fixture();
  const next = run(t, follow(t, "keep", "cellar"));
  assert.deepEqual(mapOf(next, "keep").tokens!.map((x) => x.entityId), ["bram"]);
  assert.deepEqual(mapOf(next, "cellar").tokens!.map((x) => [x.id, x.column, x.row]), [["mira-token", 5, 5]]);
  assert.equal(next.journal!.market!.currentLocationId, "testville");
  assert.ok(next.journal!.events.at(-1)!.summary.includes("followed to Cellar"));
  // Undo is the inverse follow, with the same checks.
  const back = run(next, { ...follow(next, "cellar", "keep"), at: { column: 2, row: 2 } });
  assert.deepEqual(mapOf(back, "keep").tokens!.find((x) => x.entityId === "mira")!.column, 2);
  assert.equal(mapOf(back, "cellar").tokens!.length, 0);
  // A district of the same city counts as the same place too.
  assert.doesNotThrow(() => run(t, follow(t, "keep", "commons")));
});

test("refusals: setting off, someone else's character, other zones, hidden maps stay generic", () => {
  assert.throws(() => run(fixture(false), follow(fixture(false), "keep", "cellar")), /hasn't turned on/);
  const t = fixture();
  assert.throws(() => run(t, follow(t, "keep", "cellar"), bram), /your own character/);
  assert.doesNotThrow(() => run(t, follow(t, "keep", "cellar"), dm));
  assert.throws(() => run(t, follow(t, "keep", "farbury")), /Viewing only — Mira is in Testville\./);
  assert.throws(() => run(t, follow(t, "keep", "wilds")), /Viewing only/);
  assert.throws(() => run(t, follow(t, "keep", "loose")), /Viewing only/);
  // A hidden map and a map that doesn't exist give the same message.
  const hidden = (() => {
    try {
      run(t, follow(t, "keep", "secret"));
    } catch (e) {
      return (e as Error).message;
    }
  })();
  const missing = (() => {
    try {
      run(t, { ...follow(t, "keep", "keep"), mapId: "nowhere" });
    } catch (e) {
      return (e as Error).message;
    }
  })();
  assert.equal(hidden, "This map is unavailable.");
  assert.equal(missing, hidden);
  // A stale view of either token refuses.
  assert.throws(() => run(t, { ...follow(t, "keep", "cellar"), beforeFrom: { ...ch("mira", 9, 9) } }), /moved or changed/);
});

test("combat, movement off and locks keep the token where it is", () => {
  const t = fixture();
  t.journal!.world!.combat = { id: "b", encounterId: "e", encounterRevision: 1, mapId: "keep", mode: "grid", phase: "active", gridFingerprint: g, scaleConfirmed: true, showPlayers: true, returnMapId: "keep", returnCamera: { x: 0.5, y: 0.5, zoom: 1 } } as never;
  assert.throws(() => run(t, follow(t, "keep", "cellar")), /In combat: your token stays on Keep/);
  const off = fixture();
  mapOf(off, "cellar").tabletop = { movement: "off" } as never;
  assert.throws(() => run(off, follow(off, "keep", "cellar")), /DM moves the tokens on Cellar/);
  const locked = fixture();
  mapOf(locked, "keep").tabletop = { movement: "auto", lockedPurseIds: ["mira"] } as never;
  assert.throws(() => run(locked, follow(locked, "keep", "cellar")), /locked Mira's movement on Keep/);
});

test("on the road, a token follows only onto the map with the party marker", () => {
  const t = fixture();
  t.journal!.world!.partyPosition = { mapId: "wilds", x: 0.5, y: 0.5, environment: "roads", description: "" } as never;
  assert.equal(followRefusal(t, "mira", "Mira", "wilds", "keep"), null);
  assert.match(followRefusal(t, "mira", "Mira", "cellar", "keep")!, /on the road/);
});

test("an existing token on the destination stays where the player can see it", () => {
  const t = fixture();
  mapOf(t, "cellar").tokens = [{ ...ch("mira", 7, 7), id: "mira-cellar" }];
  const next = run(t, follow(t, "keep", "cellar"));
  assert.deepEqual(mapOf(next, "cellar").tokens!.map((x) => [x.id, x.column]), [["mira-cellar", 7]]);
  assert.equal(mapOf(next, "keep").tokens!.some((x) => x.entityId === "mira"), false);
});

test("protocol 17: followView is kept from older clients; their drafts with follows are refused", () => {
  assert.equal(FOLLOW_VIEW_PROTOCOL, 17);
  const t = fixture();
  const old = tableForProtocol(t, 16).journal!.world!.tabletop!;
  assert.equal("followView" in old, false);
  const [c] = upgradeOldClientCommands(t, [{ id: "s", kind: "tabletop-session", before: old, session: { ...readTabletopSession({ journal: { ...t.journal!, world: { ...t.journal!.world!, tabletop: old } } }), tvEnabled: true } }], 16);
  const saved = applyCommand(t, dm, commandSchema.parse(c as CommandInput));
  assert.equal(readTabletopSession(saved).followView, true);
  assert.equal(readTabletopSession(saved).tvEnabled, true);
  for (const draft of [[{ kind: "map-token-follow" }], [{ kind: "tabletop-session", session: { followView: true } }]])
    assert.throws(() => tabletopResponse({ table: t, draft: JSON.stringify(draft) }, 16), /unfinished map actions/);
});

// Privacy review 2026-10-29 (finding B7): a client older than several session fields matches its
// `before` (all of them stripped in one pass) and its save keeps every field it couldn't see.
test("old DM clients save the session with both the formation and follow-view set (protocols 13-16)", () => {
  const t = fixture();
  t.journal!.world!.tabletop = { ...t.journal!.world!.tabletop!, partyFormation: { shape: "line", spacing: 1, rotation: 0 } } as never;
  for (let protocol = FOOTPRINT_PROTOCOL; protocol < FOLLOW_VIEW_PROTOCOL; protocol++) {
    const seen = tableForProtocol(structuredClone(t), protocol).journal!.world!.tabletop!;
    const [c] = upgradeOldClientCommands(t, [{ id: `s-${protocol}`, kind: "tabletop-session", before: seen, session: { ...seen, tvEnabled: true } }], protocol);
    const saved = readTabletopSession(applyCommand(t, dm, commandSchema.parse(c as CommandInput)));
    assert.equal(saved.followView, true, `protocol ${protocol}`);
    assert.deepEqual(saved.partyFormation, { shape: "line", spacing: 1, rotation: 0 }, `protocol ${protocol}`);
    assert.equal(saved.tvEnabled, true, `protocol ${protocol}`);
  }
});

// Privacy review 2026-10-29 (finding B5): the follow activity line reaches the mover and the DM only.
test("the follow event is visible to that character's player and the DM only", () => {
  const t = fixture();
  const keep = t.journal!.world!.maps[0];
  const next = run(t, { kind: "map-token-follow", mapId: "commons", grid: g, purseId: "mira", fromMapId: "keep", beforeFrom: keep.tokens![0], beforeTo: null, tokenId: "mira-token", at: { column: 1, row: 1 } }, mira);
  const sees = (seat: CloudSeat) => projectRecord(next, seat).journal!.events.some((e) => /followed to/.test(e.summary));
  assert.equal(sees(mira), true);
  assert.equal(sees(dm), true);
  assert.equal(sees(bram), false);
});
