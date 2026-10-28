// Live-campaign load audit, receipt growth check (owner request, 2026-10-28). Gives a disposable
// room the command receipts of a long-running campaign (the room keeps one per action forever),
// then tries a chat message, ends the session as the size error advises, and tries again.
// OWNER AUTHORIZATION REQUIRED (LOOTSPLIT_LOAD_AUDIT=owner-YYYY-MM-DD); never CI.
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
if (process.env.CI) throw Error("Never in CI.");
if (!/^owner-\d{4}-\d{2}-\d{2}$/.test(process.env.LOOTSPLIT_LOAD_AUDIT ?? "")) throw Error("Owner authorization required.");
const sql = new DatabaseSync(":memory:");
for (const f of readdirSync("cloudflare/migrations").filter((f) => f.endsWith(".sql")).sort()) sql.exec(readFileSync(`cloudflare/migrations/${f}`, "utf8"));
globalThis.__env__ = { DB: { prepare(q) { let v = []; return { bind(...a) { v = a; return this; }, async all() { return { results: sql.prepare(q).all(...v) }; }, async first() { return sql.prepare(q).get(...v) ?? null; }, async run() { return { meta: { changes: Number(sql.prepare(q).run(...v).changes) } }; } }; }, async batch(s) { sql.exec("BEGIN"); try { const r = []; for (const x of s) r.push(await x.run()); sql.exec("COMMIT"); return r; } catch (e) { sql.exec("ROLLBACK"); throw e; } } } };
const { openRoom, joinRoom, submitCommands, closeRoom, manageRoom, choosePace } = await import("../src/lib/quire/cloud.server.ts");
const { buildWayfarers } = await import("./product-screenshot-fixture.mjs");
const dm = await openRoom({ name: "Receipts DM", table: buildWayfarers() });
await choosePace({ ...dm, live: true });
const player = await joinRoom({ code: dm.code, purseId: "mira", name: "Mira" });
const say = async (who, n) => {
  try {
    await submitCommands({ code: dm.code, token: who.token, batchId: `b-${n}`, commands: [{ id: `m-${n}`, kind: "message", to: "party", purseId: who === dm ? "party" : "mira", text: `line ${n}` }] });
    return "ok";
  } catch (e) { return e.message.slice(0, 140); }
};
const bytes = () => Buffer.byteLength(sql.prepare("SELECT body FROM campaign_rooms").get().body);
const receipts = () => { const b = JSON.parse(sql.prepare("SELECT body FROM campaign_rooms").get().body); return { batches: b.batches?.length ?? 0, bytes: ["commands", "commandHashes", "batches", "batchHashes"].reduce((n, k) => n + JSON.stringify(b[k] ?? null).length, 0) }; };
console.log("fresh room", bytes(), "bytes", receipts(), "say:", await say(player, 0));
// Measure the real receipt cost per action with 50 real messages.
const before = receipts();
for (let i = 1; i <= 50; i++) await say(i % 2 ? player : dm, i);
const after = receipts();
const perAction = (after.bytes - before.bytes) / 50;
console.log("receipt bytes per chat message:", perAction.toFixed(0));
// Add the receipts of N earlier actions (shape copied from the real ones just written).
const body = JSON.parse(sql.prepare("SELECT body FROM campaign_rooms").get().body);
const seat = body.seats.find((s) => s.role === "player").id;
const hash = "a".repeat(64);
const N = Math.ceil((1_800_000 - bytes()) / perAction) + 200;
for (let i = 0; i < N; i++) {
  body.commands.push(`${seat}:old-${i}`);
  body.commandHashes[`${seat}:old-${i}`] = hash;
  body.batches.push(`${seat}:old-batch-${i}`);
  body.batchHashes[`${seat}:old-batch-${i}`] = hash;
}
sql.prepare("UPDATE campaign_rooms SET body=? WHERE code=?").run(JSON.stringify(body), dm.code);
console.log(`after ${N} earlier actions: room`, bytes(), "bytes", receipts());
console.log("player chat:", await say(player, 900));
let ended;
try { await closeRoom({ ...dm, keepOnline: true }); ended = "ok"; } catch (e) { ended = e.message.slice(0, 140); }
console.log("DM ends the session:", ended, "room", bytes(), "bytes, receipts", receipts());
try { await manageRoom({ ...dm, action: "start", seatId: dm.seatId }); } catch (e) { console.log("DM resumes:", e.message.slice(0, 140)); }
console.log("player chat after ending the session:", await say(player, 901));
