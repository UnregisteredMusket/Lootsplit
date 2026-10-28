// Live-campaign load audit (owner request, 2026-10-28): a DM alone, then one player at a time up to
// six people in one live shared room. It drives the real room server functions (open, join, poll,
// pull, submit) against a disposable SQLite database built from every production migration, with
// an instrumented D1 stand-in that counts queries, rows and bytes, simulates the Worker→D1 round
// trip and records revision conflicts. Nothing here touches a live site or production data.
//
// OWNER AUTHORIZATION REQUIRED. This audit is not part of CI, npm test, any workflow or schedule,
// and must not become one without the owner's approval. It refuses to start unless
// LOOTSPLIT_LOAD_AUDIT names the authorization (for example "owner-2026-10-28") and refuses CI.
//
//   LOOTSPLIT_LOAD_AUDIT=owner-YYYY-MM-DD node --experimental-strip-types scripts/live-load-audit.mjs
//   Options (env): LOAD_STAGE_SECONDS (default 60), LOAD_D1_MS (simulated D1 round trip, default 4),
//   LOAD_SCENARIO=typical|heavy (heavy = long history and inline map art), LOAD_OUT (results dir).
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { AsyncLocalStorage } from "node:async_hooks";

if (process.env.CI) throw Error("The live-campaign load audit never runs in CI.");
const authorization = process.env.LOOTSPLIT_LOAD_AUDIT ?? "";
if (!/^owner-\d{4}-\d{2}-\d{2}$/.test(authorization))
  throw Error("Owner authorization required: set LOOTSPLIT_LOAD_AUDIT=owner-YYYY-MM-DD (see docs/audit).");

const STAGE_MS = Number(process.env.LOAD_STAGE_SECONDS ?? 60) * 1000;
const D1_MS = Number(process.env.LOAD_D1_MS ?? 4);
const SCENARIO = process.env.LOAD_SCENARIO ?? "typical";
const OUT = process.env.LOAD_OUT ?? "test-results/live-load-audit";
const POLL_MS = 2000; // cloud-client.ts start(): 2 s while visible, doubling only after failures

// ---- Instrumented D1 stand-in ----------------------------------------------------------------
const sql = new DatabaseSync(":memory:");
const migrations = new URL("../cloudflare/migrations/", import.meta.url);
for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort())
  sql.exec(readFileSync(new URL(file, migrations), "utf8"));
const meters = new AsyncLocalStorage(); // attributes each query to the operation that issued it
const conflicts = { count: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function note(query, rows, bytes, ms, written = 0) {
  const m = meters.getStore();
  if (!m) return;
  m.queries++;
  m.rowsRead += rows;
  m.bytesRead += bytes;
  m.bytesWritten += written;
  m.sqlMs += ms;
  if (/json_extract/.test(query)) m.jsonExtract++;
}
const size = (value) => (value == null ? 0 : Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value)));
function statement(query) {
  let values = [];
  const run = async (kind) => {
    await sleep(D1_MS);
    const at = performance.now();
    if (kind === "all") {
      const results = sql.prepare(query).all(...values);
      note(query, results.length, size(results), performance.now() - at);
      return { results };
    }
    if (kind === "first") {
      const row = sql.prepare(query).get(...values) ?? null;
      note(query, row ? 1 : 0, size(row), performance.now() - at);
      return row;
    }
    const changes = Number(sql.prepare(query).run(...values).changes);
    const written = values.reduce((n, v) => n + (typeof v === "string" ? Buffer.byteLength(v) : 0), 0);
    note(query, 0, 0, performance.now() - at, written);
    if (/^UPDATE campaign_rooms SET revision/.test(query) && !changes) { conflicts.count++; const m = meters.getStore(); if (m) m.conflicts++; }
    return { meta: { changes } };
  };
  return {
    bind(...args) { values = args; return this; },
    all: () => run("all"),
    first: () => run("first"),
    run: () => run("run"),
  };
}
globalThis.__env__ = {
  DB: {
    prepare: statement,
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  },
};

const { openRoom, joinRoom, pollRoom, roomState, submitCommands, choosePace } = await import("../src/lib/quire/cloud.server.ts");
const { readJournal } = await import("../src/lib/quire/journal.ts");
const { mapGridSchema } = await import("../src/lib/quire/world-schema.ts");
const { buildWayfarers } = await import("./product-screenshot-fixture.mjs");
const { tabletopResponse } = await import("../src/lib/quire/tabletop-protocol.ts");
const { canonicalJson } = await import("../src/lib/quire/canonical-json.ts");
const { mapTabletopSchema } = await import("../src/lib/quire/tabletop-schema.ts");
const { mapSignals } = await import("../src/lib/quire/map-signals.server.ts");
const PING_MS = 1000; // use-map-pings.ts: every client with a map open reads signals each second

// ---- Campaign fixture ------------------------------------------------------------------------
const PLAYERS = ["mira", "bram", "rowan", "tamsin", "quill"];
function campaign() {
  const t = buildWayfarers();
  t.purses.push({ id: "quill", name: "Quill Marsh", kind: "character", coins: { cp: 0, sp: 40, ep: 0, gp: 55, pp: 0 } });
  const grid = mapGridSchema.parse({ columns: 40, rows: 30 });
  const art = SCENARIO === "heavy" ? `data:image/webp;base64,${Buffer.alloc(360_000, 7).toString("base64")}` : "data:image/png;base64,cHJpdmF0ZS1zb3VyY2U=";
  const tokens = [
    ...PLAYERS.map((id, i) => ({ id: `${id}-token`, kind: "character", entityId: id, label: id, column: 2 + i * 3, row: 2, visibility: "party" })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: `goblin-${i}`, kind: "other", label: `Goblin ${i + 1}`, column: 10 + i, row: 20, visibility: "party" })),
  ];
  const journal = readJournal({
    ...t.journal,
    world: { ...t.journal?.world, maps: [{ id: "keep", name: "Ashen Keep", image: art, locationId: null, visible: true, anchors: [], markers: [], grid, tokens, tabletop: mapTabletopSchema.parse({ playerMovement: true }) }] },
  });
  t.journal = journal;
  if (SCENARIO === "heavy") {
    // A long-running campaign: thousands of ledger lines and messages already in the room.
    for (let i = 0; i < 4000; i++)
      t.ledger.push({ id: `old-${i}`, at: i, purseId: PLAYERS[i % 5], shopId: null, summary: `Old purchase ${i}`, copper: -(i % 97), transactionType: "purchase" });
    for (let i = 0; i < 1500; i++)
      t.notes.push({ id: `old-note-${i}`, at: i, from: "dm", to: "party", purseId: PLAYERS[i % 5], text: `Earlier session message ${i}: the road north is quiet.` });
  }
  return t;
}

// ---- Measurement ---------------------------------------------------------------------------
const samples = [];
async function measure(stage, actor, op, work) {
  const m = { stage, actor, op, queries: 0, rowsRead: 0, bytesRead: 0, bytesWritten: 0, sqlMs: 0, jsonExtract: 0, conflicts: 0 };
  const at = performance.now();
  try {
    const result = await meters.run(m, work);
    m.ok = true;
    m.responseBytes = size(result);
    m.full = !(result && result.unchanged);
    return result;
  } catch (error) {
    m.ok = false;
    m.error = String(error?.message ?? error).slice(0, 160);
    if (error instanceof TypeError) m.stack = String(error.stack).split("\n").slice(0, 8).join(" | ");
    return undefined;
  } finally {
    m.ms = performance.now() - at;
    samples.push(m);
  }
}
const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10;
};

// ---- Clients ---------------------------------------------------------------------------------
class Client {
  constructor(name, seat, role, purseId) {
    Object.assign(this, { name, seat, role, purseId, revision: seat.revision, seen: new Map(), step: 0, joinedAt: performance.now() });
    this.tokenAt = { column: 0, row: 0 };
  }
  async poll(stage) {
    const result = await measure(stage, this.name, "poll", () =>
      pollRoom({ tabletopProtocol: 10, code: this.seat.code, token: this.seat.token, knownRevision: this.revision, knownSeatId: this.seat.seatId }).then((r) => (r?.unchanged ? r : tabletopResponse(r, 10))),
    );
    if (result && !result.unchanged) {
      this.revision = result.revision;
      this.table = result.table;
      const now = performance.now();
      // Only changes made after this client joined, by someone else, count as propagation.
      for (const [rev, at] of commits) if (at >= this.joinedAt && rev <= result.revision && !this.seen.has(rev)) this.seen.set(rev, now - at);
    }
  }
  next(stage) {
    const t = this.table;
    const id = `${this.name}-${stage}-${this.step++}`;
    const map = t?.journal?.world?.maps?.find((m) => m.id === "keep");
    if (this.role === "dm") {
      const kind = this.step % 4;
      if (kind === 0) return { id, kind: "message", to: "party", purseId: "party", text: `DM narration ${this.step}` };
      if (kind === 1) return { id, kind: "give", fromId: "party", toId: PLAYERS[this.step % PLAYERS.length], copper: 10, holdingId: null, quantity: 0 };
      if (kind === 2) {
        const tok = map?.tokens.find((x) => x.id === `goblin-${this.step % 8}`);
        if (tok) return { id, kind: "map-token-move", mapId: "keep", grid: canonicalJson(map.grid), moves: [{ tokenId: tok.id, before: { column: tok.column, row: tok.row }, after: { column: tok.column, row: tok.row === 20 ? 21 : 20 } }], ignoreWalls: true };
      }
      return { id, kind: "message", to: "party", purseId: "party", text: `The torches gutter (${this.step})` };
    }
    const kind = this.step % 3;
    if (kind === 0) {
      const tok = map?.tokens.find((x) => x.id === `${this.purseId}-token`);
      if (tok) return { id, kind: "map-token-move", mapId: "keep", grid: canonicalJson(map.grid), moves: [{ tokenId: tok.id, before: { column: tok.column, row: tok.row }, after: { column: tok.column, row: tok.row === 2 ? 3 : 2 } }], ignoreWalls: false };
    }
    if (kind === 1) return { id, kind: "message", to: "party", purseId: this.purseId, text: `${this.purseId} says hello (${this.step})` };
    const other = PLAYERS.find((p) => p !== this.purseId);
    return { id, kind: "give", fromId: this.purseId, toId: other, copper: 1, holdingId: null, quantity: 0 };
  }
  async act(stage) {
    // cloud-client.ts queues a live action only after refresh() with conditional=false, a full pull.
    const pulled = await measure(stage, this.name, "pull-before-action", () => roomState({ tabletopProtocol: 10, code: this.seat.code, token: this.seat.token }).then((r) => tabletopResponse(r, 10)));
    if (pulled) { this.table = pulled.table; this.revision = pulled.revision; }
    const command = this.next(stage);
    const result = await measure(stage, this.name, `submit:${command.kind}`, () =>
      submitCommands({ tabletopProtocol: 10, code: this.seat.code, token: this.seat.token, batchId: `batch-${command.id}`, commands: [command] }),
    );
    if (result) {
      commits.set(result.revision, performance.now());
      this.revision = result.revision;
      this.table = tabletopResponse(result, 10).table;
      this.seen.set(result.revision, 0);
    }
  }
}
const commits = new Map();

// ---- Stages ----------------------------------------------------------------------------------
async function runStage(clients, label) {
  const stop = performance.now() + STAGE_MS;
  const loops = clients.map(async (c, i) => {
    await sleep(Math.round((i * POLL_MS) / clients.length)); // clients drift apart like real tabs
    let nextAct = performance.now() + (c.role === "dm" ? 6000 : 8000) * Math.random();
    while (performance.now() < stop) {
      await c.poll(label);
      if (performance.now() >= nextAct) {
        await c.act(label);
        nextAct = performance.now() + (c.role === "dm" ? 6000 : 8000);
      }
      await sleep(POLL_MS);
    }
  });
  const pings = clients.map(async (c, i) => {
    await sleep(Math.round((i * PING_MS) / clients.length));
    while (performance.now() < stop) {
      await measure(label, c.name, "map-signals", () => mapSignals({ code: c.seat.code, token: c.seat.token, mapId: "keep" }));
      await sleep(PING_MS);
    }
  });
  await Promise.all([...loops, ...pings]);
  // Burst: everyone acts in the same instant (a combat round, a shared reveal).
  await Promise.all(clients.map((c) => c.act(`${label}:burst`)));
  await Promise.all(clients.map((c) => c.poll(`${label}:burst`)));
}

mkdirSync(OUT, { recursive: true });
const startedAt = new Date().toISOString();
const dmSeat = await measure("setup", "dm", "openRoom", () => openRoom({ name: "Load audit DM", table: campaign() }));
if (!dmSeat) throw Error(samples.at(-1).error);
await measure("setup", "dm", "choosePace", () => choosePace({ code: dmSeat.code, token: dmSeat.token, live: true }));
const clients = [new Client("dm", { ...dmSeat, seatId: dmSeat.seatId }, "dm", null)];
const stageSummaries = [];
for (let n = 1; n <= 6; n++) {
  if (n > 1) {
    const purseId = PLAYERS[n - 2];
    const seat = await measure(`stage-${n}`, `p${n - 1}`, "joinRoom", () => joinRoom({ code: dmSeat.code, purseId, name: purseId }));
    if (seat) clients.push(new Client(`p${n - 1}`, { ...seat, code: dmSeat.code }, "player", purseId));
  }
  const label = `stage-${n}`;
  const roomBytesBefore = Buffer.byteLength(sql.prepare("SELECT body FROM campaign_rooms WHERE code=?").get(dmSeat.code).body);
  const firstRev = Math.max(0, ...commits.keys());
  await runStage(clients, label);
  const stageRevs = new Set([...commits.keys()].filter((r) => r > firstRev));
  const stored = sql.prepare("SELECT body FROM campaign_rooms WHERE code=?").get(dmSeat.code).body;
  const roomBytes = Buffer.byteLength(stored);
  const parsed = JSON.parse(stored);
  const receiptBytes = ["commands", "commandHashes", "batches", "batchHashes"].reduce((n, k) => n + size(parsed[k] ?? null), 0);
  const receiptCount = (parsed.batches ?? []).length;
  const of = (filter) => samples.filter((s) => s.stage.startsWith(label) && filter(s));
  const polls = of((s) => s.op === "poll");
  const submits = of((s) => s.op.startsWith("submit"));
  const burst = samples.filter((s) => s.stage === `${label}:burst` && s.op.startsWith("submit"));
  const propagation = clients.flatMap((c) => [...c.seen.entries()].filter(([rev, v]) => v > 0 && stageRevs.has(rev)).map(([, v]) => v));
  stageSummaries.push({
    users: n,
    roomBytesBefore,
    roomBytesAfter: roomBytes,
    receiptBytes,
    receiptBatches: receiptCount,
    pullsBeforeAction: { count: of((s) => s.op === "pull-before-action").length, p50: pct(of((s) => s.op === "pull-before-action").map((s) => s.ms), 50), bytes: pct(of((s) => s.op === "pull-before-action").map((s) => s.responseBytes), 50) },
    polls: polls.length,
    pollsFull: polls.filter((s) => s.full).length,
    pollMs: { p50: pct(polls.map((s) => s.ms), 50), p95: pct(polls.map((s) => s.ms), 95), max: pct(polls.map((s) => s.ms), 100) },
    unchangedPollMs: pct(polls.filter((s) => !s.full).map((s) => s.ms), 50),
    fullPollMs: { p50: pct(polls.filter((s) => s.full).map((s) => s.ms), 50), p95: pct(polls.filter((s) => s.full).map((s) => s.ms), 95) },
    fullPollBytes: pct(polls.filter((s) => s.full).map((s) => s.responseBytes), 50),
    d1BytesReadPerUnchangedPoll: pct(polls.filter((s) => !s.full).map((s) => s.bytesRead), 50),
    d1BytesReadPerFullPoll: pct(polls.filter((s) => s.full).map((s) => s.bytesRead), 50),
    submits: submits.length,
    submitErrors: submits.filter((s) => !s.ok).map((s) => `${s.op}: ${s.error}`),
    submitMs: { p50: pct(submits.map((s) => s.ms), 50), p95: pct(submits.map((s) => s.ms), 95), max: pct(submits.map((s) => s.ms), 100) },
    submitQueries: pct(submits.map((s) => s.queries), 50),
    d1BytesWrittenPerSubmit: pct(submits.map((s) => s.bytesWritten), 50),
    conflictsRetried: submits.reduce((n, s) => n + s.conflicts, 0),
    burst: { submits: burst.length, failed: burst.filter((s) => !s.ok).map((s) => s.error), conflicts: burst.reduce((n, s) => n + s.conflicts, 0), maxMs: pct(burst.map((s) => s.ms), 100) },
    propagationMs: { p50: pct(propagation, 50), p95: pct(propagation, 95), max: pct(propagation, 100) },
    signals: { count: of((s) => s.op === "map-signals").length, p50: pct(of((s) => s.op === "map-signals").map((s) => s.ms), 50), p95: pct(of((s) => s.op === "map-signals").map((s) => s.ms), 95), d1BytesRead: pct(of((s) => s.op === "map-signals").map((s) => s.bytesRead), 50), queries: pct(of((s) => s.op === "map-signals").map((s) => s.queries), 50), errors: [...new Set(of((s) => s.op === "map-signals" && !s.ok).map((s) => s.error))] },
    requestsPerMinute: Math.round((of((s) => !s.stage.endsWith("burst")).length / (STAGE_MS / 60000)) * 10) / 10,
    d1QueriesPerMinute: Math.round(of((s) => !s.stage.endsWith("burst")).reduce((n, s) => n + s.queries, 0) / (STAGE_MS / 60000)),
    d1BytesReadPerMinute: Math.round(of(() => true).reduce((n, s) => n + s.bytesRead, 0) / (STAGE_MS / 60000)),
  });
  console.log(JSON.stringify(stageSummaries.at(-1)));
}
const otherErrors = samples.filter((s) => !s.ok && !s.op.startsWith("submit")).map((s) => `${s.stage} ${s.actor} ${s.op}: ${s.error}`);
const result = { kind: "lootsplit.live-load-audit.v1", authorization, startedAt, finishedAt: new Date().toISOString(), scenario: SCENARIO, stageSeconds: STAGE_MS / 1000, simulatedD1Ms: D1_MS, pollMs: POLL_MS, node: process.version, stages: stageSummaries, otherErrors };
writeFileSync(`${OUT}/${SCENARIO}-d1-${D1_MS}ms.json`, JSON.stringify(result, null, 2));
writeFileSync(`${OUT}/${SCENARIO}-d1-${D1_MS}ms-samples.json`, JSON.stringify(samples));
console.log(`Wrote ${OUT}/${SCENARIO}-d1-${D1_MS}ms.json (${samples.length} samples)`);
