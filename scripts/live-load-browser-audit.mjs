// Live-campaign browser stages (owner request, 2026-10-28): a real DM browser, then one real player
// browser at a time up to six people, all in one live shared room on a disposable development
// server. Measures how fast each change reaches every other browser, request rates and bytes per
// browser, long main-thread tasks, JS heap and any page or console errors. Pairs with
// scripts/live-load-audit.mjs (server cost); this one is the client side.
//
// OWNER AUTHORIZATION REQUIRED. Not part of CI, npm test, any workflow or schedule; it refuses to
// start without LOOTSPLIT_LOAD_AUDIT=owner-YYYY-MM-DD and refuses CI and non-local origins.
//
//   LOOTSPLIT_LOAD_AUDIT=owner-YYYY-MM-DD AUDIT_ORIGIN=http://127.0.0.1:8080 \
//     node --experimental-strip-types scripts/live-load-browser-audit.mjs
//   Options (env): LOAD_STAGE_SECONDS (default 60), LOAD_OUT.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { openApplication, navigateApplication } from "./title-screen-navigation.mjs";
import { chooseOption } from "./search-select-browser.mjs";

if (process.env.CI) throw Error("The live-campaign load audit never runs in CI.");
const authorization = process.env.LOOTSPLIT_LOAD_AUDIT ?? "";
if (!/^owner-\d{4}-\d{2}-\d{2}$/.test(authorization))
  throw Error("Owner authorization required: set LOOTSPLIT_LOAD_AUDIT=owner-YYYY-MM-DD (see docs/audit).");
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw Error("Browser stages require a disposable local server.");
const STAGE_MS = Number(process.env.LOAD_STAGE_SECONDS ?? 60) * 1000;
const OUT = process.env.LOAD_OUT ?? "test-results/live-load-audit";
mkdirSync(OUT, { recursive: true });

const { buildWayfarers } = await import("./product-screenshot-fixture.mjs");
const PLAYERS = ["mira", "bram", "rowan", "tamsin", "quill"];
const table = buildWayfarers();
table.purses.push({ id: "quill", name: "Quill Marsh", kind: "character", coins: { cp: 0, sp: 40, ep: 0, gp: 55, pp: 0 } });
const tokens = [
  ...PLAYERS.map((id, i) => ({ id: `${id}-token`, kind: "character", entityId: id, label: id, column: 2 + i * 3, row: 2, visibility: "party" })),
  ...Array.from({ length: 8 }, (_, i) => ({ id: `goblin-${i}`, kind: "other", label: `Goblin ${i + 1}`, column: 10 + i, row: 20, visibility: "party" })),
];
table.journal = {
  ...table.journal,
  world: { ...table.journal?.world, maps: [{ id: "keep", name: "Ashen Keep", image: "data:image/png;base64,cHJpdmF0ZS1zb3VyY2U=", locationId: null, visible: true, anchors: [], markers: [], grid: { columns: 40, rows: 30 }, tokens, tabletop: { playerMovement: true } }] },
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ["--no-sandbox"] });
const ip = () => `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;
const errors = [];
const clients = [];
async function device(label, width) {
  const context = await browser.newContext({ viewport: { width, height: width < 400 ? 800 : 900 }, serviceWorkers: "block", extraHTTPHeaders: { "cf-connecting-ip": ip() } });
  await context.route((url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol), (route) => route.abort());
  await context.addInitScript(() => {
    localStorage.setItem("quire.guide.offer.v3", "seen");
    window.__longTasks = [];
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__longTasks.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: true });
    } catch {
      // Long-task timing is optional; browsers without it still run the stage.
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const traffic = { requests: 0, serverFn: 0, bytes: 0, byPath: {} };
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  const urls = new Map();
  cdp.on("Network.requestWillBeSent", (e) => urls.set(e.requestId, e.request.url));
  cdp.on("Network.loadingFinished", (e) => {
    const url = urls.get(e.requestId) ?? "";
    if (!url.startsWith(origin)) return;
    const path = new URL(url).pathname;
    if (/\.(js|css|ts|tsx|mjs|png|webp|svg|woff2?)$/.test(path) || path.startsWith("/@") || path.startsWith("/node_modules")) return; // dev-server module loads
    const key = path.startsWith("/_serverFn") ? "serverFn" : path.replace(/[0-9a-f-]{20,}/g, ":id");
    traffic.requests++;
    traffic.bytes += e.encodedDataLength;
    traffic.byPath[key] = traffic.byPath[key] ?? { n: 0, bytes: 0 };
    traffic.byPath[key].n++;
    traffic.byPath[key].bytes += e.encodedDataLength;
  });
  page.on("pageerror", (e) => errors.push(`${label}: pageerror ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR_ABORTED/.test(m.text())) errors.push(`${label}: console ${m.text().slice(0, 200)}`); });
  return { label, context, page, traffic };
}
const revision = (page) => page.evaluate(async () => (await import("/src/lib/quire/cloud-client.ts")).getCloudTable().revision ?? 0);
async function act(client, step) {
  return client.page.evaluate(async ({ purseId, step, dm }) => {
    const c = await import("/src/lib/quire/cloud-client.ts");
    const t = await (await import("/src/lib/quire/economy.ts")).economySnapshot();
    const map = t.journal.world.maps.find((m) => m.id === "keep");
    const { canonicalJson } = await import("/src/lib/quire/canonical-json.ts");
    const kind = step % 3;
    const at = performance.now();
    if (kind === 0) {
      await c.sendRoomMessage({ id: crypto.randomUUID(), kind: "message", to: "party", purseId: dm ? "party" : purseId, text: `${dm ? "DM" : purseId} line ${step}` });
    } else if (kind === 1) {
      const tok = map.tokens.find((x) => x.id === (dm ? `goblin-${step % 8}` : `${purseId}-token`));
      await c.queueCommand({ kind: "map-token-move", mapId: "keep", grid: canonicalJson(map.grid), moves: [{ tokenId: tok.id, before: { column: tok.column, row: tok.row }, after: { column: tok.column, row: tok.row === 2 || tok.row === 20 ? tok.row + 1 : tok.row - 1 } }], ignoreWalls: dm });
    } else {
      await c.queueCommand({ kind: "give", fromId: dm ? "party" : purseId, toId: dm ? purseId || "mira" : "mira" === purseId ? "bram" : "mira", copper: 1, holdingId: null, quantity: 0 });
    }
    return { ms: performance.now() - at, revision: c.getCloudTable().revision };
  }, { purseId: client.purseId, step, dm: client.role === "dm" });
}

const stages = [];
const startedAt = new Date().toISOString();
try {
  // DM: signed-in fixture account, the Wayfarers campaign plus a tabletop map, live mode.
  const dm = await device("dm", 1280);
  dm.role = "dm";
  dm.purseId = "";
  await openApplication(dm.page, origin + "/party");
  await dm.page.evaluate(async (t) => {
    const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
    const { readJournal } = await import("/src/lib/quire/journal.ts");
    await applyCloudTable({ ...t, journal: readJournal(t.journal) });
    const c = await import("/src/lib/quire/cloud-client.ts");
    await c.chooseTableMode("live");
  }, table);
  const room = await dm.page.evaluate(async () => {
    const v = (await import("/src/lib/quire/cloud-client.ts")).getCloudTable();
    return { code: v.code, sessionId: v.sessionId };
  });
  await navigateApplication(dm.page, origin + "/maps");
  clients.push(dm);

  for (let n = 1; n <= 6; n++) {
    if (n > 1) {
      const purseId = PLAYERS[n - 2];
      const p = await device(`p${n - 1}`, n % 2 ? 1280 : 390);
      p.role = "player";
      p.purseId = purseId;
      const joinStart = performance.now();
      await openApplication(p.page, `${origin}/share?join=${room.code}&session=${room.sessionId}`);
      await chooseOption(p.page.getByRole("combobox", { name: "Choose your character", exact: true }), purseId);
      await p.page.getByLabel("Your name", { exact: true }).fill(`Load ${purseId}`);
      await p.page.getByRole("button", { name: "Join room", exact: true }).click();
      await p.page.getByText("You joined as a player", { exact: true }).waitFor({ state: "attached" });
      p.joinMs = Math.round(performance.now() - joinStart);
      await navigateApplication(p.page, origin + "/maps");
      clients.push(p);
    }
    for (const c of clients) {
      c.traffic.requests = 0; c.traffic.serverFn = 0; c.traffic.bytes = 0; c.traffic.byPath = {};
      await c.page.evaluate(() => { window.__longTasks = []; });
    }
    const errorsBefore = errors.length;
    const propagation = [], actions = [], actionErrors = [];
    const stop = performance.now() + STAGE_MS;
    let step = 0;
    while (performance.now() < stop) {
      // One change at a time from a rotating actor; then time until every other browser has it.
      const actor = clients[step % clients.length];
      let done;
      try {
        done = await act(actor, step);
        actions.push(Math.round(done.ms));
      } catch (error) {
        actionErrors.push(`${actor.label}: ${String(error.message).split("\n")[0].slice(0, 160)}`);
      }
      if (done) {
        const sent = performance.now();
        await Promise.all(clients.filter((c) => c !== actor).map(async (c) => {
          while (performance.now() - sent < 15000) {
            if ((await revision(c.page)) >= done.revision) return propagation.push(Math.round(performance.now() - sent));
            await new Promise((r) => setTimeout(r, 100));
          }
          propagation.push(15000);
        }));
      }
      step++;
      await new Promise((r) => setTimeout(r, Math.max(0, 6000 / clients.length)));
    }
    // Burst: every browser acts in the same instant (end of a combat round, a shared reveal).
    const burst = await Promise.all(clients.map((c, i) => act(c, 1000 + n * 10 + i).then((r) => ({ ok: true, ms: Math.round(r.ms) }), (e) => ({ ok: false, error: `${c.label}: ${String(e.message).split("\n")[0].slice(0, 160)}` }))));
    const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : null);
    const perClient = [];
    for (const c of clients) {
      const { longTasks, heap } = await c.page.evaluate(() => ({ longTasks: window.__longTasks, heap: performance.memory?.usedJSHeapSize ?? null }));
      perClient.push({
        client: c.label,
        joinMs: c.joinMs ?? null,
        requestsPerMinute: Math.round((c.traffic.requests / (STAGE_MS / 60000)) * 10) / 10,
        kbPerMinute: Math.round(c.traffic.bytes / 1024 / (STAGE_MS / 60000)),
        byPath: c.traffic.byPath,
        longTasks: longTasks.length,
        longTaskMsTotal: longTasks.reduce((a, b) => a + b, 0),
        longestTaskMs: longTasks.length ? Math.max(...longTasks) : 0,
        heapMB: heap ? Math.round(heap / 1048576) : null,
      });
    }
    stages.push({
      users: n,
      actions: actions.length,
      actionMs: { p50: pct(actions, 50), p95: pct(actions, 95), max: pct(actions, 100) },
      actionErrors,
      burst: { failed: burst.filter((b) => !b.ok).map((b) => b.error), maxMs: Math.max(0, ...burst.filter((b) => b.ok).map((b) => b.ms)) },
      propagationMs: { p50: pct(propagation, 50), p95: pct(propagation, 95), max: pct(propagation, 100), timeouts: propagation.filter((x) => x >= 15000).length },
      pageErrors: errors.slice(errorsBefore),
      perClient,
    });
    console.log(JSON.stringify({ users: n, actions: actions.length, actionMs: stages.at(-1).actionMs, propagationMs: stages.at(-1).propagationMs, actionErrors: actionErrors.slice(0, 3), burst: stages.at(-1).burst, pageErrors: errors.slice(errorsBefore).slice(0, 3) }));
  }
} finally {
  writeFileSync(`${OUT}/browser.json`, JSON.stringify({ kind: "lootsplit.live-load-browser-audit.v1", authorization, startedAt, finishedAt: new Date().toISOString(), origin, stageSeconds: STAGE_MS / 1000, stages, errors }, null, 2));
  await browser.close();
}
