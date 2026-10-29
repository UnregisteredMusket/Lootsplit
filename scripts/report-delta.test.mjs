// Delta-stored archived sessions (report-delta.mjs): consecutive archives store what changed
// against an earlier full snapshot of the same room; every reader still receives the exact
// original snapshot text (verified by SHA-256); full-copy archives stored before stay readable;
// a damaged base or delta is an error, never history; the total-size warning counts whole
// snapshots. Disposable local D1 stand-in with every migration applied; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { localAccountDb } from "./account-dev-db.mjs";

const db = localAccountDb();
globalThis.__env__ = { DB: db };
const { openRoom, joinRoom, submitCommands, choosePace } = await import("../src/lib/quire/cloud.server.ts");
const { readRoom } = await import("../src/lib/quire/room-store.server.ts");
const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
const { encodeReportDelta, decodeReportDelta, reportDeltaMarker } = await import("../cloudflare/report-delta.mjs");
const { ARCHIVED_BYTES_SQL, setReportDeltasForTests } = await import("../cloudflare/room-reports.mjs");
test.after(() => setReportDeltasForTests(true));

const sha = (text) => "session-report:" + createHash("sha256").update(text).digest("hex");
const rows = (code) => db.prepare("SELECT reference,body FROM campaign_room_reports WHERE code=? ORDER BY rowid").bind(code).all().then((r) => r.results);

async function campaign(name) {
  const table = tradeFixture();
  // A world worth repeating: many NPCs and journal entries every archive carries.
  table.journal = { ...(table.journal ?? {}), entries: Array.from({ length: 400 }, (_, i) => ({ id: `e-${i}`, at: i, authorId: "dm", purseId: "", visibility: "party", title: `Entry ${i}`, text: "Lore ".repeat(60), reportIds: [] })) };
  const dm = await openRoom({ name, table });
  const a = await joinRoom({ code: dm.code, purseId: "a", name: "Arden" });
  await choosePace({ ...dm, live: true });
  return { dm, a: { code: dm.code, token: a.token } };
}
async function playSession(seats, n) {
  await submitCommands({ ...seats.dm, batchId: `s-${n}`, commands: [{ id: `s-${n}`, kind: "session", name: `Session ${n}`, end: false }] });
  await submitCommands({
    ...seats.a,
    batchId: `chat-${n}`,
    commands: Array.from({ length: 30 }, (_, i) => ({ id: `m-${n}-${i}`, kind: "message", to: "party", purseId: "a", text: `Session ${n}, line ${i}` })),
  });
  await submitCommands({
    ...seats.dm,
    batchId: `give-${n}`,
    commands: Array.from({ length: 10 }, (_, i) => ({ id: `g-${n}-${i}`, kind: "give", fromId: "a", toId: "b", copper: 1, holdingId: null, quantity: 0 })),
  });
  await submitCommands({ ...seats.dm, batchId: `e-${n}`, commands: [{ id: `e-${n}`, kind: "session", name: `Session ${n}`, end: true }] });
}

test("the codec reproduces a snapshot byte for byte, and declines when a delta would not save a fifth", () => {
  const base = { purses: [{ id: "a", coins: 1 }, { id: "b", coins: 2 }], journal: { entries: Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, text: "x".repeat(200) })), events: [] }, ledger: [] };
  const next = structuredClone(base);
  next.purses[1].coins = 5;
  next.purses.push({ id: "c", coins: 0 });
  next.journal.events.push({ id: "ev", summary: "new" });
  next.ledger = [{ id: "l1", copper: 3 }];
  const text = JSON.stringify(next), baseText = JSON.stringify(base);
  const body = encodeReportDelta(text, sha(text), baseText, sha(baseText));
  assert.ok(body && body.length < text.length / 4, "a small delta");
  assert.equal(decodeReportDelta(reportDeltaMarker(body), baseText), text);
  // Unrelated snapshots: no delta.
  assert.equal(encodeReportDelta(JSON.stringify({ other: "y".repeat(5000) }), "r", baseText, "b"), null);
});

test("consecutive archives are stored as deltas, read back exactly, and counted whole for the warning", async () => {
  const seats = await campaign("Delta DM");
  for (let n = 1; n <= 5; n++) await playSession(seats, n);
  const stored = await rows(seats.dm.code);
  assert.equal(stored.length, 5);
  assert.equal(reportDeltaMarker(stored[0].body), null, "the first archive is a full snapshot");
  assert.ok(stored.slice(1).every((row) => reportDeltaMarker(row.body)?.base === stored[0].reference), "later archives are deltas against it");
  // Every reader gets the exact snapshot it would have got before.
  const room = await readRoom(seats.dm.code);
  const reports = room.table.journal.reports;
  assert.equal(reports.length, 5);
  for (const [i, report] of reports.entries()) {
    assert.equal(sha(report.snapshot), stored[i].reference, "byte for byte, verified by its reference");
    assert.ok(JSON.parse(report.snapshot).notes.some((note) => note.text === `Session ${i + 1}, line 0`));
  }
  const storedBytes = stored.reduce((sum, row) => sum + row.body.length, 0);
  const logical = reports.reduce((sum, report) => sum + Buffer.byteLength(report.snapshot), 0);
  assert.ok(storedBytes < logical / 2, `stored ${storedBytes} bytes for ${logical} bytes of snapshots`);
  // The total-size warning counts whole snapshots, which is what whole-campaign operations load.
  const counted = Number((await db.prepare(ARCHIVED_BYTES_SQL).bind(seats.dm.code).first()).n);
  assert.equal(counted, logical);
});

test("full-copy archives stored before stay readable, and later deltas build on them", async () => {
  const seats = await campaign("Old copies DM");
  setReportDeltasForTests(false);
  for (let n = 1; n <= 2; n++) await playSession(seats, n);
  setReportDeltasForTests(true);
  for (let n = 3; n <= 4; n++) await playSession(seats, n);
  const stored = await rows(seats.dm.code);
  assert.deepEqual(stored.map((row) => !!reportDeltaMarker(row.body)), [false, false, true, true]);
  assert.ok(stored.slice(2).every((row) => reportDeltaMarker(row.body).base === stored[1].reference), "against the latest full copy");
  const reports = (await readRoom(seats.dm.code)).table.journal.reports;
  assert.deepEqual(reports.map((r) => sha(r.snapshot)), stored.map((row) => row.reference));
});

test("a damaged delta or a missing base is an error, never history", async () => {
  const seats = await campaign("Damage DM");
  for (let n = 1; n <= 2; n++) await playSession(seats, n);
  const [base, delta] = await rows(seats.dm.code);
  const marker = JSON.parse(delta.body);
  // Tampered contents: decoding no longer matches the reference.
  const tampered = JSON.stringify(marker).replace("Session 2, line 0", "Session 2, line X");
  await db.prepare("UPDATE campaign_room_reports SET body=? WHERE code=? AND reference=?").bind(tampered, seats.dm.code, delta.reference).run();
  await assert.rejects(readRoom(seats.dm.code), /damaged/);
  await db.prepare("UPDATE campaign_room_reports SET body=? WHERE code=? AND reference=?").bind(delta.body, seats.dm.code, delta.reference).run();
  assert.ok(await readRoom(seats.dm.code));
  // Missing base.
  await db.prepare("DELETE FROM campaign_room_reports WHERE code=? AND reference=?").bind(seats.dm.code, base.reference).run();
  await assert.rejects(readRoom(seats.dm.code), /missing|incomplete/);
});
