import {
  readdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
const directory = "test-results/recovery";
const steps = existsSync(directory)
  ? readdirSync(directory)
      .filter((p) => p.endsWith(".json"))
      .map((p) => JSON.parse(readFileSync(join(directory, p), "utf8")))
      .map((r) => ({
        id: r.id,
        status: r.status,
        seconds: r.finishedAt
          ? Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 100) / 10
          : null,
      }))
      .sort((a, b) => (b.seconds ?? 0) - (a.seconds ?? 0))
  : [];
let markdown =
  "## Verification timings\n\nTimes below describe this job's measured stages, not total task or release time.\n\n| Stage | Result | Seconds |\n| --- | --- | ---: |\n";
for (const r of steps) markdown += `| ${r.id} | ${r.status} | ${r.seconds ?? "incomplete"} |\n`;
mkdirSync("test-results", { recursive: true });
writeFileSync("test-results/timings.json", JSON.stringify(steps, null, 2));
writeFileSync("test-results/timings.md", markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
console.log(markdown);
