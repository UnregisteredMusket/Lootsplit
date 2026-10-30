// Manual Open5e latency check (workflow_dispatch only: .github/workflows/open5e-latency.yml).
// Times the exact Catalog reference requests Lootsplitter sends (every section, both editions)
// and the encounter creature index page, each with the reduced field set and, for comparison,
// without it. Read-only GETs of public SRD data; nothing about users or campaigns is sent.
// It never fails on slow answers: it reports them. Usage:
//   node --experimental-strip-types scripts/open5e-latency.mjs [search text]
import { appendFileSync } from "node:fs";
import { OPEN5E_KINDS, openUrl } from "../src/lib/quire/open5e.ts";
import { creatureIndexUrl } from "../src/lib/encounters/index.mjs";

const query = process.argv[2] ?? "Fire";
const TIMEOUT_MS = 30000;

/** @param {string} url */
function withoutFields(url) {
  const u = new URL(url);
  for (const key of [...u.searchParams.keys()])
    if (key.endsWith("fields")) u.searchParams.delete(key);
  return u.toString();
}

/** @param {string} url */
async function time(url) {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json", "User-Agent": "Lootsplitter latency check" },
    });
    const text = await response.text();
    let count = "";
    try {
      const data = JSON.parse(text);
      count = Array.isArray(data.results) ? `${data.results.length}/${data.count}` : "not a page";
    } catch {
      count = "not JSON";
    }
    return {
      ms: Math.round(performance.now() - started),
      status: String(response.status),
      bytes: text.length,
      count,
    };
  } catch (error) {
    return {
      ms: Math.round(performance.now() - started),
      status: error instanceof Error ? error.name : "error",
      bytes: 0,
      count: "",
    };
  }
}

const rows = [];
const cases = [];
for (const { value: kind } of OPEN5E_KINDS)
  for (const edition of /** @type {const} */ (["srd-2014", "srd-2024"]))
    cases.push({ label: `${kind} ${edition}`, url: openUrl({ kind, edition, query, page: 1 }) });
cases.push({ label: "encounter creature index p1", url: creatureIndexUrl(1) });
for (const c of cases) {
  // Sequential on purpose: one request at a time, so the check never loads Open5e.
  const lean = await time(c.url);
  const full = await time(withoutFields(c.url));
  rows.push(
    `| ${c.label} | ${lean.ms} ms (${lean.status}, ${lean.bytes} B, ${lean.count}) | ${full.ms} ms (${full.status}, ${full.bytes} B, ${full.count}) |`,
  );
}
const report = [
  `## Open5e latency (search "${query}", ${new Date().toISOString()})`,
  "",
  "| Request | With fields | Without fields |",
  "| --- | --- | --- |",
  ...rows,
  "",
  `Timeout per request: ${TIMEOUT_MS} ms. Lootsplitter allows 12 s per attempt, one retry, 25 s overall.`,
  "",
].join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
