import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { Holding } from "./types.ts";
import { canonicalJson } from "./canonical-json.ts";
import { fromCopper, toCopper } from "./money.ts";
import { clampRealm, pressureFor, scalePrice, SEASON_NAMES } from "./scale.ts";
import { locationPath, readMarketLocations } from "./shop-locations.ts";
import { canAccessEstate, physicallyHere, storageWeight } from "./estate.ts";
import { readEstate } from "./estate-schema.ts";
import {
  readTradeEconomy,
  tradeEconomySchema,
  tradeSeasonQuoteSchema,
  type Commodity,
  type Exchange,
  type TradeCommand,
  type TradeEconomy,
  type TradeExecution,
  type TradeSeasonQuote,
} from "./trade-economy-schema.ts";

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const bounded = (x: number, low: number, high: number) => Math.min(high, Math.max(low, x));
const money = (x: number) => {
  if (!Number.isSafeInteger(x) || x < 0 || x > 1e12)
    throw Error("The exchange amount exceeds the supported copper limit.");
  return x;
};
const unique = (ids: string[], label: string) => {
  if (new Set(ids).size !== ids.length) throw Error(`Duplicate ${label} identities.`);
};

/** Unbiased d100, called by the room server or local DM command authority only. */
export function randomTradeRoll(): number {
  const limit = Math.floor(0x100000000 / 100) * 100;
  let n: number;
  do {
    n = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (n >= limit);
  return (n % 100) + 1;
}

export function exchangeHere(table: Pick<CloudTable, "journal">, exchange: Exchange): boolean {
  if (!exchange.locationId) return true;
  const locations = readMarketLocations(table.journal?.market);
  return (
    !!locations.currentLocationId &&
    locationPath(locations, locations.currentLocationId).some((l) => l.id === exchange.locationId)
  );
}

export function validateTradeEconomy(
  table: Pick<CloudTable, "purses" | "holdings" | "stock" | "journal">,
) {
  if (!table.journal?.tradeEconomy) return;
  const economy = readTradeEconomy(table.journal.tradeEconomy);
  unique(
    economy.commodities.map((c) => c.id),
    "commodity",
  );
  unique(
    economy.exchanges.map((e) => e.id),
    "exchange",
  );
  unique(
    economy.exchanges.map((e) => e.purseId),
    "exchange treasury",
  );
  unique(
    economy.receipts.map((r) => r.id),
    "market receipt",
  );
  unique(
    economy.draws.map((d) => `${d.epoch}:${d.key}`),
    "seasonal draw",
  );
  unique(
    economy.history.map((h) => h.id),
    "seasonal settlement",
  );
  const materials = readEstate(table.journal.propertyOperations).materials;
  unique(
    economy.commodities.flatMap((c) => (c.materialKey ? [c.materialKey] : [])),
    "commodity material",
  );
  for (const c of economy.commodities) {
    if (c.materialKey && !materials.some((m) => m.key === c.materialKey && m.unit === c.unit))
      throw Error("A commodity's material must use the same reviewed property unit.");
  }
  const locations = readMarketLocations(table.journal.market).locations;
  for (const e of economy.exchanges) {
    const treasury = table.purses.find((p) => p.id === e.purseId);
    if (!treasury?.nonParty || treasury.kind !== "character" || treasury.control !== "npc")
      throw Error("An exchange needs its own non-party NPC treasury, separate from player funds.");
    if (e.locationId && !locations.some((l) => l.id === e.locationId))
      throw Error("The exchange location is missing.");
    unique(
      e.offers.map((o) => o.commodityId),
      "exchange offer",
    );
    for (const offer of e.offers)
      if (!economy.commodities.some((c) => c.id === offer.commodityId))
        throw Error("The exchange commodity is missing.");
  }
  for (const h of table.holdings) {
    if (
      h.commodityId &&
      (h.kind !== "item" || !economy.commodities.some((c) => c.id === h.commodityId))
    )
      throw Error("An inventory commodity reference is invalid.");
  }
  for (const s of table.stock) {
    if (
      !!s.commodityId !== !!s.tradeExchangeId ||
      (s.commodityId &&
        (!economy.commodities.some((c) => c.id === s.commodityId) ||
          !economy.exchanges.some((e) => e.id === s.tradeExchangeId)))
    )
      throw Error("Shop activity needs both a reviewed commodity and an exchange.");
  }
}

/** Prices stay fixed during a season. Availability and actual money are rechecked at commit. */
export function exchangeQuoteKey(economy: TradeEconomy, exchange: Exchange, commodity: Commodity) {
  const offer = exchange.offers.find((o) => o.commodityId === commodity.id);
  return canonicalJson({
    epoch: economy.epoch,
    enabled: economy.settings.enabled,
    commodity,
    exchange: {
      id: exchange.id,
      locationId: exchange.locationId,
      purseId: exchange.purseId,
      open: exchange.open,
      visible: exchange.visible,
    },
    ask: offer?.askCopper,
    bid: offer?.bidCopper,
  });
}

export function tradeSeasonFingerprint(table: Pick<CloudTable, "journal" | "realm">): string {
  const economy = readTradeEconomy(table.journal?.tradeEconomy);
  return canonicalJson({
    epoch: economy.epoch,
    settings: economy.settings,
    commodities: economy.commodities,
    exchanges: economy.exchanges,
    activity: economy.receipts.filter((r) => r.epoch === economy.epoch),
    realm: clampRealm(table.realm),
  });
}

/** Draws survive cancelled/replaced previews. CAS retries receive memoized server entropy. */
export function prepareTradeSeason(table: CloudTable, execution: TradeExecution) {
  const economy = table.journal!.tradeEconomy!;
  if (!economy.settings.enabled || economy.settings.mode === "classic") return;
  const keys = [
    "hardship",
    "hardship-type",
    "hardship-severity",
    ...economy.exchanges.flatMap((e) =>
      e.offers.flatMap((o) => [
        `${e.id}:${o.commodityId}:supply`,
        `${e.id}:${o.commodityId}:demand`,
      ]),
    ),
  ];
  for (const key of keys) {
    if (economy.draws.some((d) => d.epoch === economy.epoch + 1 && d.key === key)) continue;
    if (!execution.random || !execution.source)
      throw Error("Prepare seasonal rolls through the campaign's DM authority.");
    const roll = execution.random(`${economy.epoch + 1}:${key}`);
    if (!Number.isInteger(roll) || roll < 1 || roll > 100)
      throw Error("Invalid seasonal random result.");
    economy.draws.push({ epoch: economy.epoch + 1, key, roll, source: execution.source });
  }
}

export function previewTradeSeason(
  table: Pick<CloudTable, "journal" | "realm">,
  id: string,
  season?: number,
): TradeSeasonQuote {
  const economy = readTradeEconomy(table.journal?.tradeEconomy);
  if (!economy.settings.enabled)
    throw Error("Enable this campaign's trade economy before planning a season.");
  const realm = clampRealm(table.realm);
  realm.season = season ?? (realm.season + 1) % SEASON_NAMES.length;
  const draws = economy.draws.filter((d) => d.epoch === economy.epoch + 1);
  const roll = (key: string) => {
    const d = draws.find((d) => d.key === key);
    if (!d) throw Error("Seasonal rolls are missing. Prepare a fresh DM preview.");
    return d.roll;
  };
  let hardship = "Classic Mode: DM settings and quotes retained.";
  if (economy.settings.mode === "automatic") {
    const chance = bounded(
      economy.settings.hardshipChance +
        (realm.season === 0 ? 10 : 0) +
        realm.war * 5 +
        realm.plague * 5,
      0,
      100,
    );
    hardship = "No new hardship; existing DM conditions retained.";
    if (economy.settings.hardshipTypes.length && roll("hardship") <= chance) {
      const type =
        economy.settings.hardshipTypes[
          Math.min(
            economy.settings.hardshipTypes.length - 1,
            Math.floor(((roll("hardship-type") - 1) / 100) * economy.settings.hardshipTypes.length),
          )
        ];
      const severity = Math.round((roll("hardship-severity") / 100) * 2 * 100) / 100;
      realm[type] =
        type === "roads" ? Math.min(realm.roads, 2 - severity) : Math.max(realm[type], severity);
      hardship = `${type}: ${realm[type]} (recorded d100; DM may override).`;
    }
  }
  const activity = economy.receipts.filter((r) => r.epoch === economy.epoch);
  const feedback = economy.exchanges.flatMap((e) =>
    e.offers.map((o) => ({
      exchangeId: e.id,
      commodityId: o.commodityId,
      bought: activity
        .filter(
          (r) => r.exchangeId === e.id && r.commodityId === o.commodityId && r.direction === "buy",
        )
        .reduce((n, r) => n + r.quantity, 0),
      sold: activity
        .filter(
          (r) => r.exchangeId === e.id && r.commodityId === o.commodityId && r.direction === "sell",
        )
        .reduce((n, r) => n + r.quantity, 0),
    })),
  );
  const exchanges = structuredClone(economy.exchanges);
  if (economy.settings.mode === "automatic")
    for (const e of exchanges)
      for (const offer of e.offers) {
        const commodity = economy.commodities.find((c) => c.id === offer.commodityId)!;
        if (!commodity.active) continue;
        const flow = feedback.find((f) => f.exchangeId === e.id && f.commodityId === commodity.id)!;
        const impact =
          bounded((flow.bought - flow.sold) / Math.max(1, offer.targetStock), -1, 1) *
          economy.settings.feedback;
        const pressure = pressureFor(commodity.category, realm);
        const variation = (key: string) =>
          ((roll(`${e.id}:${commodity.id}:${key}`) - 50.5) / 49.5) * economy.settings.volatility;
        if (!offer.lockIndices) {
          offer.supply = Math.round(
            bounded(100 / pressure + variation("supply") - impact, 1, 1000),
          );
          offer.demand = Math.round(
            bounded(100 * pressure + variation("demand") + impact, 1, 1000),
          );
        }
        if (!offer.lockStock)
          offer.stock = Math.round(
            bounded((offer.targetStock * offer.supply) / 100, 0, offer.capacity),
          );
        if (!offer.lockPrice) {
          const base = scalePrice(commodity.baseCopper, {
            wealth: "modest",
            rarity: "common",
            priceScale: 1,
            category: commodity.category,
            realm,
          });
          // Realm/category pressure is already included once in base; indices express relative local pressure.
          const ratio = Math.sqrt(offer.demand / offer.supply) / Math.max(0.01, pressure);
          offer.askCopper = money(
            Math.round(
              bounded(
                base * ratio,
                Math.max(1, base * economy.settings.minMultiplier),
                Math.min(1e12, base * economy.settings.maxMultiplier),
              ),
            ),
          );
          offer.bidCopper = Math.floor((offer.askCopper * economy.settings.bidRateBps) / 10000);
        }
      }
  return tradeSeasonQuoteSchema.parse({
    id,
    before: tradeSeasonFingerprint(table),
    fromEpoch: economy.epoch,
    season: realm.season,
    mode: economy.settings.mode,
    realm,
    exchanges,
    draws,
    hardship,
    feedback,
  });
}

export function applyTradeSeason(
  table: CloudTable,
  quote: TradeSeasonQuote,
  at: number,
  day: number,
  source: "downtime" | "manual",
  reason: string,
  overrides?: { exchanges?: Exchange[]; realm?: TradeSeasonQuote["realm"] },
) {
  const economy = table.journal!.tradeEconomy!;
  if (quote.before !== tradeSeasonFingerprint(table) || quote.fromEpoch !== economy.epoch)
    throw Error(
      "The economy changed after this seasonal preview. Prepare it again before approval.",
    );
  const exchanges = overrides?.exchanges ?? quote.exchanges;
  if (
    !same(
      exchanges.map((e) => [e.id, e.purseId, e.locationId, e.offers.map((o) => o.commodityId)]),
      quote.exchanges.map((e) => [
        e.id,
        e.purseId,
        e.locationId,
        e.offers.map((o) => o.commodityId),
      ]),
    )
  )
    throw Error(
      "A seasonal override may edit quotes and availability; edit exchange identities separately.",
    );
  economy.exchanges = structuredClone(exchanges);
  table.realm = clampRealm(overrides?.realm ?? quote.realm);
  economy.epoch++;
  economy.history.push({
    id: quote.id,
    at,
    day,
    quote: structuredClone(quote),
    appliedExchanges: structuredClone(exchanges),
    realm: table.realm,
    source,
    reason,
  });
  delete economy.pendingSeason;
  table.journal!.tradeEconomy = tradeEconomySchema.parse(economy);
  validateTradeEconomy(table);
}

function move(
  table: CloudTable,
  purseId: string,
  delta: number,
  id: string,
  summary: string,
  at: number,
  transactionType: "purchase" | "sale" | "transfer" | "adjustment",
) {
  const purse = table.purses.find((p) => p.id === purseId);
  if (!purse) throw Error("The exchange account is missing.");
  purse.coins = fromCopper(money(toCopper(purse.coins) + delta));
  if (delta)
    table.ledger.push({ id, purseId, copper: delta, at, summary, shopId: null, transactionType });
}

function storage(
  table: CloudTable,
  seat: CloudSeat,
  propertyId: string,
  managerLocation?: string | null,
) {
  const estate = readEstate(table.journal?.propertyOperations);
  const holding = table.holdings.find((h) => h.id === propertyId && h.kind === "property");
  const site = estate.sites.find((s) => s.propertyId === propertyId);
  if (
    !holding ||
    !site?.enabled ||
    holding.property?.condition === "ruin" ||
    ![site.templateKey, ...site.completedTemplates].some((key) =>
      estate.templates.find((t) => t.key === key)?.capabilities.includes("storage"),
    )
  )
    throw Error("The destination needs active usable property storage.");
  if (!canAccessEstate(table, estate, propertyId, seat))
    throw Error("This character cannot access that property store.");
  if (
    managerLocation !== undefined
      ? !holding.locationId || holding.locationId !== managerLocation
      : !physicallyHere(table, holding)
  )
    throw Error("Stored goods can trade only at their property's location.");
  return { holding, site };
}

export type ExchangeTransaction = {
  id: string;
  exchangeId: string;
  commodityId: string;
  purseId: string;
  direction: "buy" | "sell";
  quantity: number;
  before: string;
  holdingId?: string;
  propertyId?: string;
  overrideLocation?: boolean;
};
/** Shared command and manager simulation use the same canonical goods and coin movement. */
export function executeExchange(
  table: CloudTable,
  seat: CloudSeat,
  input: ExchangeTransaction,
  at: number,
  manager?: { locationId: string | null },
) {
  const economy = readTradeEconomy(table.journal?.tradeEconomy);
  const exchange = economy.exchanges.find((e) => e.id === input.exchangeId);
  const commodity = economy.commodities.find((c) => c.id === input.commodityId);
  const offer = exchange?.offers.find((o) => o.commodityId === input.commodityId);
  if (
    !economy.settings.enabled ||
    !exchange?.open ||
    !commodity?.active ||
    !offer ||
    (seat.role !== "dm" && !exchange.visible)
  )
    throw Error("That commodity exchange is unavailable.");
  if (input.before !== exchangeQuoteKey(economy, exchange, commodity))
    throw Error("The seasonal quote changed. Review the current bid and ask before trading.");
  if (input.overrideLocation && seat.role !== "dm")
    throw Error("Only the DM can override physical presence.");
  const managerHere =
    manager &&
    !!manager.locationId &&
    (!exchange.locationId ||
      locationPath(readMarketLocations(table.journal?.market), manager.locationId).some(
        (l) => l.id === exchange.locationId,
      ));
  if (!input.overrideLocation && !(manager ? managerHere : exchangeHere(table, exchange)))
    throw Error("Visit the exchange's location to trade.");
  const payer = table.purses.find((p) => p.id === input.purseId);
  if (!payer || payer.nonParty || (seat.role !== "dm" && !seat.purseIds.includes(payer.id)))
    throw Error("Trade only from an assigned party or character account.");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100000)
    throw Error("Choose a valid whole-unit quantity.");
  const treasury = table.purses.find((p) => p.id === exchange.purseId)!;
  const total = money(
    input.quantity * (input.direction === "buy" ? offer.askCopper : offer.bidCopper),
  );
  let holding: Holding | undefined;
  if (input.direction === "buy") {
    if (offer.stock < input.quantity) throw Error("The exchange has insufficient stock.");
    if (toCopper(payer.coins) < total) throw Error("The buyer has insufficient funds.");
    money(toCopper(treasury.coins) + total);
    if (input.propertyId) {
      const { site } = storage(table, seat, input.propertyId, manager?.locationId);
      const used = storageWeight(table, input.propertyId);
      if (
        site.capacityWeight !== null &&
        (used.unknown || used.weight + commodity.weight * input.quantity > site.capacityWeight)
      )
        throw Error("The purchase exceeds storage capacity, or stored weights need DM review.");
    }
    const holdingId = `${input.id}-goods`;
    if (table.holdings.some((h) => h.id === holdingId))
      throw Error("This exchange transaction already has inventory goods.");
    holding = {
      id: holdingId,
      purseId: payer.id,
      kind: "item",
      name: commodity.name,
      quantity: input.quantity,
      unitCopper: offer.askCopper,
      notes: `${commodity.unit}; acquired at ${exchange.name}.`,
      weight: commodity.weight,
      category: commodity.category,
      commodityId: commodity.id,
      ...(commodity.materialKey ? { materialKey: commodity.materialKey } : {}),
      ...(input.propertyId ? { custody: { kind: "property", propertyId: input.propertyId } } : {}),
    };
  } else {
    holding = table.holdings.find((h) => h.id === input.holdingId);
    if (
      !holding ||
      holding.kind !== "item" ||
      holding.purseId !== payer.id ||
      holding.service ||
      holding.reservedFor ||
      holding.custody?.kind === "transit" ||
      holding.quantity < input.quantity ||
      holding.commodityId !== commodity.id
    )
      throw Error("Sell an owned, unreserved lot explicitly linked to this commodity.");
    if (holding.custody) {
      const { site } = storage(table, seat, holding.custody.propertyId, manager?.locationId);
      if (site.withdrawalApproval && seat.role !== "dm")
        throw Error("This store requires withdrawal approval before a player can sell its goods.");
    } else if (manager)
      throw Error("Managers can sell only goods physically stored at their property.");
    if (offer.stock + input.quantity > offer.capacity)
      throw Error("The exchange has insufficient storage capacity.");
    if (toCopper(treasury.coins) < total)
      throw Error("The exchange treasury cannot afford this purchase.");
    money(toCopper(payer.coins) + total);
  }
  const summary =
    `${exchange.name}: ${input.direction === "buy" ? "bought" : "sold"} ${input.quantity} ${commodity.unit} of ${commodity.name}`.slice(
      0,
      450,
    );
  move(
    table,
    payer.id,
    input.direction === "buy" ? -total : total,
    `${input.id}-owner`,
    summary,
    at,
    input.direction === "buy" ? "purchase" : "sale",
  );
  move(
    table,
    treasury.id,
    input.direction === "buy" ? total : -total,
    `${input.id}-treasury`,
    summary,
    at,
    "transfer",
  );
  if (input.direction === "buy") {
    offer.stock -= input.quantity;
    table.holdings.push(holding!);
  } else {
    offer.stock += input.quantity;
    if (holding!.quantity === input.quantity)
      table.holdings = table.holdings.filter((h) => h.id !== holding!.id);
    else holding!.quantity -= input.quantity;
  }
  economy.receipts.push({
    id: input.id,
    at,
    epoch: economy.epoch,
    exchangeId: exchange.id,
    commodityId: commodity.id,
    name: commodity.name,
    unit: commodity.unit,
    purseId: payer.id,
    direction: input.direction,
    quantity: input.quantity,
    copper: total,
    origin: manager ? "manager" : "exchange",
    ...(input.propertyId || holding?.custody?.propertyId
      ? { propertyId: input.propertyId ?? holding!.custody!.propertyId }
      : {}),
  });
  table.journal!.tradeEconomy = economy;
  return total;
}

export function recordShopTrade(
  table: CloudTable,
  input: {
    id: string;
    at: number;
    stockId: string;
    purseId: string;
    direction: "buy" | "sell";
    quantity: number;
    copper: number;
  },
) {
  const economy = table.journal?.tradeEconomy;
  const stock = table.stock.find((s) => s.id === input.stockId);
  const commodity = economy?.commodities.find((c) => c.id === stock?.commodityId);
  if (!economy?.settings.enabled || !stock?.tradeExchangeId || !commodity) return;
  economy.receipts.push({
    id: input.id,
    at: input.at,
    epoch: economy.epoch,
    exchangeId: stock.tradeExchangeId,
    commodityId: commodity.id,
    name: commodity.name,
    unit: commodity.unit,
    purseId: input.purseId,
    direction: input.direction,
    quantity: input.quantity,
    copper: input.copper,
    origin: "shop",
  });
}

export function applyTradeCommand(
  table: CloudTable,
  seat: CloudSeat,
  cmd: TradeCommand,
  at: number,
  execution: TradeExecution,
) {
  const journal = table.journal!;
  const economy = readTradeEconomy(journal.tradeEconomy);
  journal.tradeEconomy = economy;
  const dm = () => {
    if (seat.role !== "dm")
      throw Error("Only the DM can configure or settle the campaign economy.");
  };
  const conflict = () => {
    throw Error("The economy changed. Review fresh values before saving.");
  };
  if (cmd.kind === "trade-buy" || cmd.kind === "trade-sell") {
    const purseId =
      cmd.kind === "trade-buy"
        ? cmd.purseId
        : table.holdings.find((h) => h.id === cmd.holdingId)?.purseId;
    if (!purseId) throw Error("The goods owner is missing.");
    executeExchange(
      table,
      seat,
      { ...cmd, purseId, direction: cmd.kind === "trade-buy" ? "buy" : "sell" },
      at,
    );
  } else {
    dm();
    if (cmd.kind === "trade-settings") {
      if (!same(economy.settings, cmd.before)) conflict();
      economy.settings = cmd.settings;
    } else if (cmd.kind === "trade-commodity") {
      const prior = economy.commodities.find((c) => c.id === cmd.commodity.id) ?? null;
      if (!same(prior, cmd.before)) conflict();
      if (
        prior &&
        (prior.unit !== cmd.commodity.unit || prior.materialKey !== cmd.commodity.materialKey) &&
        (economy.receipts.some((r) => r.commodityId === prior.id) ||
          table.holdings.some((h) => h.commodityId === prior.id))
      )
        throw Error(
          "A traded commodity's unit and material identity are permanent. Create a new commodity for a different unit.",
        );
      economy.commodities = [
        ...economy.commodities.filter((c) => c.id !== cmd.commodity.id),
        cmd.commodity,
      ];
    } else if (cmd.kind === "trade-exchange") {
      const prior = economy.exchanges.find((e) => e.id === cmd.exchange.id) ?? null;
      if (!same(prior, cmd.before)) conflict();
      if (prior && prior.purseId !== cmd.exchange.purseId)
        throw Error("Retain the exchange's original treasury.");
      if (cmd.treasury) {
        if (prior || table.purses.some((p) => p.id === cmd.exchange.purseId))
          throw Error("Create an exchange treasury only once with a new account ID.");
        table.purses.push({
          id: cmd.exchange.purseId,
          name: cmd.treasury.name,
          kind: "character",
          control: "npc",
          nonParty: true,
          coins: fromCopper(0),
        });
        move(
          table,
          cmd.exchange.purseId,
          cmd.treasury.copper,
          `${cmd.id}-funding`,
          `DM exchange opening funds: ${cmd.reason}`,
          at,
          "adjustment",
        );
      }
      economy.exchanges = [
        ...economy.exchanges.filter((e) => e.id !== cmd.exchange.id),
        cmd.exchange,
      ];
    } else if (cmd.kind === "trade-funding") {
      const exchange = economy.exchanges.find((e) => e.id === cmd.exchangeId);
      const purse = table.purses.find((p) => p.id === exchange?.purseId);
      if (!purse || toCopper(purse.coins) !== cmd.beforeCopper) conflict();
      move(
        table,
        purse!.id,
        cmd.copper - cmd.beforeCopper,
        `${cmd.id}-funding`,
        `DM exchange funding: ${cmd.reason}`,
        at,
        "adjustment",
      );
    } else if (cmd.kind === "trade-bind") {
      const holding = table.holdings.find((h) => h.id === cmd.holdingId);
      const commodity = economy.commodities.find((c) => c.id === cmd.commodityId);
      if (
        !holding ||
        holding.kind !== "item" ||
        holding.service ||
        holding.reservedFor ||
        holding.custody?.kind === "transit" ||
        !commodity ||
        (holding.commodityId ?? null) !== cmd.before
      )
        conflict();
      if (holding!.materialKey && holding!.materialKey !== commodity!.materialKey)
        throw Error("Goods must retain their reviewed construction material identity.");
      holding!.commodityId = commodity!.id;
      if (commodity!.materialKey) holding!.materialKey = commodity!.materialKey;
      if (holding!.weight === undefined) holding!.weight = commodity!.weight;
    } else if (cmd.kind === "trade-stock-link") {
      const stock = table.stock.find((s) => s.id === cmd.stockId);
      if (stock?.service && cmd.commodityId)
        throw Error("Services cannot be linked to physical trade commodities.");
      if (
        !stock ||
        canonicalJson([stock.tradeExchangeId ?? null, stock.commodityId ?? null]) !== cmd.before
      )
        conflict();
      if (!!cmd.exchangeId !== !!cmd.commodityId)
        throw Error("Select both an exchange and a commodity, or clear both.");
      if (cmd.exchangeId) {
        stock!.tradeExchangeId = cmd.exchangeId;
        stock!.commodityId = cmd.commodityId!;
      } else {
        delete stock!.tradeExchangeId;
        delete stock!.commodityId;
      }
    } else if (cmd.kind === "trade-season-plan") {
      if (cmd.before !== tradeSeasonFingerprint(table)) conflict();
      if (journal.finance?.downtime.some((d) => d.status === "pending"))
        throw Error("Cancel pending downtime before preparing a separate manual season.");
      prepareTradeSeason(table, execution);
      economy.pendingSeason = previewTradeSeason(table, cmd.id, cmd.season);
    } else if (cmd.kind === "trade-season-cancel") {
      if (economy.pendingSeason?.id !== cmd.previewId) conflict();
      delete economy.pendingSeason;
    } else if (cmd.kind === "trade-season-approve") {
      const preview = economy.pendingSeason;
      if (!preview || preview.id !== cmd.previewId) conflict();
      if (journal.finance?.downtime.some((d) => d.status === "pending"))
        throw Error("Cancel pending downtime before manually settling a season.");
      applyTradeSeason(table, preview!, at, journal.finance?.day ?? 0, "manual", cmd.reason, cmd);
    }
    journal.events.push({
      id: cmd.id + "-event",
      at,
      kind: "management",
      dmOnly: true,
      summary: `Campaign economy: ${"reason" in cmd ? cmd.reason : cmd.kind}`.slice(0, 500),
    });
  }
  validateTradeEconomy(table);
}
