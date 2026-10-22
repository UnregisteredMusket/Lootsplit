// Accessibility audit (axe-core) of public and signed-in DM screens at desktop and phone widths.
// Report-only by default: it writes test-results/a11y/result.json and a GitHub step summary and
// exits 0. Set A11Y_FAIL_IMPACT=critical (or serious, moderate, minor) to fail on violations at or
// above that impact once the existing findings are triaged. Runs only against a disposable local
// server, because the DM screens use a disposable signed-up fixture account.
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { openApplication } from "./title-screen-navigation.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("The accessibility audit signs up a disposable DM; run it only against a local server.");
const output = "test-results/a11y";
const IMPACTS = ["minor", "moderate", "serious", "critical"];
const failAt = process.env.A11Y_FAIL_IMPACT ? IMPACTS.indexOf(process.env.A11Y_FAIL_IMPACT) : -1;
if (process.env.A11Y_FAIL_IMPACT && failAt < 0)
  throw Error(`A11Y_FAIL_IMPACT must be one of ${IMPACTS.join(", ")}.`);

// Public pages first (no account), then the main DM destinations.
const PUBLIC = ["/welcome", "/features", "/downloads", "/updates", "/help", "/resources"];
const DM = ["/", "/party", "/market", "/characters", "/encounters", "/maps", "/library", "/settings"];
const WIDTHS = [1280, 390];

await mkdir(output, { recursive: true });
const started = Date.now();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const pages = [];
try {
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    for (const path of [...PUBLIC, ...DM]) {
      const entry = { path, width, violations: [], error: null };
      try {
        await openApplication(page, origin + path, { waitUntil: "networkidle" });
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        entry.violations = result.violations.map((v) => ({
          id: v.id,
          impact: v.impact ?? "minor",
          help: v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes.length,
          targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
        }));
      } catch (error) {
        entry.error = error instanceof Error ? error.message.split("\n")[0] : String(error);
      }
      pages.push(entry);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const rules = new Map();
for (const entry of pages)
  for (const v of entry.violations) {
    const rule = rules.get(v.id) ?? { ...v, pages: [], nodes: 0 };
    rule.pages.push(`${entry.path}@${entry.width}`);
    rule.nodes += v.nodes;
    rules.set(v.id, rule);
  }
const sorted = [...rules.values()].sort(
  (a, b) => IMPACTS.indexOf(b.impact) - IMPACTS.indexOf(a.impact) || b.nodes - a.nodes,
);
const counts = Object.fromEntries(IMPACTS.map((impact) => [impact, sorted.filter((r) => r.impact === impact).length]));
const errors = pages.filter((p) => p.error);
const report = {
  startedAt: new Date(started).toISOString(),
  durationMs: Date.now() - started,
  pagesChecked: pages.length,
  pageErrors: errors.map(({ path, width, error }) => ({ path, width, error })),
  ruleCounts: counts,
  rules: sorted,
  pages,
};
await writeFile(`${output}/result.json`, JSON.stringify(report, null, 2));

const lines = [
  "## Accessibility audit (axe-core, WCAG 2.1 A/AA)",
  "",
  `${pages.length} page views checked (${WIDTHS.join(" and ")} px). Rules violated by impact: ` +
    IMPACTS.slice().reverse().map((i) => `${i} ${counts[i]}`).join(", ") + ".",
  "",
];
if (sorted.length) {
  lines.push("| Impact | Rule | Elements | Where |", "| --- | --- | --- | --- |");
  for (const r of sorted.slice(0, 40))
    lines.push(
      `| ${r.impact} | [${r.id}](${r.helpUrl}): ${r.help.replace(/\|/g, "/")} | ${r.nodes} | ${r.pages.slice(0, 6).join(", ")}${r.pages.length > 6 ? ", …" : ""} |`,
    );
  if (sorted.length > 40) lines.push("", `${sorted.length - 40} more rules in result.json.`);
}
if (errors.length) lines.push("", `Pages that could not be checked: ${errors.map((e) => `${e.path}@${e.width}`).join(", ")}.`);
const summary = lines.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);

const blocking = failAt < 0 ? [] : sorted.filter((r) => IMPACTS.indexOf(r.impact) >= failAt);
if (blocking.length) {
  console.error(`${blocking.length} rule(s) at or above "${IMPACTS[failAt]}" impact.`);
  process.exit(1);
}
