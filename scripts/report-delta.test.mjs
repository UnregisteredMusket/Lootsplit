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
const { ARCHIVED_BYTES_SQL, setReportDeltasForTests, REPORT_DELTA_WRITES, readRoomReportSnapshots, roomReportStatements, REPORT_INLINE_BYTES } = await import("../cloudflare/room-reports.mjs");
// This release reads deltas; writing them is the next release (REPORT_DELTA_WRITES). Tests that
// need delta rows turn writing on for themselves.
test.after(() => setReportDeltasForTests(REPORT_DELTA_WRITES));

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
  setReportDeltasForTests(true);
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
  setReportDeltasForTests(REPORT_DELTA_WRITES);
  const stored = await rows(seats.dm.code);
  assert.deepEqual(stored.map((row) => !!reportDeltaMarker(row.body)), [false, false, true, true]);
  assert.ok(stored.slice(2).every((row) => reportDeltaMarker(row.body).base === stored[1].reference), "against the latest full copy");
  const reports = (await readRoom(seats.dm.code)).table.journal.reports;
  assert.deepEqual(reports.map((r) => sha(r.snapshot)), stored.map((row) => row.reference));
});

test("a damaged delta or a missing base is an error, never history", async () => {
  setReportDeltasForTests(true);
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

test("this release writes archived sessions in full; it only reads deltas", async () => {
  assert.equal(REPORT_DELTA_WRITES, false, "delta writes ship in the next release, after readers are live");
  setReportDeltasForTests(REPORT_DELTA_WRITES);
  const seats = await campaign("Reader release DM");
  for (let n = 1; n <= 3; n++) await playSession(seats, n);
  assert.ok((await rows(seats.dm.code)).every((row) => !reportDeltaMarker(row.body)));
});

// Unit-level storage on a bare room row (the reviewer's stand-in).
async function bareRoom(code) {
  await db.prepare("INSERT INTO campaign_rooms(code,revision,body,write_id) VALUES (?,1,'{}','w1')").bind(code).run();
}
const store = async (code, texts) =>
  db.batch(await roomReportStatements(db, { code, revision: 1 }, { body: "{}", reports: texts.map((t) => ({ reference: sha(t), body: t })) }, "w1"));

test("a delta over the row limit in UTF-8 bytes is stored as a full snapshot in parts (800K CJK characters)", async () => {
  setReportDeltasForTests(true);
  try {
    await bareRoom("CJKROOM1");
    const base = { world: Array.from({ length: 400 }, (_, i) => ({ id: "w" + i, t: "日".repeat(5000) })), chat: [] };
    const next = { ...base, chat: [{ id: "c", text: "日".repeat(800_000) }] };
    const baseText = JSON.stringify(base), text = JSON.stringify(next);
    // The delta alone: under the limit in characters, over it in bytes.
    const delta = encodeReportDelta(text, sha(text), baseText, sha(baseText));
    assert.ok(delta && delta.length <= REPORT_INLINE_BYTES && Buffer.byteLength(delta) > REPORT_INLINE_BYTES);
    await store("CJKROOM1", [baseText]);
    await store("CJKROOM1", [text]);
    const row = await db.prepare("SELECT body FROM campaign_room_reports WHERE code=? AND reference=?").bind("CJKROOM1", sha(text)).first();
    assert.ok(Buffer.byteLength(row.body) < 2_000_000, "every stored row fits D1");
    assert.equal(reportDeltaMarker(row.body), null, "stored in full (in parts), not as a delta");
    assert.equal((await readRoomReportSnapshots(db, "CJKROOM1", [sha(text)])).get(sha(text)), text);
    const parts = await db.prepare("SELECT body FROM campaign_room_report_parts WHERE code=?").bind("CJKROOM1").all();
    assert.ok(parts.results.every((part) => Buffer.byteLength(part.body) <= 1_000_000));
  } finally {
    setReportDeltasForTests(REPORT_DELTA_WRITES);
  }
});

test("a full row whose text begins like a delta is refused, never read as different text", async () => {
  await bareRoom("CRAFTED1");
  const base = JSON.stringify({ world: Array.from({ length: 200 }, (_, i) => ({ id: "w" + i, t: "lore ".repeat(50) })), notes: [] });
  await store("CRAFTED1", [base]);
  const node = ["o", [["world", ["s"]], ["notes", ["v", [{ id: "x", text: "not what was stored" }]]]]];
  const decoded = decodeReportDelta({ node }, base);
  const crafted = JSON.stringify({ $reportDelta: { v: 1, reference: sha(decoded), base: sha(base), bytes: 1, node } });
  await store("CRAFTED1", [crafted]);
  await assert.rejects(readRoomReportSnapshots(db, "CRAFTED1", [sha(crafted)]), /damaged/);
});

test("no code deletes archived session rows (a delta's base must outlive every reader)", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (!["node_modules", "migrations", ".git", "dist"].includes(name)) walk(path);
      } else if (/\.(m?[jt]sx?)$/.test(name) && !/\.test\./.test(name) && /DELETE\s+FROM\s+campaign_room_report(s|_parts)\b/i.test(readFileSync(path, "utf8")))
        found.push(path);
    }
  };
  for (const dir of ["cloudflare", "src", "server", "standby"]) {
    try {
      walk(new URL("../" + dir, import.meta.url).pathname);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  assert.deepEqual(found, [], "report rows are removed only with their room (ON DELETE CASCADE)");
});

test("encoding is bounded: a snapshot with too many records is stored in full", () => {
  const base = { rows: Array.from({ length: 250_000 }, (_, i) => ({ id: "r" + i, v: i })) };
  const next = { rows: base.rows.map((row, i) => (i % 2 ? row : { ...row, v: -i })) };
  const baseText = JSON.stringify(base), text = JSON.stringify(next);
  assert.equal(encodeReportDelta(text, sha(text), baseText, sha(baseText)), null);
});

// The reviewer's fuzz: every delta the codec agrees to store decodes to exactly the same text.
test("codec fuzz: every stored delta decodes exactly", () => {
  const rnd = (seed) => { let x = seed; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; };
  const chars = ["a", "é", "日", "😀", "\ud800", "\udfff", '"', "\\", "\n", "\u0000", "__proto__", "1", "-0"];
  const str = (r) => { let o = ""; const n = Math.floor(r() * 8); for (let i = 0; i < n; i++) o += chars[Math.floor(r() * chars.length)]; return o; };
  const val = (r, d) => {
    const k = r();
    if (d > 7 || k < 0.3) return [1, -0, 1e21, 0.1, null, true, str(r), 2 ** 60][Math.floor(r() * 8)];
    if (k < 0.6) return Array.from({ length: Math.floor(r() * 5) }, (_, i) => (r() < 0.7 ? { id: r() < 0.9 ? "i" + i : str(r), x: val(r, d + 1) } : val(r, d + 1)));
    const o = {};
    for (let i = 0; i < Math.floor(r() * 5); i++) Object.defineProperty(o, r() < 0.2 ? str(r) : ["a", "b", "10", "2", "__proto__"][Math.floor(r() * 5)], { value: val(r, d + 1), enumerable: true, writable: true, configurable: true });
    return o;
  };
  const mutate = (r, v, d) => {
    if (r() < 0.2 || d > 7) return val(r, d);
    if (Array.isArray(v)) { const c = v.map((x) => (r() < 0.3 ? mutate(r, x, d + 1) : x)); if (r() < 0.3) c.reverse(); if (r() < 0.3) c.push(val(r, d)); return c; }
    if (v && typeof v === "object") { const c = {}; for (const [k, x] of Object.entries(v)) if (r() > 0.1) Object.defineProperty(c, k, { value: r() < 0.3 ? mutate(r, x, d + 1) : x, enumerable: true, writable: true, configurable: true }); if (r() < 0.3) c[str(r)] = val(r, d); return c; }
    return val(r, d);
  };
  let stored = 0;
  for (let seed = 1; seed < 6000; seed++) {
    const r = rnd(seed);
    const pad = { big: Array.from({ length: 30 }, (_, i) => ({ id: "p" + i, t: "lore 日😀 ".repeat(20) })) };
    const base = { ...pad, x: val(r, 0) };
    const next = r() < 0.1 ? structuredClone(base) : { ...mutate(r, pad, 1), x: mutate(r, base.x, 0) };
    const text = JSON.stringify(next), baseText = JSON.stringify(base);
    const body = encodeReportDelta(text, sha(text), baseText, sha(baseText));
    if (!body) continue;
    stored++;
    assert.equal(decodeReportDelta(reportDeltaMarker(body), baseText), text, "seed " + seed);
  }
  assert.ok(stored > 300, "stored " + stored);
});

test("the total counts UTF-8 bytes for full rows, parts and deltas alike", async () => {
  await bareRoom("BYTES001");
  const text = JSON.stringify({ notes: [{ id: "n", text: "日本語".repeat(1000) }] });
  await store("BYTES001", [text]);
  assert.equal(Number((await db.prepare(ARCHIVED_BYTES_SQL).bind("BYTES001").first()).n), Buffer.byteLength(text));
});
