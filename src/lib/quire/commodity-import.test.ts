import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { STARTER_COMMODITIES } from "./commodity-catalog.ts";
import {
  parseCommodityImport,
  previewCommodityImport,
  commodityImportFingerprint,
} from "./commodity-import.ts";
import { tradeFixture } from "./test-fixtures/trade-economy.ts";
import { applyCommand } from "./commands.ts";
import { readCloudTable } from "./cloud.ts";
import { projectRecord } from "./session-records.ts";

const dm = { id: "dm", name: "DM", token: "", role: "dm" as const, purseIds: [] };
const player = { ...dm, id: "player", role: "player" as const, purseIds: ["a"] };
const sample = { ...STARTER_COMMODITIES[0], id: "custom.grain" };

test("shipped fantasy catalogue and downloadable pack agree and cover all ten categories", () => {
  const downloaded = parseCommodityImport(
    readFileSync("public/download/fantasy-commodities.json", "utf8"),
  );
  assert.deepEqual(downloaded, STARTER_COMMODITIES);
  assert.equal(downloaded.length, 60);
  assert.equal(new Set(downloaded.map((c) => c.category)).size, 10);
  assert.ok(downloaded.some((c) => c.name === "Mithral ingots"));
  assert.ok(downloaded.some((c) => c.name === "Dragon scales"));
  assert.ok(downloaded.every((c) => !c.materialKey));
  assert.equal(
    parseCommodityImport(readFileSync("public/download/commodities.sample.csv", "utf8")).length,
    2,
  );
});

test("JSON, quoted CSV and TSV imports preserve keys, physical units, copper and inactive goods", () => {
  assert.deepEqual(parseCommodityImport(JSON.stringify([sample])), [sample]);
  assert.deepEqual(parseCommodityImport(JSON.stringify({ version: 1, commodities: [sample] })), [
    sample,
  ]);
  const csv =
    'id,name,unit,category,baseCopper,weight,description,active,materialKey\r\ncustom.ore,"Ore, ""bright""",1 lb parcel,smith,200,0.5,"line one\nline two",false,';
  const parsed = parseCommodityImport(csv)[0];
  assert.equal(parsed.name, 'Ore, "bright"');
  assert.equal(parsed.description, "line one\nline two");
  assert.equal(parsed.active, false);
  assert.equal(parsed.weight, 0.5);
  assert.equal(parsed.baseCopper, 200);
  assert.equal(parsed.materialKey, undefined);
  assert.equal(
    parseCommodityImport(
      "id\tname\tunit\tcategory\tbaseCopper\tweight\ncustom.grain\tGrain\tsack\tprovisions\t100\t25",
    )[0].active,
    true,
  );
});

test("malformed, duplicate, over-limit and invented fields are rejected before review", () => {
  for (const value of [
    "",
    "{",
    JSON.stringify({ version: 2, commodities: [sample] }),
    JSON.stringify([{ ...sample, baseCopper: 0 }]),
    JSON.stringify([{ ...sample, baseCopper: 1.5 }]),
    JSON.stringify([{ ...sample, stock: 100 }]),
    JSON.stringify([sample, sample]),
    JSON.stringify(Array.from({ length: 501 }, (_, i) => ({ ...sample, id: `custom.${i}` }))),
    "x".repeat(512001),
    "id,name,unit,category,baseCopper,weight\nx,Ore,parcel,smith,,1",
    "id,name,unit,category,baseCopper,weight,active\nx,Ore,parcel,smith,1,1,yes",
    "id,id,name\nx,x,Ore",
  ])
    assert.throws(() => parseCommodityImport(value));
});

test("review and authoritative import are additive, DM-only, stale-safe and grant no wealth or stock", () => {
  const table = tradeFixture(),
    economy = table.journal!.tradeEconomy!;
  const plan = previewCommodityImport(economy, [sample, economy.commodities[0]]);
  assert.equal(plan.additions.length, 1);
  assert.equal(plan.skipped.length, 1);
  const cmd = {
    id: "catalog-import",
    kind: "trade-commodity-import" as const,
    before: plan.before,
    commodities: [sample],
    reason: "Reviewed homebrew goods",
  };
  assert.throws(() => applyCommand(table, player, cmd), /Only the DM/);
  const imported = applyCommand(table, dm, cmd);
  for (const key of ["purses", "holdings", "stock", "ledger"] as const)
    assert.deepEqual(imported[key], table[key]);
  assert.deepEqual(imported.journal!.tradeEconomy!.exchanges, economy.exchanges);
  assert.deepEqual(imported.journal!.tradeEconomy!.receipts, economy.receipts);
  assert.deepEqual(imported.journal!.tradeEconomy!.history, economy.history);
  assert.equal(readCloudTable(imported)!.journal!.tradeEconomy!.commodities.length, 2);
  assert.equal(
    projectRecord(imported, player).journal!.tradeEconomy!.commodities.length,
    1,
    "Unoffered imported goods keep the existing player projection",
  );
  assert.equal(
    previewCommodityImport(imported.journal!.tradeEconomy!, [sample]).additions.length,
    0,
  );
  assert.throws(() => applyCommand(imported, dm, { ...cmd, id: "stale-review" }), /changed/);
  const original = JSON.stringify(table);
  assert.throws(
    () =>
      applyCommand(table, dm, {
        ...cmd,
        commodities: [sample, { ...sample, id: "bad.material", materialKey: "unknown" }],
      }),
    /material/,
  );
  assert.equal(
    JSON.stringify(table),
    original,
    "Invalid material links do not partially add definitions",
  );
});

test("conflicting identities, duplicate rows and capacity overflow preserve existing definitions", () => {
  const economy = tradeFixture().journal!.tradeEconomy!;
  assert.throws(
    () => previewCommodityImport(economy, [{ ...economy.commodities[0], unit: "different unit" }]),
    /different definition/,
  );
  assert.throws(() => previewCommodityImport(economy, [sample, sample]), /unique/);
  const full = {
    commodities: Array.from({ length: 500 }, (_, i) => ({ ...sample, id: `full.${i}` })),
  };
  assert.throws(() => previewCommodityImport(full, [sample]), /500/);
  assert.equal(
    commodityImportFingerprint(economy),
    commodityImportFingerprint({ ...economy, commodities: [...economy.commodities].reverse() }),
  );
});
