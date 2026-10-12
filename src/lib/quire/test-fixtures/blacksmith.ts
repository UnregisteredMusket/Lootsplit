import { emptyCloudTable, type CloudTable, type CloudSeat } from "../cloud.ts";
import { applyCommand } from "../commands.ts";
import { readJournal } from "../journal.ts";
import { readFinance } from "../finance.ts";
import { defaultSmith, type SmithDesign } from "../blacksmith-schema.ts";
export const smithDm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
export const smithPlayer: CloudSeat = {
  id: "player",
  token: "player",
  name: "Hero",
  role: "player",
  purseIds: ["hero"],
};
export function smithFixture(): CloudTable {
  let t: CloudTable = {
    ...emptyCloudTable(),
    purses: ["hero", "other"].map((id) => ({
      id,
      name: id,
      kind: "character",
      coins: { cp: 100000, sp: 0, ep: 0, gp: 0, pp: 0 },
    })),
    holdings: [
      {
        id: "steel-lot",
        purseId: "hero",
        name: "Hero steel",
        kind: "item",
        quantity: 6,
        unitCopper: 100,
        notes: "",
        materialKey: "steel",
      },
    ],
    shops: [
      {
        id: "forge",
        name: "Dawn Forge",
        keeper: "Aster",
        place: "City",
        locationId: "city",
        category: "smith",
        wealth: "modest",
        sellRate: 1,
        buyRate: 0.5,
        priceScale: 1,
        notes: "",
      },
    ],
    journal: readJournal({
      propertyOperations: { materials: [{ key: "steel", name: "Steel", unit: "piece" }] },
      finance: readFinance(),
      market: {
        currentLocationId: "city",
        locations: [
          { id: "region", name: "Region", kind: "region", parentId: null, description: "" },
          { id: "city", name: "City", kind: "city", parentId: "region", description: "" },
          { id: "far", name: "Far City", kind: "city", parentId: "region", description: "" },
        ],
      },
    }),
  };
  t = applyCommand(t, smithDm, {
    id: "maker",
    kind: "npc-create",
    npc: {
      id: "maker",
      name: "Aster",
      description: "Smith",
      locationId: "city",
      visible: true,
      barterAllowed: false,
      controllerPurseId: null,
      blacksmithServices: true,
    },
    copper: 0,
    inventory: [],
  });
  return applyCommand(t, smithDm, {
    id: "profile",
    kind: "smith-profile",
    shopId: "forge",
    before: null,
    profile: defaultSmith("forge", "maker"),
  });
}
export function smithDesign(t: CloudTable): SmithDesign {
  const item = t.journal!.blacksmith!.profiles[0].items[0];
  return {
    itemKey: item.key,
    name: "Dawn's Promise",
    engraving: "Homeward",
    enchantmentKey: null,
    parts: item.parts.map((p) => ({
      partKey: p.key,
      optionKey: "plain",
      materialKey: p.materialKeys[0],
      holdingId: null,
    })),
  };
}
