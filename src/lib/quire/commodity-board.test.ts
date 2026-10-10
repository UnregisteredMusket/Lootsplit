import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "./canonical-json.ts";
import { commodityQuoteRows } from "./commodity-board.ts";
import { prepareTradeSeason, previewTradeSeason } from "./trade-economy.ts";
import { tradeFixture } from "./test-fixtures/trade-economy.ts";

function recordedEconomy() {
  const table = tradeFixture();
  const economy = table.journal!.tradeEconomy!;
  prepareTradeSeason(table, { source: "local", random: () => 50 });
  const quote = previewTradeSeason(table, "board-season", 0);
  const appliedExchanges = structuredClone(quote.exchanges);
  Object.assign(appliedExchanges[0].offers[0], { askCopper: 120, bidCopper: 70 });
  economy.history.push({
    id: quote.id,
    at: 1,
    day: 1,
    quote,
    appliedExchanges,
    realm: quote.realm,
    reason: "Approved override",
    source: "manual",
  });
  economy.epoch = 1;
  Object.assign(economy.exchanges[0].offers[0], { askCopper: 130, bidCopper: 80 });
  return economy;
}

test("board uses approved prices and the matching prior baseline, without rewriting saved data", () => {
  const economy = recordedEconomy(),
    frozen = canonicalJson(economy);
  economy.commodities[0].name = "Renamed timber";
  economy.exchanges[0].name = "Renamed harbor";
  const row = commodityQuoteRows(economy, economy.exchanges, true)[0];
  assert.deepEqual(row.points, [
    { epoch: 0, askCopper: 100, bidCopper: 60 },
    { epoch: 1, askCopper: 120, bidCopper: 70 },
  ]);
  assert.ok(Math.abs(row.changePercent! - 30) < 1e-10);
  assert.equal(row.offer.askCopper, 130, "Later DM edits remain the current quote, not the chart");
  const expected = JSON.parse(frozen);
  expected.commodities[0].name = "Renamed timber";
  expected.exchanges[0].name = "Renamed harbor";
  assert.equal(canonicalJson(economy), canonicalJson(expected));
});

test("player/default presentation never reads private history or fabricates a flat trend", () => {
  const economy = recordedEconomy();
  Object.defineProperty(economy, "history", {
    get() {
      throw Error("Private history read");
    },
  });
  const row = commodityQuoteRows(economy, economy.exchanges)[0];
  assert.deepEqual(row.points, []);
  assert.equal(row.changePercent, null);
  assert.equal(row.offer.askCopper, 130);
});

test("unreadable snapshots, physical-unit changes and missing prior seasons have no comparison", () => {
  for (const cause of ["unreadable", "unit", "epoch"] as const) {
    const economy = recordedEconomy();
    if (cause === "unreadable") economy.history[0].quote.before = "legacy-opaque-fingerprint";
    if (cause === "unit") economy.commodities[0].unit = "wagon";
    if (cause === "epoch") economy.epoch = 3;
    const row = commodityQuoteRows(economy, economy.exchanges, true)[0];
    assert.equal(row.changePercent, null, cause);
    if (cause !== "epoch") assert.deepEqual(row.points, [], cause);
  }
});

test("exchange identities and commodity units keep independent prices and zero bids intact", () => {
  const economy = recordedEconomy();
  economy.exchanges.push({
    ...structuredClone(economy.exchanges[0]),
    id: "other",
    name: "Other exchange",
  });
  economy.commodities.push({ ...economy.commodities[0], id: "grain", name: "Grain" });
  economy.exchanges[0].offers.push({
    ...economy.exchanges[0].offers[0],
    commodityId: "grain",
    bidCopper: 0,
  });
  const rows = commodityQuoteRows(economy, economy.exchanges, true);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].offer.bidCopper, 0);
  assert.deepEqual(rows[1].points, []);
  assert.deepEqual(rows[2].points, []);
  assert.equal(new Set(rows.map((r) => r.key)).size, 3);
});

test("chart retains all recorded points and skips a future pending season", () => {
  const economy = recordedEconomy();
  for (let epoch = 1; epoch <= 14; epoch++) {
    const record = structuredClone(economy.history[0]);
    const before = JSON.parse(record.quote.before);
    before.epoch = epoch;
    record.id = `board-${epoch}`;
    record.quote.fromEpoch = epoch;
    record.quote.before = canonicalJson(before);
    record.appliedExchanges[0].offers[0].askCopper = 120 + epoch;
    economy.history.push(record);
  }
  economy.epoch = 14;
  const row = commodityQuoteRows(economy, economy.exchanges, true)[0];
  assert.equal(row.points.length, 15);
  assert.equal(row.points.at(-1)!.epoch, 14);
  assert.equal(row.points.at(-1)!.askCopper, 133);
});
