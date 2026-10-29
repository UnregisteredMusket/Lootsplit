#!/usr/bin/env node
/**
 * Worker memory of shared room reads (history on demand, step 4). Local only: a disposable
 * file-backed D1 stand-in (scripts/account-dev-db.mjs) with every migration applied; never a real
 * campaign or production data.
 *
 *   node scripts/room-memory-measure.mjs setup FILE --live 2000000 --reports 10 --report-bytes 400000
 *   node --max-old-space-size=128 scripts/room-memory-measure.mjs read FILE --concurrency 3 --protocol 11
 *   node scripts/room-memory-measure.mjs scan FILE --protocol 12   # smallest heap one read fits, per protocol
 *   node scripts/room-memory-measure.mjs report --live 2000000 --reports 10   # setup + the whole table
 *
 * `read` makes N concurrent room reads (a changed-room read: read, project for the seat, split
 * into view sections and serialize the response) for the DM and players in turn, exactly as the
 * Worker answers `pullCloudTable`. It exits 0 when they all fit and non-zero when the heap limit
 * is hit. Workers give an isolate 128 MB.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localAccountDb } from "./account-dev-db.mjs";
import { archiveSessions, grow } from "./history-fixture.mjs";

const [mode, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = rest.indexOf(`--${name}`);
  return at >= 0 ? Number(rest[at + 1]) : fallback;
};
const file = rest[0] && !rest[0].startsWith("--") ? rest[0] : undefined;
const self = fileURLToPath(import.meta.url);

async function setup(path) {
  for (const suffix of ["", "-wal", "-shm", ".json"]) if (existsSync(path + suffix)) rmSync(path + suffix);
  const db = localAccountDb(path);
  globalThis.__env__ = { DB: db };
  const { openRoom, joinRoom } = await import("../src/lib/quire/cloud.server.ts");
  const { readRoom } = await import("../src/lib/quire/room-store.server.ts");
  const { roomWriteStatements, readStoredRoom } = await import("../cloudflare/room-storage.mjs");
  const { encodeRoomImages, roomImageStatements } = await import("../cloudflare/room-images.mjs");
  const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
  const dm = await openRoom({ name: "Measured DM", table: tradeFixture() });
  const a = await joinRoom({ code: dm.code, purseId: "a", name: "Arden's player" });
  const b = await joinRoom({ code: dm.code, purseId: "b", name: "Briar's player" });
  const room = await readRoom(dm.code);
  grow(room, flag("live", 2_000_000));
  // `--entries BYTES`: journal notes of about that size (part of the working set every read loads).
  const entries = flag("entries", 0);
  if (entries)
    room.table.journal.entries = Array.from({ length: Math.round(entries / 600) }, (_, i) => ({ id: `w-${i}`, at: i, authorId: "dm", purseId: "", visibility: i % 4 ? "party" : "dm", title: `Entry ${i}`, text: "Lore ".repeat(100), reportIds: [] }));
  archiveSessions(room, flag("reports", 0), flag("report-bytes", 400_000), room.seats.map((s) => s.id));
  room.revision++;
  // Stored below the application guard (the measurement may exceed today's cap on purpose).
  const encoded = await encodeRoomImages(room);
  const write = roomWriteStatements(db, room, { expect: (await readStoredRoom(db, dm.code)).version, body: encoded.body });
  const statements = [...write.statements, ...(await roomImageStatements(db, room, encoded, write.writeId))];
  if (!write.changed(await db.batch(statements), statements)) throw Error("setup write failed");
  const seats = [dm, { code: dm.code, token: a.token }, { code: dm.code, token: b.token }];
  const stored = await readStoredRoom(db, dm.code);
  const sizes = {
    storedBytes: Buffer.byteLength(stored.body),
    reportBytes: Number((await db.prepare("SELECT COALESCE(SUM(length(body)),0) AS n FROM campaign_room_reports WHERE code=?").bind(dm.code).first()).n),
  };
  writeFileSync(path + ".json", JSON.stringify({ seats, sizes }));
  return sizes;
}

/**
 * `--op`: `read` (a changed-room read, default), `write` (a purchase from the DM, answered with
 * its view), `undo` (Undo of the oldest purchase: a command that needs the whole live ledger and
 * every archived session), `whole` (the whole campaign as exports and deletion copies read it:
 * every page and archived session, projected for the DM, as exports were built before part 2),
 * `stream` (the DM's campaign file streamed one archived session at a time, as Download a copy and
 * deletion copies are built since part 2), `records` (Account → Session records streamed one
 * archived session at a time, follow-up (c)) and `records-whole` (records as built before it).
 */
async function read(path) {
  const { seats } = JSON.parse(readFileSync(path + ".json", "utf8"));
  globalThis.__env__ = { DB: localAccountDb(path) };
  const { roomState, submitCommands } = await import("../src/lib/quire/cloud.server.ts");
  const { roomViewResponse } = await import("../src/lib/quire/view-sections.server.ts");
  const { readRoom } = await import("../src/lib/quire/room-store.server.ts");
  const { projectRecord } = await import("../src/lib/quire/session-records.ts");
  const { canonicalJson } = await import("../src/lib/quire/canonical-json.ts");
  const protocol = flag("protocol", 11);
  const n = flag("concurrency", 1);
  const op = (rest[rest.indexOf("--op") + 1] && rest.includes("--op")) ? rest[rest.indexOf("--op") + 1] : "read";
  const started = performance.now();
  const results = await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const seat = seats[i % seats.length];
      const data = { ...seat, tabletopProtocol: protocol };
      if (op === "write") {
        const id = `measure-${process.pid}-${i}`;
        const view = await submitCommands({ ...seats[0], tabletopProtocol: protocol, batchId: id, commands: [{ id, kind: "give", fromId: "a", toId: "b", copper: 1, holdingId: null, quantity: 0 }] });
        return JSON.stringify(view).length;
      }
      if (op === "undo") {
        const room = await readRoom(seats[0].code);
        const line = room.table.ledger.find((l) => l.copper < 0 && l.transactionType === "purchase");
        const id = `undo-${process.pid}-${i}`;
        const view = await submitCommands({ ...seats[0], tabletopProtocol: protocol, batchId: id, commands: [{ id, kind: "ledger-void", target: { kind: "ledger", id: line.id }, before: canonicalJson(line), reason: "Measured." }] }).catch((error) => ({ error: String(error.message) }));
        return JSON.stringify(view).length;
      }
      if (op === "stream") {
        // Download a copy / deletion copy as streamed since part 2 (campaign-file-stream.mjs).
        const { readStoredRoom } = await import("../cloudflare/room-storage.mjs");
        const { campaignFileStream } = await import("../cloudflare/campaign-file-stream.mjs");
        const { room } = await readStoredRoom(globalThis.__env__.DB, seats[0].code);
        const file = await campaignFileStream(globalThis.__env__.DB, room, room.seats[0], (projected) => projected);
        let length = 0;
        for await (const chunk of file.chunks()) length += chunk.length;
        return length;
      }
      if (op === "records" || op === "records-whole") {
        // Account → Session records for the DM's account: `records` streamed one archived session
        // at a time (follow-up (c)); `records-whole` every session hydrated at once, as before it.
        const db = globalThis.__env__.DB;
        const user = `measure-user-${i}`;
        const { readStoredRoom } = await import("../cloudflare/room-storage.mjs");
        const { room } = await readStoredRoom(db, seats[0].code);
        const seat = room.seats.find((s) => s.role === "dm");
        await db.prepare(`INSERT OR IGNORE INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?, 'M', ?, 1, null, 0, 0)`).bind(user, `${user}@example.com`).run();
        await db.prepare("DELETE FROM library_members WHERE code=?").bind(seats[0].code).run();
        await db.prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)").bind(user, seats[0].code, seat.id, seat.token, "Measured").run();
        if (op === "records") {
          const { campaignRecordsStream } = await import("../cloudflare/campaign-records.mjs");
          let length = 0;
          for await (const chunk of (await campaignRecordsStream(db, user)).chunks()) length += chunk.length;
          return length;
        }
        const { hydrateRoomImages } = await import("../cloudflare/room-images.mjs");
        const { readArchivedSnapshot } = await import("../src/lib/quire/journal.ts");
        const whole = await hydrateRoomImages(db, room.code, room);
        const reports = whole.table.journal.reports.map((r) => ({ id: r.id, snapshot: projectRecord(readArchivedSnapshot(r.snapshot), seat) }));
        return JSON.stringify({ reports }).length;
      }
      if (op === "whole") {
        const room = await readRoom(seats[0].code);
        return JSON.stringify(projectRecord(room.table, room.seats[0])).length;
      }
      return JSON.stringify(await roomViewResponse(await roomState(data), data)).length;
    }),
  );
  console.log(JSON.stringify({ ok: true, op, protocol, concurrency: n, ms: Math.round(performance.now() - started), responseChars: results }));
}

function child(path, heap, extra) {
  // Each run works on its own copy, so a write or Undo never changes what the next run measures.
  const copy = `${path}.run.sqlite`;
  copyFileSync(path, copy);
  copyFileSync(path + ".json", copy + ".json");
  const run = spawnSync(process.execPath, [`--max-old-space-size=${heap}`, "--experimental-strip-types", "--no-warnings", self, "read", copy, ...extra], { encoding: "utf8" });
  if (process.env.MEASURE_DEBUG) process.stderr.write(run.stdout + run.stderr.slice(-400));
  return run.status === 0 && run.stdout.includes('"ok":true');
}

const OP = rest.includes("--op") ? rest[rest.indexOf("--op") + 1] : "read";
function scan(path, protocol) {
  // The smallest old-space size (MB) at which one operation completes.
  let low = 8, high = 1024;
  const args = ["--protocol", String(protocol), "--op", OP];
  if (!child(path, high, args)) return null;
  while (high - low > 2) {
    const mid = Math.floor((low + high) / 2);
    if (child(path, mid, args)) high = mid;
    else low = mid;
  }
  return high;
}

function concurrent(path, protocol) {
  const fits = {};
  for (const n of [1, 2, 3, 4, 6, 8]) fits[n] = child(path, 128, ["--concurrency", String(n), "--protocol", String(protocol), "--op", OP]);
  return fits;
}

if (mode === "setup") console.log(JSON.stringify(await setup(file)));
else if (mode === "read") await read(file);
else if (mode === "scan") console.log(JSON.stringify({ protocol: flag("protocol", 11), minHeapMB: scan(file, flag("protocol", 11)) }));
else if (mode === "report") {
  const path = file ?? "/tmp/lootsplit-room-memory.sqlite";
  const sizes = await setup(path);
  const rows = {};
  for (const protocol of (process.env.PROTOCOLS ?? "11").split(",").map(Number))
    rows[protocol] = { minHeapMB: scan(path, protocol), fitsIn128MB: concurrent(path, protocol) };
  console.log(JSON.stringify({ sizes, rows }, null, 1));
} else {
  console.error("Usage: setup FILE | read FILE | scan FILE | report [FILE] (see the header)");
  process.exit(2);
}
