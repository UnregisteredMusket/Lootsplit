import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client/http";
import { d1Database } from "./database.mjs";
import { incomingRequest, sendResponse, staticAssets, roomEntryLimit } from "./http.mjs";
import { validateActivation } from "./state.mjs";

const config = process.env;
const mode = config.STANDBY_MODE || "locked";
if (!["active", "locked"].includes(mode)) throw new Error("Invalid standby mode");
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
let worker, env;
if (mode === "active") {
  const origin = new URL(config.ACCOUNT_ORIGIN).origin;
  if (!origin.startsWith("https://") || origin === "https://lootsplit.oliverstorie2017.workers.dev") throw new Error("Set the HTTPS standby origin");
  if (!config.ACCOUNT_SECRET || config.ACCOUNT_SECRET.length < 32) throw new Error("Standby signing secret is missing");
  const url = new URL(config.TURSO_DATABASE_URL);
  if (!["https:", "libsql:"].includes(url.protocol) || !url.hostname.endsWith(".turso.io") || !config.TURSO_AUTH_TOKEN) throw new Error("A durable Turso database is required");
  const client = createClient({ url: url.href, authToken: config.TURSO_AUTH_TOKEN });
  await validateActivation(client, config, manifest);
  env = { DB: d1Database(client), ACCOUNT_ORIGIN: origin, ACCOUNT_SECRET: config.ACCOUNT_SECRET,
    ASSETS: staticAssets(fileURLToPath(new URL("../assets", import.meta.url))), ROOM_ENTRY_LIMIT: roomEntryLimit(),
  };
  worker = (await import("../worker/worker.js")).default;
  globalThis.__env__ = env;
}
const server = createServer({ requestTimeout: 60000, headersTimeout: 15000, maxHeaderSize: 16384 }, async (incoming, outgoing) => {
  try {
    if (incoming.url === "/healthz" && ["GET", "HEAD"].includes(incoming.method)) {
      await sendResponse(Response.json({ status: "ok", mode, commit: manifest.commit }, { headers: { "Cache-Control": "no-store" } }), outgoing);
      return;
    }
    if (mode !== "active") {
      await sendResponse(new Response("Lootsplit standby is locked. Use the main website until the host announces recovery.", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } }), outgoing);
      return;
    }
    const request = incomingRequest(incoming, env.ACCOUNT_ORIGIN, config.RENDER === "true");
    const pending = [];
    const response = await worker.fetch(request, env, { waitUntil: (promise) => pending.push(Promise.resolve(promise).catch(() => {})), passThroughOnException() {} });
    await sendResponse(response, outgoing);
    await Promise.allSettled(pending);
  } catch {
    // SQL errors, credentials, tokens, request bodies and URLs stay out of logs.
    console.error("Standby request failed");
    if (!outgoing.headersSent) { outgoing.statusCode = 503; outgoing.setHeader("Cache-Control", "no-store"); outgoing.end("Temporarily unavailable. Your saved data has not been discarded."); }
    else outgoing.destroy();
  }
});
server.listen(Number(config.PORT || 10000), "0.0.0.0", () => console.log(`Standby listening (${mode})`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
