import test from "node:test";
import assert from "node:assert/strict";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal, preserveJournalMetadata, readArchivedSnapshot } from "./journal.ts";
import { campaignMapSchema, type CampaignMap } from "./world-schema.ts";
import { applyCommand } from "./commands.ts";
import { projectRecord } from "./session-records.ts";
import {
  CURRENT_TABLETOP_PROTOCOL,
  MAP_SCALE_PROTOCOL,
  hasMapScales,
  tableForProtocol,
  tabletopResponse,
  withoutMapScale,
} from "./tabletop-protocol.ts";
import { routeFrame } from "./journey.ts";

const dm: CloudSeat = { id: "dm", name: "DM", role: "dm", token: "t", purseIds: [] };
const player: CloudSeat = { ...dm, id: "p", role: "player", purseIds: ["aria"] };
const coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
const scale = { a: { x: 0.2, y: 0.5 }, b: { x: 0.4268, y: 0.5 }, distance: 27, unit: "mi" as const, aspect: 1.5 };
const vale = (extra: Partial<CampaignMap> = {}) =>
  campaignMapSchema.parse({
    id: "vale",
    name: "Vale of Harrow",
    image: "data:image/png;base64,YQ==",
    locationId: null,
    visible: true,
    type: "regional",
    anchors: [],
    markers: [],
    ...extra,
  });
function fixture(map = vale({ scale })): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [{ id: "aria", name: "Aria", kind: "character", coins }] as CloudTable["purses"],
    journal: readJournal({ world: { maps: [map] } }),
  };
}
const valeOf = (t: CloudTable) => t.journal!.world!.maps.find((m) => m.id === "vale")!;

test("the DM saves a scale bar through map-save; players can't", () => {
  const t = fixture(vale());
  const before = valeOf(t);
  const save = { kind: "map-save" as const, mapId: "vale", before, map: { ...before, scale } };
  assert.throws(() => applyCommand(t, player, { id: "s0", ...save }), /DM/);
  const saved = applyCommand(t, dm, { id: "s1", ...save });
  assert.deepEqual(valeOf(saved).scale, scale);
  assert.equal(routeFrame(valeOf(saved))?.kind, "scale");
  // A player on a shared map receives the scale (Measure uses it).
  assert.deepEqual(valeOf(projectRecord(saved, player)).scale, scale);
  // The DM can remove it again.
  const removed = applyCommand(saved, dm, {
    id: "s2",
    kind: "map-save",
    mapId: "vale",
    before: valeOf(saved),
    map: withoutMapScale(valeOf(saved)),
  });
  assert.equal(valeOf(removed).scale, undefined);
  // An invalid scale (handles on top of each other) is refused.
  assert.throws(() =>
    applyCommand(t, dm, { id: "s3", ...save, map: { ...before, scale: { ...scale, b: scale.a } } }),
  );
});

test("old saves without a scale load unchanged", () => {
  const t = fixture(vale());
  assert.equal(valeOf(t).scale, undefined);
  assert.equal(hasMapScales(t), false);
  assert.equal(tableForProtocol(t, 0).journal!.world!.maps[0].scale, undefined);
  assert.equal(tableForProtocol(t, 5), t);
});

test("protocols 0-5 never receive a scale bar; their saves keep it", () => {
  const t = fixture();
  assert.equal(MAP_SCALE_PROTOCOL, 6);
  assert.equal(CURRENT_TABLETOP_PROTOCOL, MAP_SCALE_PROTOCOL);
  assert.equal(hasMapScales(t), true);
  for (const protocol of [0, 1, 2, 3, 4, 5])
    assert.equal(hasMapScales(tableForProtocol(t, protocol)), false, `protocol ${protocol}`);
  assert.equal(tableForProtocol(t, 6), t);
  // Archived session reports are cleaned the same way.
  const archived = {
    ...t,
    journal: readJournal({
      ...t.journal,
      reports: [{ id: "r", name: "Session 1", at: 1, snapshot: JSON.stringify(t) }],
    }),
  };
  const old = tableForProtocol(archived, 5);
  assert.equal(hasMapScales(old), false);
  assert.equal(
    readArchivedSnapshot(old.journal!.reports![0].snapshot).journal!.world!.maps[0].scale,
    undefined,
  );
  assert.equal(hasMapScales(tabletopResponse({ table: t, draft: "[]" }, 5).table), false);
  assert.equal(hasMapScales(tabletopResponse({ table: t, draft: "[]" }, 6).table), true);
  // An older app saves the map it saw (without a scale): the stored scale survives.
  const seen = withoutMapScale(valeOf(t));
  const legacy = applyCommand(t, dm, {
    id: "l1",
    kind: "map-save",
    mapId: "vale",
    before: seen,
    map: { ...seen, name: "The Vale" },
  });
  assert.equal(valeOf(legacy).name, "The Vale");
  assert.deepEqual(valeOf(legacy).scale, scale);
  // A whole-journal write from an older client keeps it too.
  const merged = preserveJournalMetadata(
    readJournal({ ...t.journal, world: { ...t.journal!.world!, maps: [seen] } }),
    t.journal!,
  );
  assert.deepEqual(merged.world!.maps[0].scale, scale);
  // Pending newer map work tells an older app to finish it on the updated website.
  const draft = JSON.stringify([
    { id: "d", kind: "map-save", mapId: "vale", before: seen, map: valeOf(t) },
  ]);
  for (const protocol of [0, 3, 4, 5])
    assert.throws(() => tabletopResponse({ table: t, draft }, protocol), /updated Lootsplitter client/);
  assert.doesNotThrow(() => tabletopResponse({ table: t, draft }, 6));
});
