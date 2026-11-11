export type Coins = {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
};

export type Purse = {
  /** Canonical account for a location NPC, excluded from party membership. */
  nonParty?: boolean;
  sheet?: import("../characters/model.mjs").PlaySheet;
  sheetRevision?: number;
  editingAllowed?: boolean;
  permissions?: Partial<
    Record<import("../characters/permissions.mjs").CharacterPermission, boolean>
  >;
  editBaseline?: import("../characters/model.mjs").PlaySheet;
  profileId?: string;
  sheetReadOnlyForDm?: boolean;
  rolls?: Array<
    ReturnType<typeof import("../characters/campaign-roll.mjs").makeCampaignRoll> & {
      seq: number;
      at: number;
    }
  >;
  portrait?: string;
  id: string;
  name: string;
  kind: "party" | "character";
  /** Character only. Missing means a player character, so older saves stay usable. */
  control?: "player" | "npc";
  coins: Coins;
  /** Character only: the DM's attunement limit, 0 to 10 (attunement.ts). Absent: 3. */
  attunementLimit?: number;
};

export function characterControl(purse: Purse): "player" | "npc" | null {
  if (purse.kind !== "character") return null;
  return purse.control === "npc" ? "npc" : "player";
}

export type Holding = {
  /**
   * Item identification (phase 5): while present, everyone but the DM is told this presented
   * record in place of the true name, notes and value (item-identity.ts). Absent: identified.
   */
  unidentified?: import("./item-identity.ts").Unidentified;
  /** Items only: the attunement requirement's text, e.g. "Requires attunement: by a wizard" (attunement.ts). */
  requiresAttunement?: string;
  /** The holding character is attuned to this item (one of a stack). Changed only by item-attune. */
  attuned?: true;
  /** Charges or uses of the current item (loot phase 5, item-uses.ts). Absent: not tracked. */
  uses?: import("./item-uses.ts").HoldingUses;
  /** In the party treasure pool (a party-fund holding the party can claim). Absent otherwise. */
  pool?: import("./loot-claims-schema.ts").LootPoolMarker;
  /** "player": a player set this value through a sheet edit, so NPC barter treats it as unreferenced. */
  valueSource?: "player";
  commodityId?: string;
  custody?: import("./estate-schema.ts").zCustody;
  materialKey?: string;
  reservedFor?: string;
  deed?: import("./property-deed.ts").PropertyDeed;
  locationId?: string;
  property?: import("./property.ts").PropertyProfile;
  service?: boolean;
  weight?: number;
  equipped?: boolean;
  image?: string;
  category?: string;
  id: string;
  purseId: string;
  name: string;
  kind: "item" | "property";
  quantity: number;
  unitCopper: number;
  notes: string;
};

export type Wealth = "poor" | "modest" | "rich" | "princely";

export type ItemRarity = "common" | "uncommon" | "rare" | "magic";

export type ItemCategory =
  | "provisions"
  | "smith"
  | "cloth"
  | "apothecary"
  | "inn"
  | "general"
  | "curios"
  | "stable"
  | "scribe"
  | "jewels";

export type ShopCategory = ItemCategory | "mixed";

export type Shop = {
  blackMarket?: boolean;
  blackMarketPremium?: number;
  locationId?: string;
  schedule?: import("./shop-schedule.ts").ShopSchedule;
  acceptedCategories?: string[];
  acceptAnyCategory?: boolean;
  /** Merchant purse (merchant.ts): whole copper the shop can pay out. Unset = unlimited. DM-only unless `showPurse`. */
  merchantPurse?: number;
  /** Restock tops the purse up to this amount (never reduces it). DM-only unless `showPurse`. */
  merchantPurseRefill?: number;
  /** "Show the shop's purse to players" (off by default). */
  showPurse?: boolean;
  /** The most the shop pays for one item, in whole copper (PF1-style purchase limit). */
  purchaseLimit?: number;
  /** Buys categories outside its buy list at this % (1–100) of its normal buy rate; 0/unset refuses them. */
  offListPercent?: number;
  /** Player projection only: the shop has a purse the DM keeps hidden. */
  purseLimited?: boolean;
  /** Player projection only: whether the hidden purse covers each readable lot. */
  merchantAffords?: Record<string, "all" | "some" | "none">;
  closed?: boolean;
  image?: string;
  id: string;
  name: string;
  keeper: string;
  place: string;
  notes: string;
  sellRate: number;
  buyRate: number;
  wealth: Wealth;
  category: ShopCategory;
  priceScale: number;
};

export type StockLine = {
  commodityId?: string;
  tradeExchangeId?: string;
  service?: boolean;
  category?: string;
  id: string;
  shopId: string;
  name: string;
  copper: number;
  quantity: number | null;
  notes: string;
  baseCopper: number;
  rarity: ItemRarity;
};

export type CatalogItem = {
  id: string;
  name: string;
  category: ItemCategory;
  rarity: ItemRarity;
  baseCopper: number;
  notes: string;
  origin: "stock" | "hand" | "pdf" | "open5e";
  service: boolean;
};

export type LexemeKind = "person" | "place" | "shop" | "continent" | "country" | "region";

export type Lexeme = {
  id: string;
  name: string;
  kind: LexemeKind;
  bookId: string;
  notes: string;
};

export type RealmSettings = {
  inflation: number;
  scarcity: number;
  gpDollars: number;
  season: number;
  shortage: number;
  war: number;
  plague: number;
  roads: number;
};

export type LedgerLine = {
  transactionType?: "transfer" | "purchase" | "sale" | "loan" | "payment" | "adjustment" | "void";
  reversalOf?: string;
  trade?: { receiptId: string; leg: "owner" | "treasury" };
  purchase?: { stockId: string; quantity: number; holding: Holding | null };
  listingPurchase?: { listingId: string; quantity: number; holding: Holding };
  /** Even coin split: every line of one split carries the same split ID (the command or award receipt ID). */
  split?: { id: string; role: "source" | "share" | "remainder"; keptShare?: number };
  /** Treasure pool: a 0 cp line per item moved or pooled, with its recorded value (one resolution or award ID). */
  loot?: import("./loot-claims-schema.ts").LootLedgerLink;
  /** Encounter award (phase 3): the award receipt and the value the DM reviewed. Absent on older lines. */
  award?: import("./award-tag.ts").AwardTag;
  /**
   * Hidden activity lines (B1 follow-up): the DM traded at a shop this purse's players could not
   * see. Players read the shop as "a merchant" while it stays out of their view (session-records.ts).
   */
  hiddenShop?: true;
  id: string;
  at: number;
  purseId: string;
  shopId: string | null;
  summary: string;
  copper: number;
};

export type Book = {
  id: string;
  title: string;
  fileName: string;
  pageCount: number;
  articleCount: number;
  importedAt: number;
};

export type Article = {
  id: string;
  bookId: string;
  title: string;
  text: string;
  pageStart: number;
  pageEnd: number;
  favorite: boolean;
};

export type DraftArticle = {
  title: string;
  text: string;
  pageStart: number;
  pageEnd: number;
};
