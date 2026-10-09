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
};

export function characterControl(purse: Purse): "player" | "npc" | null {
  if (purse.kind !== "character") return null;
  return purse.control === "npc" ? "npc" : "player";
}

export type Holding = {
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
  purchase?: { stockId: string; quantity: number; holding: Holding | null };
  listingPurchase?: { listingId: string; quantity: number; holding: Holding };
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
