/**
 * Alternative shop lists (owner request 2026-11-10: "implement it as alternative shop lists that can
 * be assigned and swapped by the DM whenever they choose"): stored shapes, limits and the DM's
 * commands. Behaviour is in shop-lists.ts.
 *
 * The DM keeps a campaign-wide library of named stock lists ("Winter goods", "Post-siege") in
 * `journal.shopLists`, outside every strict schema like `journal.quests` and `journal.settlements`:
 * older clients' journal parser drops the key and `preserveJournalMetadata` keeps the stored copy
 * when they write the journal back. Stored lists are parsed with unknown keys stripped (not strict),
 * so a later field never breaks this reader. The library changes only through the commands below,
 * which shared rooms and the device run through the same `applyCommand`.
 *
 * A list item has the shape of a shop's stock line without its shop: name, price (`copper`), base
 * price, quantity (null = unlimited), notes, rarity, and the optional category, service flag and
 * trade-exchange link. `lineId` remembers the stock line an item was saved from, so swapping a saved
 * stock back restores the same lines (purchase undo and property suppliers keep working).
 */
import { z } from "zod";
import { estateKey } from "./estate-schema.ts";
import type { ItemRarity } from "./types.ts";

const id = z.string().min(1).max(150);
const copper = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const rarities = ["common", "uncommon", "rare", "magic"] as const satisfies readonly ItemRarity[];

/** Limits (docs/FOOTPRINT.md): the library is DM-only data in the live campaign. */
export const MAX_SHOP_LISTS = 60;
export const MAX_SHOP_LIST_ITEMS = 200;
/** All lists together, so the library stays well inside one feature's 10% share (400 KB). */
export const MAX_SHOP_LIST_LIBRARY_ITEMS = 2000;
/** The stored library's size as JSON (characters); about half of one feature's share. */
export const MAX_SHOP_LIST_LIBRARY_BYTES = 200_000;
export const MAX_SHOP_LIST_NAME = 80;
export const MAX_SHOP_LIST_NOTE = 500;
export const MAX_SHOP_LIST_ITEM_NAME = 200;
export const MAX_SHOP_LIST_ITEM_NOTES = 4000;

export const shopListItemSchema = z.object({
  name: z.string().trim().min(1, "Every item needs a name.").max(MAX_SHOP_LIST_ITEM_NAME),
  /** The shop's price for one, whole copper (a price override is simply this value). */
  copper,
  /** The catalog base price, whole copper. */
  baseCopper: copper,
  /** How many the shop stocks when the list is swapped in; null = unlimited. */
  quantity: copper.nullable(),
  notes: z.string().max(MAX_SHOP_LIST_ITEM_NOTES),
  rarity: z.enum(rarities),
  category: z.string().max(80).optional(),
  service: z.boolean().optional(),
  commodityId: estateKey.optional(),
  tradeExchangeId: id.optional(),
  /** The stock line this item was saved from; reused on swap when that ID is free. */
  lineId: id.optional(),
});
export type ShopListItem = z.infer<typeof shopListItemSchema>;

/** What the DM edits: a name, an optional note and the items. */
export const shopListContentSchema = z.object({
  name: z.string().trim().min(1, "Give the list a name.").max(MAX_SHOP_LIST_NAME),
  note: z.string().trim().max(MAX_SHOP_LIST_NOTE).optional(),
  items: z
    .array(shopListItemSchema)
    .max(MAX_SHOP_LIST_ITEMS, `A shop list holds at most ${MAX_SHOP_LIST_ITEMS} items.`),
});
export type ShopListContent = z.infer<typeof shopListContentSchema>;

export const shopListSchema = shopListContentSchema.extend({ id });
export type ShopList = z.infer<typeof shopListSchema>;

export const shopListsSchema = z.object({
  lists: z.array(shopListSchema).default([]),
  /** Shop ID → the list last swapped into it (DM-only). Missing = none. */
  active: z.record(id, id).optional(),
});
export type ShopLists = z.infer<typeof shopListsSchema>;

/** Short fingerprints of what the DM saw (shop-lists.ts `listFingerprint`, `stockFingerprint`). */
const fingerprint = z.string().min(1).max(40);

export const shopListCommands = [
  /**
   * DM: create a list (`before` null; `listId` new) or edit, rename or re-note one (`before` is the
   * fingerprint of the list the DM edited from; a change made elsewhere refuses the command).
   */
  z
    .object({
      id,
      kind: z.literal("shop-list-save"),
      listId: id,
      before: fingerprint.nullable(),
      list: shopListContentSchema.strict(),
    })
    .strict(),
  /** DM: delete a list. Shops keep their stock; a shop that used it no longer names a list. */
  z
    .object({ id, kind: z.literal("shop-list-delete"), listId: id, before: fingerprint })
    .strict(),
  /**
   * DM: save a shop's current stock as a new list (its ID is the command ID). `before` is the
   * fingerprint of the stock the DM saw.
   */
  z
    .object({
      id,
      kind: z.literal("shop-list-capture"),
      shopId: id,
      before: fingerprint,
      name: z.string().trim().min(1, "Give the list a name.").max(MAX_SHOP_LIST_NAME),
    })
    .strict(),
  /**
   * DM: swap a shop's stock to a list, all or nothing. The shop's stock lines become the list's
   * items and quantities, and the outgoing stock is saved as a new list named `savedName` (unless
   * it is empty or a list already holds exactly those items). `before` and `listBefore` are the
   * fingerprints of the stock and list the DM confirmed.
   */
  z
    .object({
      id,
      kind: z.literal("shop-list-swap"),
      shopId: id,
      listId: id,
      before: fingerprint,
      listBefore: fingerprint,
      savedName: z.string().trim().min(1).max(MAX_SHOP_LIST_NAME),
    })
    .strict(),
] as const;
export type ShopListCommand = z.infer<(typeof shopListCommands)[number]>;
export const shopListKinds: ReadonlySet<string> = new Set(shopListCommands.map((c) => c.shape.kind.value));
