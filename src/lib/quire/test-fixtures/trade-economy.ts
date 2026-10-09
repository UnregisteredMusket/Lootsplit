import { emptyCloudTable, type CloudTable } from "../cloud.ts";
import { fromCopper } from "../money.ts";
import { readJournal } from "../journal.ts";
import { readEstate } from "../estate-schema.ts";
import { readTradeEconomy } from "../trade-economy-schema.ts";
import { DEFAULT_REALM } from "../scale.ts";

/** Disposable campaign only; shared by the economic engine and room persistence tests. */
export function tradeFixture(): CloudTable {
  return {
    ...emptyCloudTable(),
    realm: { ...DEFAULT_REALM },
    purses: [
      { id: "a", name: "Arden", kind: "character", coins: fromCopper(100000) },
      { id: "b", name: "Briar", kind: "character", coins: fromCopper(100000) },
      { id: "party", name: "Party treasury", kind: "party", coins: fromCopper(100000) },
      {
        id: "exchange-treasury",
        name: "Harbor exchange treasury",
        kind: "character",
        nonParty: true,
        control: "npc",
        coins: fromCopper(50000),
      },
    ],
    holdings: [
      {
        id: "warehouse",
        name: "Harbor Warehouse",
        kind: "property",
        purseId: "a",
        quantity: 1,
        unitCopper: 10000,
        notes: "Synthetic warehouse",
        locationId: "port",
        property: { type: "other", condition: "maintained" },
      },
    ],
    journal: readJournal({
      sessions: [],
      requests: [],
      events: [],
      market: {
        currentLocationId: "dock",
        locations: [
          { id: "coast", name: "Coast", kind: "region", parentId: null, description: "" },
          { id: "port", name: "Port", kind: "city", parentId: "coast", description: "" },
          { id: "dock", name: "Dock", kind: "area", parentId: "port", description: "" },
          { id: "desert", name: "Desert", kind: "region", parentId: null, description: "" },
        ],
      },
      finance: { day: 0, loans: [], rules: [], downtime: [] },
      propertyOperations: readEstate({
        materials: [{ key: "timber", name: "Building timber", unit: "bundle" }],
        templates: [
          {
            key: "warehouse",
            name: "Warehouse",
            propertyType: "other",
            capabilities: ["storage", "crafting"],
            storage: { defaultAccess: "owner", capacityWeight: 1000 },
          },
        ],
        sites: [
          {
            propertyId: "warehouse",
            templateKey: "warehouse",
            enabled: true,
            access: "owner",
            accessPurseIds: [],
            capacityWeight: 1000,
            completedTemplates: [],
            notes: "",
          },
        ],
        staff: [
          {
            id: "manager",
            propertyId: "warehouse",
            name: "Mira",
            role: "manager",
            wageCopper: 0,
            periodDays: 1,
            status: "active",
            manager: true,
            duties: ["supplies", "deliveries", "reports"],
            budgetCopper: 10000,
            budgetPeriodDays: 30,
            budgetStartDay: 0,
            budgetSpentCopper: 0,
            notes: "",
          },
        ],
      }),
      tradeEconomy: readTradeEconomy({
        settings: { enabled: true, mode: "automatic", volatility: 0, hardshipChance: 0 },
        commodities: [
          {
            id: "timber",
            name: "Building timber",
            unit: "bundle",
            category: "general",
            baseCopper: 100,
            weight: 2,
            materialKey: "timber",
            active: true,
          },
        ],
        exchanges: [
          {
            id: "harbor",
            name: "Harbor Exchange",
            locationId: "port",
            purseId: "exchange-treasury",
            open: true,
            visible: true,
            offers: [
              {
                commodityId: "timber",
                stock: 100,
                targetStock: 100,
                capacity: 200,
                supply: 100,
                demand: 100,
                askCopper: 100,
                bidCopper: 60,
              },
            ],
          },
        ],
      }),
    }),
  };
}
