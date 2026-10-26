// Accessibility audit (axe-core, WCAG 2.1 A/AA) of public pages and DM screens at desktop and phone
// widths, then of the key DM and player screens in a seeded device campaign (the synthetic
// "Wayfarers" fixture built by the real command engine) in both approved themes: Desk, Party and
// Fairness, Market, a shop, a character sheet, NPCs, Review Inbox and the chat of a shared room.
// It writes test-results/a11y/result.json and a GitHub step summary. Set A11Y_FAIL_IMPACT=serious
// (CI does) to fail on violations at or above that impact, and on screens that could not be checked.
// Findings owned by another plan item go in ALLOWED below, each with a reason and plan ID; keep that
// list narrow (rule + element) and remove entries when their plan item ships.
// Runs only against a disposable local server, because the DM screens use a disposable fixture.
// Run with: node --experimental-strip-types scripts/a11y-browser-audit.mjs
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { openApplication } from "./title-screen-navigation.mjs";
import { buildWayfarers } from "./product-screenshot-fixture.mjs";
import { createRoom } from "./browser/account-fixtures.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("The accessibility audit signs up a disposable DM; run it only against a local server.");
const output = "test-results/a11y";
const IMPACTS = ["minor", "moderate", "serious", "critical"];
const failAt = process.env.A11Y_FAIL_IMPACT ? IMPACTS.indexOf(process.env.A11Y_FAIL_IMPACT) : -1;
if (process.env.A11Y_FAIL_IMPACT && failAt < 0)
  throw Error(`A11Y_FAIL_IMPACT must be one of ${IMPACTS.join(", ")}.`);

// Public pages first (no account), then the main DM destinations of a fresh campaign.
const PUBLIC = ["/welcome", "/features", "/downloads", "/updates", "/help", "/resources"];
const DM = ["/", "/party", "/market", "/characters", "/encounters", "/maps", "/library", "/settings"];
const WIDTHS = [1280, 390];
// Seeded screens, as the DM and as Mira's player seat, in each approved theme. Each names something
// visible it must show, so an empty or broken screen cannot pass. The Brass Lantern is at the
// party's location and on Mira's seat, so she can trade there (the "Sell to this shop" picker).
const SHOP = "/shop/lantern";
const SHEET = "/characters?id=party%3Amira";
const SEEDED = {
  dm: [
    ["/?view=home", "text=Party at a glance"],
    ["/party", "text=Funds & inventory"],
    ["/party?section=fairness", "text=What counts?"],
    // The global board is folded on Market; its link opens it, so both are checked.
    ["/market#global-market", "text=Golden grain"],
    [SHOP, "text=The Brass Lantern"],
    [SHEET, "[role=tab]"],
    ["/features/npcs", "text=Find an NPC"],
    ["/features/review", "#review-inbox-heading"],
  ],
  player: [
    ["/?view=home", "text=Open character sheet"],
    ["/party", "text=Inventory & purse"],
    ["/party?section=fairness", "text=Party average"],
    // The global board is folded on Market; its link opens it, so both are checked.
    ["/market#global-market", "text=Golden grain"],
    [SHOP, "[aria-label='Item to sell']"],
    [SHEET, "[role=tab]"],
    ["/features/npcs", "text=Find an NPC"],
  ],
};
// Chat needs a shared room: in each view a fresh DM device opens one from the seeded campaign.
const ROOM_CHAT = ["/share?tab=chat", ".chat-history"];
const SEEDED_VIEWS = [
  { width: 1280, appearance: "dark", accent: "#d4ac67", ground: "#26221e" },
  { width: 390, appearance: "light", accent: "#7c3224", ground: "#dfcca2" },
];
// Known findings owned by other plan items. Each entry matches one rule on elements whose axe
// selector contains `target`; anything else at a blocking impact fails the audit.
// Example: { rule: "color-contrast", target: ".some-badge", plan: "D4", reason: "…" }.
const ALLOWED = [];
const allowedFor = (rule, target) =>
  ALLOWED.find((entry) => entry.rule === rule && target.includes(entry.target));

await mkdir(output, { recursive: true });
const started = Date.now();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const pages = [];
const message = (error) => (error instanceof Error ? error.message.split("\n")[0] : String(error));

async function check(page, entry) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  entry.violations = result.violations.map((v) => {
    const targets = v.nodes.map((n) => n.target.join(" "));
    const blocked = targets.filter((t) => !allowedFor(v.id, t));
    return {
      id: v.id,
      impact: v.impact ?? "minor",
      help: v.help,
      helpUrl: v.helpUrl,
      nodes: v.nodes.length,
      allowed: blocked.length === 0,
      targets: (blocked.length ? blocked : targets).slice(0, 8),
    };
  });
}

/** A browser context's single tab. A renderer that crashes (seen on overloaded machines) is
 * replaced, so a crash costs at most one page view instead of the rest of the run. */
function tabIn(context) {
  const tab = { page: null, crashed: true };
  return async () => {
    if (!tab.crashed) return tab.page;
    await tab.page?.close().catch(() => {});
    tab.page = await context.newPage();
    tab.page.setDefaultTimeout(30000);
    tab.crashed = false;
    tab.page.on("crash", () => (tab.crashed = true));
    return tab.page;
  };
}

/** Checks one screen in the tab `ready()` returns. A renderer crash (an overloaded machine, not a
 * finding) is retried once in a fresh tab; any other failure is reported as unchecked. */
async function visit(ready, path, entry, marker = "") {
  for (let attempt = 1; ; attempt++) {
    const page = await ready();
    try {
      await openApplication(page, origin + path, { waitUntil: "networkidle" });
      if (marker) await page.locator(`${marker} >> visible=true`).first().waitFor({ timeout: 20000 });
      await check(page, entry);
      entry.error = null;
    } catch (error) {
      entry.error = message(error);
      if (attempt === 1 && /crash/i.test(entry.error)) continue;
    }
    break;
  }
  pages.push(entry);
}

/** A context in the view's theme holding the seeded Wayfarers campaign as the DM. */
async function seededView(view, table) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: 844 },
    reducedMotion: "reduce",
    isMobile: view.width < 600,
    hasTouch: view.width < 600,
    serviceWorkers: "block",
    // Its own documentation-range address, so room creation is not rate limited across views.
    extraHTTPHeaders: { "cf-connecting-ip": `2001:db8:${crypto.randomUUID().slice(0, 4)}::1` },
  });
  await context.addInitScript((look) => {
    try {
      if (!localStorage.getItem("a11y-audit-look")) {
        const prefs = JSON.parse(localStorage.getItem("quire.prefs.v1") || "{}");
        localStorage.setItem("quire.prefs.v1", JSON.stringify({ ...prefs, ...look }));
        localStorage.setItem("a11y-audit-look", "1");
      }
      localStorage.setItem("quire.guide.offer.v3", "seen");
    } catch {
      // Storage blocked: the audit then checks the default theme.
    }
  }, { appearance: view.appearance, accent: view.accent, ground: view.ground });
  const ready = tabIn(context);
  const page = await ready();
  await openApplication(page, origin + "/", { waitUntil: "networkidle" });
  await page.evaluate(async (t) => {
    const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
    await applyCloudTable(t);
  }, table);
  return { context, ready };
}

try {
  // A11Y_SCOPE=seeded skips the unseeded pages (a quicker local loop).
  for (const width of process.env.A11Y_SCOPE === "seeded" ? [] : WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
    const ready = tabIn(context);
    for (const path of [...PUBLIC, ...DM]) await visit(ready, path, { path, width, violations: [], error: null });
    await context.close();
  }
  const table = buildWayfarers();
  for (const view of SEEDED_VIEWS) {
    const label = `${view.width}-${view.appearance}`;
    // Device campaign: the DM's screens, then Mira's player seat on the same device.
    let device;
    try {
      device = await seededView(view, table);
      for (const seat of ["dm", "player"]) {
        if (seat === "player") {
          const page = await device.ready();
          // A replaced (crashed) tab starts blank; the seat module loads from the app.
          if (!page.url().startsWith(origin)) await openApplication(page, origin + "/", { waitUntil: "networkidle" });
          await page.evaluate(async () => {
            const { setSeat } = await import("/src/lib/quire/table.ts");
            setSeat({ role: "player", purseIds: ["mira"], shopIds: ["lantern"], openedAt: Date.now() });
          });
        }
        for (const [path, marker] of SEEDED[seat])
          await visit(device.ready, path, { path: `${seat} ${path}`, width: label, violations: [], error: null }, marker);
      }
    } catch (error) {
      pages.push({ path: "(seeded device)", width: label, violations: [], error: message(error) });
    } finally {
      await device?.context.close();
    }
    // Chat: a fresh DM device opens a shared room from the same campaign.
    const [chatPath, chatMarker] = ROOM_CHAT;
    let host;
    try {
      host = await seededView(view, table);
      await createRoom(await host.ready(), origin, (p, o, path) => openApplication(p, o + path, { waitUntil: "networkidle" }));
      await visit(host.ready, chatPath, { path: `dm room ${chatPath}`, width: label, violations: [], error: null }, chatMarker);
    } catch (error) {
      pages.push({ path: `dm room ${chatPath}`, width: label, violations: [], error: `Room: ${message(error)}` });
    } finally {
      await host?.context.close();
    }
  }
} finally {
  await browser.close();
}

const rules = new Map();
for (const entry of pages)
  for (const v of entry.violations) {
    const key = `${v.id}${v.allowed ? " (allowed)" : ""}`;
    const rule = rules.get(key) ?? { ...v, targets: [], pages: [], nodes: 0 };
    rule.pages.push(`${entry.path}@${entry.width}`);
    rule.nodes += v.nodes;
    for (const t of v.targets) if (rule.targets.length < 8 && !rule.targets.includes(t)) rule.targets.push(t);
    rules.set(key, rule);
  }
const sorted = [...rules.values()].sort(
  (a, b) => IMPACTS.indexOf(b.impact) - IMPACTS.indexOf(a.impact) || b.nodes - a.nodes,
);
const counts = Object.fromEntries(
  IMPACTS.map((impact) => [impact, sorted.filter((r) => r.impact === impact && !r.allowed).length]),
);
const errors = pages.filter((p) => p.error);
const report = {
  startedAt: new Date(started).toISOString(),
  durationMs: Date.now() - started,
  pagesChecked: pages.length,
  pageErrors: errors.map(({ path, width, error }) => ({ path, width, error })),
  ruleCounts: counts,
  allowed: ALLOWED,
  rules: sorted,
  pages,
};
await writeFile(`${output}/result.json`, JSON.stringify(report, null, 2));

const lines = [
  "## Accessibility audit (axe-core, WCAG 2.1 A/AA)",
  "",
  `${pages.length} page views checked (${WIDTHS.join(" and ")} px, plus seeded DM and player screens at ` +
    `${SEEDED_VIEWS.map((v) => `${v.width} px ${v.appearance}`).join(" and ")}). Rules violated by impact ` +
    `(allowed findings excluded): ` +
    IMPACTS.slice().reverse().map((i) => `${i} ${counts[i]}`).join(", ") + ".",
  "",
];
if (sorted.length) {
  lines.push("| Impact | Rule | Elements | Where | Selectors |", "| --- | --- | --- | --- | --- |");
  for (const r of sorted.slice(0, 40))
    lines.push(
      `| ${r.impact}${r.allowed ? " (allowed)" : ""} | [${r.id}](${r.helpUrl}): ${r.help.replace(/\|/g, "/")} | ${r.nodes} | ${r.pages.slice(0, 6).join(", ")}${r.pages.length > 6 ? ", …" : ""} | ${r.targets.slice(0, 3).map((t) => `\`${t.replace(/\|/g, "/")}\``).join(", ")} |`,
    );
  if (sorted.length > 40) lines.push("", `${sorted.length - 40} more rules in result.json.`);
}
if (errors.length) lines.push("", `Pages that could not be checked: ${errors.map((e) => `${e.path}@${e.width}`).join(", ")}.`);
const summary = lines.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);

const blocking = failAt < 0 ? [] : sorted.filter((r) => !r.allowed && IMPACTS.indexOf(r.impact) >= failAt);
if (blocking.length) {
  for (const r of blocking)
    console.error(`${r.impact} ${r.id}: ${r.targets.slice(0, 3).join(" | ")} on ${r.pages.slice(0, 4).join(", ")}`);
  console.error(`${blocking.length} rule(s) at or above "${IMPACTS[failAt]}" impact.`);
}
if (failAt >= 0 && errors.length) console.error(`${errors.length} page view(s) could not be checked.`);
if (blocking.length || (failAt >= 0 && errors.length)) process.exit(1);
