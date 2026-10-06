import "fake-indexeddb/auto";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { quireDb } from "../src/lib/quire/db.ts";
import { applyCloudTable, economySnapshot, snapshot } from "../src/lib/quire/economy.ts";
import { emptyCloudTable } from "../src/lib/quire/cloud.ts";
import { fromCopper } from "../src/lib/quire/money.ts";
const table = {
  ...emptyCloudTable(),
  purses: Array.from({ length: 20 }, (_, i) => ({
    id: `p${i}`,
    name: `Hero ${i}`,
    kind: "character",
    coins: fromCopper(10000),
  })),
  ledger: Array.from({ length: 1000 }, (_, i) => ({
    id: `l${i}`,
    at: i,
    purseId: `p${i % 20}`,
    shopId: null,
    copper: -1,
    summary: "Purchase",
    transactionType: "purchase",
  })),
};
await applyCloudTable(table);
const db = await quireDb(),
  original = db.transaction.bind(db);
const output = {
  environment: `node${process.versions.node}/linux-x64/fake-indexeddb/warm/20-purses-1000-ledger`,
  results: [],
};
for (const [name, read] of [
  ["campaign snapshot", economySnapshot],
  ["device backup", snapshot],
]) {
  for (let i = 0; i < 10; i++) await read();
  let transactions = 0;
  db.transaction = (...args) => {
    transactions++;
    return original(...args);
  };
  const startedAt = new Date().toISOString(),
    start = performance.now();
  for (let i = 0; i < 100; i++) await read();
  const durationMs = performance.now() - start;
  output.results.push({
    name,
    iterations: 100,
    transactions,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs,
  });
  db.transaction = original;
}
writeFileSync(process.argv[2], JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
