import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { createClient } from "@libsql/client";
import { readFileSync, readdirSync } from "node:fs";
import { d1Database } from "../standby/database.mjs";
import { staticAssets, roomEntryLimit, incomingRequest, sendResponse } from "../standby/http.mjs";

// Neither this process nor its browser checks ever contact a production database.
const locked = spawn(process.execPath, ["dist/standby-release/runtime/server.mjs"], { env: { ...process.env, PORT: "8093", STANDBY_MODE: "locked" }, stdio: ["ignore", "pipe", "inherit"] });
try {
  await Promise.race([once(locked.stdout, "data"), once(locked, "exit").then(() => { throw new Error("Locked server exited"); })]);
  assert.equal((await fetch("http://127.0.0.1:8093/")).status, 503);
  assert.equal((await (await fetch("http://127.0.0.1:8093/healthz")).json()).mode, "locked");
} finally { locked.kill("SIGTERM"); }

const client = createClient({ url: ":memory:" });
await client.executeMultiple(readdirSync("cloudflare/migrations").sort().map((name) => readFileSync(`cloudflare/migrations/${name}`, "utf8")).join("\n"));
const env = { DB: d1Database(client), ACCOUNT_SECRET: "disposable-standby-browser-audit-secret-1234567890", ACCOUNT_ORIGIN: "http://127.0.0.1:8094", ASSETS: staticAssets("dist/standby-release/assets"), ROOM_ENTRY_LIMIT: roomEntryLimit() };
const worker = (await import("../dist/standby-release/worker/worker.js")).default;
globalThis.__env__ = env;
const server = createServer(async (incoming, outgoing) => {
  try {
    // This loopback-only synthetic server emulates the trusted reverse proxy.
    // incomingRequest correctly discards a caller's CF header in production;
    // without this proxy hop all test devices share localhost's auth quota.
    incoming.headers["x-forwarded-for"] = incoming.headers["cf-connecting-ip"] || incoming.socket.remoteAddress;
    await sendResponse(await worker.fetch(incomingRequest(incoming, env.ACCOUNT_ORIGIN, true), env, { waitUntil: (promise) => promise.catch(() => {}), passThroughOnException() {} }), outgoing);
  } catch (error) { console.error(error); outgoing.statusCode = 500; outgoing.end("Synthetic audit failed"); }
});
server.listen(8094, "127.0.0.1"); await once(server, "listening");
try {
  assert.equal((await fetch(env.ACCOUNT_ORIGIN + "/welcome")).status, 200);
  const { stdout } = await promisify(execFile)(process.execPath, ["scripts/account-browser-audit.mjs"], { env: { ...process.env, ACCOUNT_AUDIT_ORIGIN: env.ACCOUNT_ORIGIN }, timeout: 180000, maxBuffer: 1024 * 1024 });
  console.log(stdout);
  console.log("Standby artifact: locked transport, SSR, desktop/mobile account recovery and library checks passed");
} finally { await new Promise((resolve) => server.close(resolve)); client.close(); }
