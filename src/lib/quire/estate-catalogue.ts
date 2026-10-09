import type { EstateTemplate } from "./estate-schema.ts";
type Category = [
  string,
  string,
  EstateTemplate["propertyType"],
  EstateTemplate["capabilities"],
  string?,
];
export const ESTATE_CATALOGUE: Category[] = [
  ["land", "Land plot", "land", ["construction-site"]],
  ["house", "Cottage or house", "residence", ["storage", "rental"]],
  ["manor", "Townhouse or manor", "residence", ["storage", "rental", "administration"]],
  [
    "apartments",
    "Boarding house or apartments",
    "residence",
    ["storage", "rental", "lodging"],
    "caretaker",
  ],
  ["warehouse", "Warehouse or lockup", "other", ["storage"]],
  ["granary", "Granary or storehouse", "other", ["storage", "trade"], "storekeeper"],
  ["vault", "Secure vault", "other", ["storage", "defense"], "custodian"],
  ["farm", "Farm or homestead", "homestead", ["storage", "farming"], "farmhand"],
  ["orchard", "Orchard or herb garden", "homestead", ["storage", "farming"], "gardener"],
  [
    "sawmill",
    "Logging camp or sawmill",
    "workshop",
    ["storage", "extraction", "crafting"],
    "woodworker",
  ],
  ["mine", "Quarry or mine", "other", ["storage", "extraction"], "miner"],
  ["workshop", "Workshop or carpenter's shop", "workshop", ["storage", "crafting"], "artisan"],
  ["forge", "Forge or smithy", "workshop", ["storage", "crafting"], "smith"],
  [
    "laboratory",
    "Apothecary or laboratory",
    "workshop",
    ["storage", "crafting", "research"],
    "apothecary",
  ],
  ["trading-house", "Shop or trading house", "other", ["storage", "trade"], "clerk"],
  ["tavern", "Tavern", "inn", ["storage", "trade"], "innkeeper"],
  ["inn", "Inn", "inn", ["storage", "lodging", "rental"], "innkeeper"],
  ["stable", "Stable", "other", ["storage", "stabling"], "stablehand"],
  ["dock", "Dock or boathouse", "other", ["storage", "transport"], "dockhand"],
  [
    "library",
    "Library, scriptorium or school",
    "other",
    ["storage", "research", "training"],
    "scholar",
  ],
  ["temple", "Shrine, temple or infirmary", "other", ["storage", "healing"], "attendant"],
  [
    "guildhall",
    "Guildhall or estate office",
    "other",
    ["storage", "administration", "training"],
    "steward",
  ],
  [
    "post-office",
    "Post office or courier station",
    "other",
    ["postal", "transport"],
    "postal clerk",
  ],
  [
    "keep",
    "Barracks, watchtower, keep or castle",
    "keep",
    ["storage", "defense", "administration"],
    "guard",
  ],
];
/** These are capability presets. Prices, yields, recipes and active contracts remain DM decisions. */
export function estatePreset(key: string): EstateTemplate {
  const row = ESTATE_CATALOGUE.find((r) => r[0] === key) ?? ESTATE_CATALOGUE[0];
  return {
    key: row[0],
    name: row[1],
    propertyType: row[2],
    capabilities: row[3],
    ...(row[3].includes("storage")
      ? {
          storage: {
            defaultAccess: key === "warehouse" ? "party-members" : "owner",
            capacityWeight: null,
          },
        }
      : {}),
    ...(row[3].includes("rental")
      ? { rental: { incomeCopper: 0, upkeepCopper: 0, periodDays: 30 } }
      : {}),
    staff: [
      ...(row[4]
        ? [
            {
              role: row[4],
              minimum: 1,
              wageCopper: 0,
              periodDays: 1,
              purpose: "operation" as const,
            },
          ]
        : []),
      { role: "manager", minimum: 1, wageCopper: 0, periodDays: 1, purpose: "automation" },
    ],
    recipes: [],
  };
}
