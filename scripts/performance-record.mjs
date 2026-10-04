import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateMeasurement, recordRegressions, parseLines } from "./performance-history.mjs";

export function shouldRecordLocal(baselines, pending, row) {
  const references = recordRegressions(baselines, pending).baselines;
  return !references[row.scope] || recordRegressions(references, [row]).regressions.length > 0;
}

export function localMeasurement(input) {
  if (!["test", "function", "deployment", "action", "audit"].includes(input.kind))
    throw Error("Choose test, function, deployment, action or audit");
  if (!input.scopeVersion || !input.environment || !input.name)
    throw Error("Name, environment and scopeVersion are required");
  return validateMeasurement({
    schema: 1,
    id: `local:${randomUUID()}`,
    scope: JSON.stringify(["local", input.kind, input.name, input.environment, input.scopeVersion]),
    kind: input.kind,
    name: input.name,
    environment: input.environment,
    commit: input.commit || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    url: input.url,
    outcome: input.outcome,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3)
      throw Error("Usage: npm run performance:record -- measurement.json");
    const row = localMeasurement(JSON.parse(readFileSync(process.argv[2], "utf8")));
    if (!existsSync("test-results/performance/baselines.json"))
      throw Error("Run npm run performance:sync first to read the latest recorded references");
    const baselines = JSON.parse(readFileSync("test-results/performance/baselines.json", "utf8"));
    const state = JSON.parse(readFileSync("test-results/performance/state.json", "utf8"));
    const processed = new Set(state.manualProcessed || []);
    const pending = existsSync("performance/manual-measurements.jsonl")
      ? parseLines(readFileSync("performance/manual-measurements.jsonl", "utf8")).filter(
          (r) => !processed.has(r.id),
        )
      : [];
    if (!shouldRecordLocal(baselines, pending, row)) {
      console.log(
        "Not logged: less than 15% slower than the last recorded comparable duration. Reference unchanged.",
      );
      process.exit(0);
    }
    mkdirSync("performance", { recursive: true });
    appendFileSync("performance/manual-measurements.jsonl", JSON.stringify(row) + "\n");
    console.log(
      "Recorded measurement. Include performance/manual-measurements.jsonl in the task's GitHub commit; the logger imports it after merge.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
