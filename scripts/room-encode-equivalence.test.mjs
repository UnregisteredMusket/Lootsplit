// Room encoding one archived session at a time (room-images.mjs `encodeRoomImages`, follow-up (b)):
// the stored room body, its archived session rows, image assets and resource documents are byte
// for byte what the earlier encoding gave (the whole campaign serialized with its sessions, images
// replaced in that text, parsed again and the sessions moved out of a clone), for map artwork in
// and out of sessions, images that stay inline, resource packs inside sessions, deferred sessions,
// unreadable snapshots and both report list shapes; and the input is never changed.
import test from "node:test";
import assert from "node:assert/strict";
import { encodeRoomImages } from "../cloudflare/room-images.mjs";
import { encodeRoomResources } from "../cloudflare/room-resources.mjs";
import { encodeRoomReports } from "../cloudflare/room-reports.mjs";
import { DEFERRED_REPORT_PREFIX } from "../src/lib/quire/history-pages.ts";

/** The encoding before follow-up (b), from the same image assets. */
async function before(value, assets) {
  const resources = await encodeRoomResources(value);
  let body = JSON.stringify(resources.value);
  for (const asset of assets) body = body.split(asset.image).join(asset.reference);
  const reports = await encodeRoomReports(JSON.parse(body));
  if (reports.changed) body = JSON.stringify(reports.value);
  return { body, assets, documents: resources.documents, reports: reports.reports };
}

const image = (seed) => "data:image/png;base64," + seed.repeat(Math.ceil(9_000 / seed.length)).slice(0, 9_000);
const MAP_LIVE = image("TGl2ZW1hcA"), MAP_OLD = image("T2xkbWFw"), PORTRAIT = image("UG9ydHJhaXQ"), NOTE_ART = image("Tm90ZWFydA");
const pack = (name) => ({ format: "lootsplit.resource-pack", name, items: [{ id: name, text: "ü€".repeat(50) }] });
const snapshot = (n, extra = {}) =>
  JSON.stringify({
    purses: [{ id: "a", name: `Arden ${n}`, sheet: { portrait: PORTRAIT } }],
    ledger: Array.from({ length: 30 }, (_, i) => ({ id: `l-${n}-${i}`, summary: `Line ${i} "quoted" \\ ü` })),
    journal: {
      world: { maps: [{ id: "atlas", image: n % 2 ? MAP_LIVE : MAP_OLD }] },
      entries: [{ id: `e-${n}`, art: NOTE_ART, text: "Lore" }],
      resourceLibrary: { packs: n === 2 ? [pack(`pack-${n}`)] : [] },
    },
    ...extra,
  });

function room() {
  return {
    code: "ROOMCODE01",
    revision: 3,
    seats: [{ id: "dm", role: "dm", token: "t" }],
    table: {
      purses: [{ id: "a", name: "Arden", sheet: { portrait: PORTRAIT } }],
      notes: [{ id: "n1", text: "Current ü" }],
      journal: {
        world: { maps: [{ id: "atlas", image: MAP_LIVE }] },
        entries: [{ id: "e-live", art: NOTE_ART }],
        resourceLibrary: { packs: [pack("live")] },
        reports: [
          { id: "r1", name: "Session 1", at: 1, seatIds: ["dm"], snapshot: snapshot(1) },
          { id: "r2", snapshotReference: "kept-in-place", name: "Session 2", at: 2, snapshot: snapshot(2) },
          { id: "r3", name: "Deferred", at: 3, snapshot: DEFERRED_REPORT_PREFIX + "session-report:" + "a".repeat(64) },
          { id: "r4", name: "Unreadable", at: 4, snapshot: '{"broken' },
          { id: "r5", name: "Same as one", at: 5, snapshot: snapshot(1) },
          { id: "r6", name: "Stored", at: 6, snapshotReference: "session-report:" + "b".repeat(64) },
        ],
      },
    },
    storageWarning: { totalBytes: 9, limit: 5 },
  };
}

async function same(value) {
  const input = JSON.stringify(value);
  const now = await encodeRoomImages(value);
  assert.equal(JSON.stringify(value), input, "the input is not changed");
  const then = await before(value, now.assets);
  assert.equal(now.body, then.body);
  assert.deepEqual(now.reports, then.reports);
  assert.deepEqual(now.documents, then.documents);
  return now;
}

test("a room with archived sessions encodes byte for byte as before", async () => {
  const encoded = await same(room());
  assert.ok(encoded.assets.length >= 3, "map and journal artwork move out");
  assert.ok(!encoded.assets.some((a) => a.image === PORTRAIT), "a portrait stays inline");
  assert.equal(encoded.reports.length, 3, "identical sessions are stored once; deferred and stored ones are not stored again");
  assert.ok(encoded.reports.filter((r) => r.body.startsWith('{"purses"')).length === 2);
  assert.ok(encoded.reports.filter((r) => r.body.startsWith('{"purses"')).every((r) => !r.body.includes(MAP_OLD) && !r.body.includes(NOTE_ART) && r.body.includes(PORTRAIT)));
  assert.ok(encoded.reports.some((r) => r.body.includes('"resourceReference"')), "a pack inside a session is a document");
  assert.ok(!encoded.body.includes('"snapshot"'));
});

test("other shapes encode as before: a bare table, a room without sessions, a room without images", async () => {
  const value = room();
  await same(value.table);
  await same({ journal: value.table.journal });
  const plain = room();
  delete plain.table.journal.reports;
  await same(plain);
  const noImages = JSON.parse(JSON.stringify(room()).split(MAP_LIVE).join("x").split(MAP_OLD).join("y").split(NOTE_ART).join("z"));
  await same(noImages);
  await same({ table: { journal: { reports: [] } } });
});

test("an image only inside an archived session moves out of it, as before", async () => {
  const value = room();
  value.table.journal.world.maps = [];
  value.table.journal.entries = [];
  const encoded = await same(value);
  assert.ok(encoded.assets.some((a) => a.image === MAP_OLD));
});
