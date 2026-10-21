// Synthetic "Wayfarers" campaign for product screenshots. Every name, place and
// amount is invented. The history is produced by the real command engine
// (applyCommand) so balances, ledger lines, session reports, trade seasons and
// receipts are the same records actual play creates. Disposable servers only.
import { applyCommand } from "../src/lib/quire/commands.ts";
import { emptyCloudTable, readCloudTable } from "../src/lib/quire/cloud.ts";
import { readJournal } from "../src/lib/quire/journal.ts";
import { readTradeEconomy } from "../src/lib/quire/trade-economy-schema.ts";
import { readEstate } from "../src/lib/quire/estate-schema.ts";
import { exchangeQuoteKey, tradeSeasonFingerprint } from "../src/lib/quire/trade-economy.ts";
import { DEFAULT_REALM } from "../src/lib/quire/scale.ts";
import { fromCopper } from "../src/lib/quire/money.ts";
import { blankSheet } from "../src/lib/characters/model.mjs";
import { makeCampaignRoll } from "../src/lib/characters/campaign-roll.mjs";

const dm = { id: "local", token: "", name: "Dungeon master", role: "dm", purseIds: [] };
const player = (purseId) => ({ id: `seat-${purseId}`, token: "", name: purseId, role: "player", purseIds: [purseId] });

/** Deterministic dice/season entropy so every capture shows the same campaign. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s % 100) + 1;
  };
}

const characters = [
  {
    id: "mira",
    name: "Mira Ashfall",
    species: "Wood elf",
    classes: "Ranger (Gloom Stalker)",
    background: "Outlander",
    scores: { str: 12, dex: 18, con: 14, int: 10, wis: 15, cha: 8 },
    hp: 38, maxHp: 44, ac: 16, speed: "35 ft",
    coins: 18420,
    attacks: [
      { name: "Longbow", bonus: 8, damage: "1d8+4", notes: "Range 150/600" },
      { name: "Shortsword", bonus: 7, damage: "1d6+4", notes: "Finesse, light" },
    ],
    skills: { Perception: 1, Stealth: 1, Survival: 1, Nature: 1 },
    saves: ["str", "dex"],
    slots: [{ level: 1, max: 4, used: 1 }, { level: 2, max: 2, used: 0 }],
    spells: [
      { name: "Hunter's Mark", level: 1 },
      { name: "Goodberry", level: 1 },
      { name: "Pass without Trace", level: 2 },
    ],
    resources: [{ name: "Dread Ambusher", max: 1, current: 1, recovery: "long" }],
    features: "Favored foe: aberrations. Umbral sight. Dread ambusher.",
    items: [
      ["Longbow", 1, 5000, 2, "smith", true],
      ["Studded leather armour", 1, 4500, 13, "smith", true],
      ["Arrows", 40, 5, 0.05, "smith", false],
      ["Potion of healing", 2, 5000, 0.5, "apothecary", false],
      ["Hooded lantern", 1, 500, 2, "general", false],
    ],
  },
  {
    id: "bram",
    name: "Bram Stoneward",
    species: "Hill dwarf",
    classes: "Fighter (Battle Master)",
    background: "Soldier",
    scores: { str: 18, dex: 10, con: 16, int: 10, wis: 12, cha: 9 },
    hp: 47, maxHp: 52, ac: 18, speed: "25 ft",
    coins: 14180,
    attacks: [
      { name: "Warhammer", bonus: 7, damage: "1d8+4", notes: "Versatile (1d10)" },
      { name: "Heavy crossbow", bonus: 3, damage: "1d10", notes: "Range 100/400" },
    ],
    skills: { Athletics: 1, Intimidation: 1 },
    saves: ["str", "con"],
    slots: [],
    spells: [],
    resources: [
      { name: "Superiority dice (d8)", max: 4, current: 3, recovery: "short" },
      { name: "Action Surge", max: 1, current: 1, recovery: "short" },
      { name: "Second Wind", max: 1, current: 0, recovery: "short" },
    ],
    features: "Maneuvers: riposte, trip attack, rally. Dwarven resilience.",
    items: [
      ["Warhammer", 1, 1500, 2, "smith", true],
      ["Chain mail", 1, 7500, 55, "smith", true],
      ["Shield", 1, 1000, 6, "smith", true],
      ["Hempen rope (50 ft)", 1, 100, 10, "general", false],
      ["Dwarven ale", 3, 40, 1, "inn", false],
    ],
  },
  {
    id: "rowan",
    name: "Rowan Vale",
    species: "Human",
    classes: "Wizard (Divination)",
    background: "Sage",
    scores: { str: 8, dex: 14, con: 13, int: 18, wis: 12, cha: 11 },
    hp: 24, maxHp: 29, ac: 12, speed: "30 ft",
    coins: 12590,
    attacks: [{ name: "Quarterstaff", bonus: 1, damage: "1d6-1", notes: "Versatile" }],
    skills: { Arcana: 1, History: 1, Investigation: 1 },
    saves: ["int", "wis"],
    slots: [{ level: 1, max: 4, used: 2 }, { level: 2, max: 3, used: 1 }, { level: 3, max: 2, used: 0 }],
    spells: [
      { name: "Fire Bolt", level: 0 },
      { name: "Shield", level: 1 },
      { name: "Misty Step", level: 2 },
      { name: "Fireball", level: 3 },
      { name: "Counterspell", level: 3 },
    ],
    resources: [{ name: "Portent", max: 2, current: 1, recovery: "long" }],
    features: "Portent dice: 14, 3. Arcane recovery.",
    items: [
      ["Spellbook", 1, 5000, 3, "scribe", true],
      ["Component pouch", 1, 2500, 2, "apothecary", true],
      ["Scroll of identify", 1, 3000, 0, "scribe", false],
      ["Ink and quills", 1, 1000, 0, "scribe", false],
    ],
  },
  {
    id: "tamsin",
    name: "Tamsin Reed",
    species: "Lightfoot halfling",
    classes: "Rogue (Thief)",
    background: "Urchin",
    scores: { str: 8, dex: 18, con: 12, int: 13, wis: 10, cha: 14 },
    hp: 31, maxHp: 33, ac: 15, speed: "25 ft",
    coins: 21275,
    attacks: [
      { name: "Rapier", bonus: 7, damage: "1d8+4", notes: "Finesse" },
      { name: "Hand crossbow", bonus: 7, damage: "1d6+4", notes: "Range 30/120" },
    ],
    skills: { "Sleight of Hand": 2, Stealth: 2, Acrobatics: 1, Deception: 1 },
    saves: ["dex", "int"],
    slots: [],
    spells: [],
    resources: [{ name: "Lucky", max: 3, current: 3, recovery: "long" }],
    features: "Sneak attack 3d6. Cunning action. Fast hands.",
    items: [
      ["Rapier", 1, 2500, 2, "smith", true],
      ["Thieves' tools", 1, 2500, 1, "general", true],
      ["Caltrops", 1, 100, 2, "general", false],
      ["Silvered dagger", 1, 10200, 1, "smith", false],
    ],
  },
];

function sheetFor(c) {
  const sheet = {
    ...blankSheet(),
    name: c.name,
    species: c.species,
    classes: c.classes,
    background: c.background,
    level: 5,
    scores: c.scores,
    proficiency: 3,
    hp: c.hp,
    maxHp: c.maxHp,
    ac: c.ac,
    speed: c.speed,
    hitDice: c.id === "bram" ? "5d10" : c.id === "rowan" ? "5d6" : "5d8",
    spellAbility: c.id === "mira" ? "wis" : "int",
    attacks: c.attacks,
    slots: c.slots,
    resources: c.resources,
    features: c.features,
    spells: c.spells.map((s) => ({ ...s, prepared: true, description: "", formula: "", source: "" })),
  };
  sheet.saves = { ...sheet.saves };
  for (const key of c.saves) sheet.saves[key] = { rank: 1, extra: 0 };
  sheet.skills = { ...sheet.skills };
  for (const [key, rank] of Object.entries(c.skills)) sheet.skills[key] = { rank, extra: 0 };
  return sheet;
}

const stock = [
  // shop, id, name, copper, quantity, rarity, category
  ["lantern", "rations", "Trail rations (1 day)", 50, 60, "common", "provisions"],
  ["lantern", "rope", "Hempen rope (50 ft)", 100, 18, "common", "general"],
  ["lantern", "torches", "Torches (bundle of 5)", 5, 40, "common", "general"],
  ["lantern", "lantern", "Hooded lantern", 500, 6, "common", "general"],
  ["lantern", "bedroll", "Bedroll", 100, 9, "common", "general"],
  ["lantern", "climbing", "Climber's kit", 2500, 3, "uncommon", "general"],
  ["lantern", "healer", "Healer's kit", 500, 7, "common", "apothecary"],
  ["lantern", "potion", "Potion of healing", 5000, 8, "uncommon", "apothecary"],
  ["lantern", "antitoxin", "Antitoxin", 5000, 4, "uncommon", "apothecary"],
  ["lantern", "oil", "Flask of lamp oil", 10, 30, "common", "general"],
  ["forge", "longsword", "Longsword", 1500, 5, "common", "smith"],
  ["forge", "shield", "Shield", 1000, 6, "common", "smith"],
  ["forge", "chain", "Chain mail", 7500, 2, "common", "smith"],
  ["forge", "breastplate", "Breastplate", 40000, 1, "uncommon", "smith"],
  ["forge", "arrows", "Arrows (20)", 100, 25, "common", "smith"],
  ["forge", "silvered", "Silvered dagger", 10200, 2, "rare", "smith"],
];

const commodities = [
  ["timber", "Building timber", "bundle", "general", 100, 2],
  ["grain", "Golden grain", "sack", "provisions", 60, 1],
  ["iron", "Iron ingots", "ingot", "smith", 140, 1],
  ["wool", "Woven wool", "bolt", "cloth", 220, 1],
  ["herbs", "Healing herbs", "bundle", "apothecary", 180, 0.5],
  ["saltfish", "Salted fish", "barrel", "provisions", 90, 3],
  ["oil", "Lamp oil", "cask", "general", 120, 2],
  ["silver", "Silver filigree", "ounce", "jewels", 900, 0.1],
];

function offer(id, base, stock, target) {
  return {
    commodityId: id,
    stock,
    targetStock: target,
    capacity: target * 2,
    supply: 100,
    demand: 100,
    askCopper: base,
    bidCopper: Math.floor(base * 0.6),
  };
}

export function buildWayfarers({ now = Date.now() } = {}) {
  const realNow = Date.now;
  let clock = now - 16 * 86400000; // trade history starts sixteen days ago
  Date.now = () => clock;
  const tick = (minutes) => (clock += minutes * 60000);
  const random = seeded(20261021);
  const run = (table, seat, command, minutes = 7) => {
    tick(minutes);
    return applyCommand(table, seat, { id: crypto.randomUUID(), ...command }, { source: "local", random: () => random() });
  };
  try {
    let t = {
      ...emptyCloudTable(),
      realm: { ...DEFAULT_REALM },
      purses: [
        { id: "party", name: "The Wayfarers’ purse", kind: "party", coins: { cp: 40, sp: 120, ep: 0, gp: 1186, pp: 12 } },
        ...characters.map((c) => ({ id: c.id, name: c.name, kind: "character", coins: fromCopper(c.coins), sheet: sheetFor(c) })),
        { id: "exchange-brackenport", name: "Brackenport Exchange treasury", kind: "character", nonParty: true, control: "npc", coins: fromCopper(900000) },
        { id: "exchange-gullhaven", name: "Gullhaven Market Hall treasury", kind: "character", nonParty: true, control: "npc", coins: fromCopper(600000) },
      ],
      holdings: [
        ...characters.flatMap((c) =>
          c.items.map(([name, quantity, unitCopper, weight, category, equipped], i) => ({
            id: `${c.id}-item-${i}`,
            purseId: c.id,
            name,
            kind: "item",
            quantity,
            unitCopper,
            weight,
            category,
            equipped,
            notes: "",
          })),
        ),
        { id: "party-circlet", purseId: "party", name: "Sapphire circlet", kind: "item", quantity: 1, unitCopper: 25000, weight: 0.5, category: "jewels", notes: "Recovered from the Drowned Archive." },
        { id: "party-key", purseId: "party", name: "Tarnished bronze key", kind: "item", quantity: 1, unitCopper: 0, weight: 0.1, category: "curios", notes: "Opens something beneath the lighthouse." },
        { id: "party-tent", purseId: "party", name: "Two-person tent", kind: "item", quantity: 2, unitCopper: 200, weight: 20, category: "general", notes: "" },
        { id: "party-moonstone", purseId: "party", name: "Moonstone", kind: "item", quantity: 3, unitCopper: 5000, weight: 0, category: "jewels", notes: "" },
        { id: "storehouse", purseId: "party", name: "Lantern Wharf storehouse", kind: "property", quantity: 1, unitCopper: 120000, notes: "A stone warehouse on the Dock Ward wharf, bought with the Archive reward.", locationId: "dock-ward", property: { type: "other", condition: "maintained" } },
        { id: "cottage", purseId: "party", name: "Saltmarsh cottage", kind: "property", quantity: 1, unitCopper: 80000, notes: "Let to a ferry pilot and his family.", locationId: "brackenport", property: { type: "residence", condition: "ready" } },
        { id: "heron", purseId: "party", name: "The Gilded Heron", kind: "property", quantity: 1, unitCopper: 1000000, notes: "A two-masted coastal trader won at the harbour auction.", locationId: "brackenport", property: { type: "other" } },
      ],
      shops: [
        { id: "lantern", name: "The Brass Lantern", keeper: "Odile Marsh", place: "Dock Ward", locationId: "dock-ward", notes: "Outfitters for anyone heading upriver.", acceptAnyCategory: true, sellRate: 1, buyRate: 0.5, wealth: "modest", category: "general", priceScale: 1 },
        { id: "forge", name: "Ironroot Forge", keeper: "Haldren Ironroot", place: "Brackenport", locationId: "brackenport", notes: "Weapons, armour and honest repairs.", sellRate: 1, buyRate: 0.5, wealth: "rich", category: "smith", priceScale: 1 },
      ],
      stock: stock.map(([shopId, id, name, copper, quantity, rarity, category]) => ({
        id: `${shopId}-${id}`,
        shopId,
        name,
        copper,
        baseCopper: copper,
        quantity,
        rarity,
        category,
        notes: "",
      })),
      journal: readJournal({
        sessions: [],
        requests: [],
        events: [],
        market: {
          currentLocationId: "dock-ward",
          locations: [
            { id: "eastmarch", name: "Eastmarch", kind: "region", parentId: null, description: "Salt marshes, river trade and old drowned ruins." },
            { id: "brackenport", name: "Brackenport", kind: "city", parentId: "eastmarch", description: "A busy river port at the mouth of the Bracken." },
            { id: "dock-ward", name: "Dock Ward", kind: "area", parentId: "brackenport", description: "Warehouses, chandlers and a dozen taverns." },
            { id: "gullhaven", name: "Gullhaven", kind: "city", parentId: "eastmarch", description: "A fishing town two days down the coast." },
          ],
        },
        finance: { day: 42, loans: [], rules: [], downtime: [] },
        propertyOperations: readEstate({
          materials: [
            { key: "timber", name: "Building timber", unit: "bundle" },
            { key: "oil", name: "Lamp oil", unit: "cask" },
          ],
          templates: [
            { key: "warehouse", name: "Wharf warehouse", propertyType: "other", capabilities: ["storage", "trade", "crafting"], storage: { defaultAccess: "party-members", capacityWeight: 4000 },
              staff: [{ role: "porter", minimum: 1, wageCopper: 200, periodDays: 1, purpose: "operation" }, { role: "manager", minimum: 1, wageCopper: 50, periodDays: 1, purpose: "automation" }] },
            { key: "cottage", name: "Rented cottage", propertyType: "residence", capabilities: ["storage", "rental"], storage: { defaultAccess: "owner", capacityWeight: 600 },
              rental: { incomeCopper: 5000, upkeepCopper: 1000, periodDays: 30 } },
          ],
          sites: [
            { propertyId: "storehouse", templateKey: "warehouse", enabled: true, access: "party-members", accessPurseIds: [], capacityWeight: 4000, completedTemplates: [], notes: "Night watch paid by the harbour guild." },
            { propertyId: "cottage", templateKey: "cottage", enabled: true, access: "owner", accessPurseIds: [], capacityWeight: 600, completedTemplates: [], notes: "" },
          ],
          staff: [
            { id: "wenna", propertyId: "storehouse", name: "Wenna Hollis", role: "manager", wageCopper: 50, periodDays: 1, status: "active", manager: true, duties: ["supplies", "deliveries", "reports"], budgetCopper: 10000, budgetPeriodDays: 30, budgetStartDay: 30, budgetSpentCopper: 2350, notes: "Former quartermaster. Keeps meticulous tallies." },
            { id: "dunstan", propertyId: "storehouse", name: "Dunstan Pell", role: "porter", wageCopper: 200, periodDays: 1, status: "active", manager: false, duties: [], budgetCopper: 0, budgetPeriodDays: 30, budgetStartDay: 30, budgetSpentCopper: 0, notes: "" },
            { id: "ilsa", propertyId: "storehouse", name: "Ilsa Brann", role: "porter", wageCopper: 200, periodDays: 1, status: "proposed", manager: false, duties: [], budgetCopper: 0, budgetPeriodDays: 30, budgetStartDay: 42, budgetSpentCopper: 0, notes: "Wenna's suggestion for the busy season." },
          ],
        }),
        tradeEconomy: readTradeEconomy({
          settings: { enabled: true, mode: "automatic", volatility: 30, hardshipChance: 15 },
          commodities: commodities.map(([id, name, unit, category, baseCopper, weight]) => ({ id, name, unit, category, baseCopper, weight, description: "", active: true })),
          exchanges: [
            {
              id: "brackenport-exchange",
              name: "Brackenport Exchange",
              locationId: "brackenport",
              purseId: "exchange-brackenport",
              open: true,
              visible: true,
              notes: "River barges unload here every morning.",
              offers: commodities.map(([id, , , , base], i) => offer(id, base, 60 + i * 9, 100)),
            },
            {
              id: "gullhaven-hall",
              name: "Gullhaven Market Hall",
              locationId: "gullhaven",
              purseId: "exchange-gullhaven",
              open: true,
              visible: true,
              notes: "Fish, salt and whatever the tide brings in.",
              offers: commodities.slice(0, 6).map(([id, , , , base], i) => offer(id, Math.round(base * (i % 2 ? 1.15 : 0.9)), 40 + i * 7, 80)),
            },
          ],
        }),
      }),
    };

    // Ten settled trade seasons give the exchange board real price history.
    for (let season = 0; season < 10; season++) {
      t = run(t, dm, { kind: "trade-season-plan", before: tradeSeasonFingerprint(t), season: season % 4 }, 60 * 12);
      const preview = readTradeEconomy(t.journal.tradeEconomy).pendingSeason;
      t = run(t, dm, { kind: "trade-season-approve", previewId: preview.id, reason: `Season ${season + 1} market settlement` }, 5);
    }

    // Session 11 — finished and archived as a session report.
    clock = now - 4 * 86400000;
    t = run(t, dm, { kind: "session", name: "Session 11 · The Drowned Archive", end: false }, 0);
    t = run(t, dm, { kind: "buy", stockId: "lantern-rope", purseId: "bram", quantity: 1 });
    t = run(t, dm, { kind: "buy", stockId: "lantern-torches", purseId: "mira", quantity: 2 });
    t = run(t, dm, { kind: "buy", stockId: "lantern-healer", purseId: "rowan", quantity: 1 });
    t = run(t, dm, { kind: "give", fromId: "party", toId: "tamsin", copper: 1500, holdingId: null, quantity: 0 }, 40);
    t = run(t, dm, { kind: "sell", holdingId: "party-tent", shopId: "lantern", quantity: 1 }, 30);
    t = run(t, dm, { kind: "session", name: "Session 11 · The Drowned Archive", end: true }, 120);
    const archive = t.journal.reports.at(-1);

    // Session 12 — in progress. Rows here are the visible recent ledger.
    clock = now - 3 * 3600000;
    t = run(t, dm, { kind: "session", name: "Session 12 · Smugglers of Gullhaven", end: false }, 0);
    t = run(t, dm, { kind: "journal-note", title: "The Drowned Archive", visibility: "party", purseId: "", reportIds: [archive.id],
      text: "We followed the tide stairs beneath the old lighthouse and found the Archive half under water. Rowan read the warding glyphs while Tamsin disarmed the pressure plates. The drowned librarian guarded a sapphire circlet and a bronze key that none of us can place yet.\n\nWe sold a spare tent at the Brass Lantern and paid Tamsin back for the lockpicks she lost in the flooded stacks. Next: the smugglers who have been buying up lamp oil in Gullhaven." }, 10);
    t = run(t, dm, { kind: "journal-note", title: "Rumours from the Dock Ward", visibility: "party", purseId: "", reportIds: [],
      text: "Odile at the Brass Lantern says a ship called the Black Gull pays double for lamp oil and never asks for a receipt. The harbour master wants the Gilded Heron's mooring fees settled before the new moon." }, 5);
    // The party splits the Archive reward equally from the shared purse.
    for (const id of ["mira", "bram", "rowan", "tamsin"])
      t = run(t, dm, { kind: "give", fromId: "party", toId: id, copper: 4500, holdingId: null, quantity: 0 }, 1);
    // Standing finances that downtime settles: a guild loan, charter income and upkeep.
    t = run(t, dm, { kind: "finance-loan", principal: 40000,
      terms: { name: "Harbour guild loan", purseId: "party", lenderId: "", rateBps: 500, periodDays: 7, compound: false, payment: 5000 } }, 6);
    for (const [name, purseId, kind, copper, holdingId] of [
      ["Gilded Heron charter fees", "party", "income", 3200, "heron"],
      ["Heron mooring fees", "party", "expense", 700, "heron"],
      ["Archive library dues", "rowan", "expense", 250, ""],
      ["Tavern songs at the Salty Lamb", "tamsin", "income", 180, ""],
    ])
      t = run(t, dm, { kind: "finance-rule", rule: { id: crypto.randomUUID(), name, purseId, kind, copper, periodDays: 7, holdingId, active: true } }, 2);
    t = run(t, dm, { kind: "buy", stockId: "lantern-potion", purseId: "mira", quantity: 1 }, 25);
    t = run(t, dm, { kind: "buy", stockId: "lantern-rations", purseId: "tamsin", quantity: 4 });
    t = run(t, dm, { kind: "buy", stockId: "forge-arrows", purseId: "mira", quantity: 1 }, 12);
    t = run(t, dm, { kind: "trade-buy", exchangeId: "brackenport-exchange", commodityId: "oil", purseId: "bram", quantity: 6,
      before: exchangeQuoteKey(readTradeEconomy(t.journal.tradeEconomy), readTradeEconomy(t.journal.tradeEconomy).exchanges[0], readTradeEconomy(t.journal.tradeEconomy).commodities.find((c) => c.id === "oil")) }, 20);
    t = run(t, dm, { kind: "sell", holdingId: "rowan-item-2", shopId: "lantern", quantity: 1 }, 15);
    t = run(t, player("rowan"), { kind: "payment-request", purseId: "rowan", copper: 4500, note: "Ferry passage to Gullhaven for the whole party" }, 9);
    t = run(t, player("tamsin"), { kind: "loan", purseId: "tamsin", copper: 20000, note: "Advance to buy a forged harbour pass" }, 4);
    t = run(t, player("mira"), { kind: "message", to: "party", purseId: "mira", text: "Gullhaven by nightfall if the ferry runs. Everyone stocked on arrows and rations?" }, 3);
    t = run(t, player("bram"), { kind: "message", to: "party", purseId: "bram", text: "Six casks of lamp oil bought. If the smugglers want oil, they can come and ask me for it." }, 2);
    t = run(t, player("tamsin"), { kind: "message", to: "party", purseId: "tamsin", text: "I asked the DM for an advance on a harbour pass. Do not tell the harbour master." }, 2);
    t = run(t, player("rowan"), { kind: "message", to: "party", purseId: "rowan", text: "Requested the ferry fare from the party purse. The bronze key hums when the tide turns, by the way." }, 1);

    // Recent dice rolls on two sheets (real roll helper, deterministic totals).
    for (const [purseId, rolls] of [
      ["mira", [["attack", "0"], ["damage", "0"], ["skill", "Perception"], ["skill", "Stealth"], ["initiative", ""]]],
      ["rowan", [["save", "int"], ["skill", "Arcana"]]],
    ]) {
      const p = t.purses.find((x) => x.id === purseId);
      p.rolls = rolls.map(([kind, key], i) => ({
        ...makeCampaignRoll(p.sheet, { kind, key, revision: 0, requestKey: crypto.randomUUID() }, p.name, purseId, "device", true),
        seq: i + 1,
        at: tick(2),
      }));
    }
    const table = readCloudTable(t);
    if (!table) throw Error("The Wayfarers fixture did not validate.");
    return table;
  } finally {
    Date.now = realNow;
  }
}
