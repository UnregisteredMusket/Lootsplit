import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "./canonical-json.ts";
import { prepareTradeSeason, previewTradeSeason } from "./trade-economy.ts";
import { readTradeSeasonBaseline } from "./trade-history.ts";
import { tradeFixture } from "./test-fixtures/trade-economy.ts";

function recordedQuote() {
  const table = tradeFixture();
  prepareTradeSeason(table, { source: "local", random: () => 50 });
  return { table, quote: previewTradeSeason(table, "history-preview", 0) };
}

test("season history reads the frozen baseline after current labels, offers and realm change", () => {
  const { table, quote } = recordedQuote();
  const original = canonicalJson(quote);
  table.journal!.tradeEconomy!.commodities[0].name = "Renamed current timber";
  table.journal!.tradeEconomy!.commodities[0].unit = "current unit";
  table.journal!.tradeEconomy!.exchanges[0].name = "Renamed current exchange";
  table.journal!.tradeEconomy!.exchanges[0].offers[0].askCopper = 999;
  table.journal!.tradeEconomy!.exchanges[0].offers[0].stock = 12;
  table.realm!.war = 2;
  const before = readTradeSeasonBaseline(quote)!;
  assert.equal(before.commodities[0].name, "Building timber");
  assert.equal(before.commodities[0].unit, "bundle");
  assert.equal(before.exchanges[0].name, "Harbor Exchange");
  assert.equal(before.exchanges[0].offers[0].askCopper, 100);
  assert.equal(before.exchanges[0].offers[0].stock, 100);
  assert.equal(before.realm.war, 0);
  assert.equal(canonicalJson(quote), original, "Reading history leaves the recorded quote intact");
});

test("original baseline stays separate from the proposal and the DM applied override", () => {
  const { quote } = recordedQuote();
  const proposal = canonicalJson(quote);
  const applied = { exchanges: structuredClone(quote.exchanges), realm: { ...quote.realm } };
  applied.exchanges[0].offers[0].askCopper = 777;
  applied.exchanges[0].offers[0].stock = 77;
  applied.realm.season = 2;
  applied.realm.shortage = 1.5;
  const before = readTradeSeasonBaseline(quote)!;
  assert.equal(before.realm.season, 1);
  assert.equal(quote.realm.season, 0);
  assert.equal(applied.realm.season, 2);
  assert.equal(before.exchanges[0].offers[0].askCopper, 100);
  assert.notEqual(quote.exchanges[0].offers[0].askCopper, applied.exchanges[0].offers[0].askCopper);
  assert.equal(canonicalJson(quote), proposal);
});

test("unreadable or mismatched legacy baselines return unavailable without erasing the proposal", () => {
  const { quote } = recordedQuote();
  const before = JSON.parse(quote.before);
  for (const value of [
    "",
    "older-opaque-fingerprint",
    "null",
    "{}",
    JSON.stringify({ ...before, epoch: before.epoch + 1 }),
    JSON.stringify({ ...before, commodities: undefined }),
    JSON.stringify({ ...before, exchanges: [{ ...before.exchanges[0], offers: "unreadable" }] }),
    JSON.stringify({ ...before, commodities: [before.commodities[0], before.commodities[0]] }),
  ]) {
    const older = { ...quote, before: value };
    assert.equal(readTradeSeasonBaseline(older), null);
    assert.deepEqual(older.exchanges, quote.exchanges);
    assert.deepEqual(older.realm, quote.realm);
  }
});

test("baseline presentation excludes private activity and returns independent data", () => {
  const { quote } = recordedQuote();
  const frozen = JSON.parse(quote.before);
  frozen.activity = [{ settlement: { holding: "private inventory snapshot" } }];
  quote.before = canonicalJson(frozen);
  const original = quote.before;
  const baseline = readTradeSeasonBaseline(quote)!;
  assert.equal("activity" in baseline, false);
  assert.equal(JSON.stringify(baseline).includes("private inventory snapshot"), false);
  baseline.exchanges[0].offers[0].stock = 0;
  assert.equal(quote.before, original);
  assert.equal(readTradeSeasonBaseline(quote)!.exchanges[0].offers[0].stock, 100);
});
