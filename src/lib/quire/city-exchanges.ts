import type { CloudTable } from "./cloud.ts";
import { canonicalJson } from "./canonical-json.ts";
import { fromCopper } from "./money.ts";
import { readMarketLocations, type MarketLocation } from "./shop-locations.ts";
import { readTradeEconomy, type Exchange } from "./trade-economy-schema.ts";

const exchangeName = (city: MarketLocation) => `${city.name.slice(0, 125)} Trade Exchange`;
const treasury = (exchange: Exchange) => ({
  id: exchange.purseId,
  name: `${exchange.name.slice(0, 145)} treasury`,
  kind: "character" as const,
  control: "npc" as const,
  nonParty: true,
  coins: fromCopper(0),
});
const defaultExchange = (city: MarketLocation, id: string, purseId: string): Exchange => ({
  id, purseId, defaultCityId: city.id, name: exchangeName(city), locationId: city.id,
  open: true, visible: true, notes: "", offers: [],
});
function cityKey(id: string) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return `city-exchange-${id.slice(0, 100)}-${(hash >>> 0).toString(16)}`;
}

/** Only call on a canonical campaign, before permission projection; never on archives. */
export function ensureCityExchanges<T extends CloudTable>(table: T): T {
  const cities = readMarketLocations(table.journal?.market).locations.filter(l => l.kind === "city");
  if (!cities.length) return table;
  const economy = readTradeEconomy(table.journal?.tradeEconomy);
  const covered = new Set(economy.exchanges.map(e => e.locationId));
  const used = new Set([...table.purses.map(p => p.id), ...economy.exchanges.map(e => e.id),
    ...economy.exchanges.map(e => e.purseId)]);
  let added = false;
  for (const city of cities.sort((a, b) => a.id.localeCompare(b.id))) {
    if (covered.has(city.id)) continue;
    const base = cityKey(city.id);
    let id = base, suffix = 0;
    while (used.has(id) || used.has(`${id}-treasury`)) id = `${base}-${++suffix}`;
    const exchange = defaultExchange(city, id, `${id}-treasury`);
    economy.exchanges.push(exchange);
    table.purses.push(treasury(exchange));
    used.add(exchange.id); used.add(exchange.purseId); covered.add(city.id); added = true;
  }
  if (added) table.journal!.tradeEconomy = economy;
  return table;
}

const references = (value: unknown, ids: Set<string>): boolean =>
  typeof value === "string" ? ids.has(value) :
    !!value && typeof value === "object" && Object.values(value).some(v => references(v, ids));

/** Preserve location deletion for an untouched default; configured or referenced records stay protected. */
export function removeUnusedCityExchange(table: CloudTable, city: MarketLocation) {
  const economy = table.journal?.tradeEconomy;
  if (!economy) return;
  for (const exchange of [...economy.exchanges]) {
    if (exchange.defaultCityId !== city.id ||
      canonicalJson(exchange) !== canonicalJson(defaultExchange(city, exchange.id, exchange.purseId))) continue;
    const purse = table.purses.find(p => p.id === exchange.purseId);
    if (canonicalJson(purse ?? null) !== canonicalJson(treasury(exchange))) continue;
    const others = { ...table, purses: table.purses.filter(p => p !== purse), journal: {
      ...table.journal, tradeEconomy: { ...economy, exchanges: economy.exchanges.filter(e => e !== exchange) },
    } };
    if (references(others, new Set([exchange.id, exchange.purseId]))) continue;
    economy.exchanges = economy.exchanges.filter(e => e !== exchange);
    table.purses = table.purses.filter(p => p !== purse);
  }
}

export function renameUnusedCityExchange(table: CloudTable, before: MarketLocation, after: MarketLocation) {
  for (const exchange of table.journal?.tradeEconomy?.exchanges ?? []) {
    if (exchange.defaultCityId !== before.id ||
      canonicalJson(exchange) !== canonicalJson(defaultExchange(before, exchange.id, exchange.purseId))) continue;
    const purse = table.purses.find(p => p.id === exchange.purseId);
    if (canonicalJson(purse ?? null) !== canonicalJson(treasury(exchange))) continue;
    exchange.name = exchangeName(after);
    purse!.name = treasury(exchange).name;
  }
}
