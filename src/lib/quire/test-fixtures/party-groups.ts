import { emptyCloudTable, type CloudSeat, type CloudTable } from "../cloud.ts";
import { applyCommand, type Command, type CommandInput } from "../commands.ts";
import { readJournal } from "../journal.ts";
import { readFinance } from "../finance.ts";
import { fromCopper } from "../money.ts";
import { partyGroupsFingerprint } from "../party-groups.ts";

/**
 * Disposable split-the-party campaign ("The Sunken Crown" from the mockups). Saltmarsh's
 * Harbour ward and Ironhold (with the Undercroft inside it). The party stands at Harbour ward.
 */
export const dm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
export const sam: CloudSeat = { id: "sam", token: "sam", name: "Sam", role: "player", purseIds: ["brannoc"] };
export const alex: CloudSeat = { id: "alex", token: "alex", name: "Alex", role: "player", purseIds: ["tamsin"] };
let n = 0;
export const run = (t: CloudTable, input: CommandInput & { id?: string }, seat: CloudSeat = dm) =>
  applyCommand(t, seat, { id: `cmd-${++n}`, ...input } as Command);

const shop = (id: string, name: string, locationId?: string) => ({
  id,
  name,
  keeper: "",
  place: "",
  notes: "",
  sellRate: 1,
  buyRate: 0.5,
  wealth: "modest" as const,
  category: "general" as const,
  priceScale: 1,
  acceptAnyCategory: true,
  ...(locationId ? { locationId } : {}),
});
const line = (id: string, shopId: string, name: string, copper: number) => ({
  id,
  shopId,
  name,
  copper,
  quantity: 10,
  notes: "",
  baseCopper: copper,
  rarity: "common" as const,
});
const position = (purseId: string, extra: Record<string, unknown> = {}) => ({
  purseId,
  inParty: true,
  locationId: null,
  visible: true,
  sheetVisible: true,
  ...extra,
});
const npc = (id: string, name: string, locationId: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  description: "",
  locationId,
  visible: true,
  barterAllowed: true,
  controllerPurseId: null,
  ...extra,
});

export function partyFixture(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: fromCopper(7039) },
      { id: "brannoc", name: "Brannoc Vale", kind: "character", coins: fromCopper(4130) },
      { id: "oriel", name: "Oriel Ashdown", kind: "character", coins: fromCopper(2800) },
      { id: "tamsin", name: "Tamsin Reed", kind: "character", coins: fromCopper(1794) },
      { id: "kettle", name: "Kettle", kind: "character", coins: fromCopper(2200) },
      { id: "garrick", name: "Old Garrick", kind: "character", control: "npc", coins: fromCopper(1200) },
      { id: "maud", name: "Sister Maud", kind: "character", control: "npc", coins: fromCopper(300) },
      { id: "durra", name: "Master Durra", kind: "character", control: "npc", nonParty: true, coins: fromCopper(5000) },
      { id: "ilse", name: "Sister Ilse", kind: "character", control: "npc", nonParty: true, coins: fromCopper(5000) },
    ],
    holdings: [
      { id: "lantern", purseId: "tamsin", name: "Hooded lantern", kind: "item", quantity: 2, unitCopper: 500, notes: "" },
      { id: "pelt", purseId: "brannoc", name: "Wolf pelt", kind: "item", quantity: 2, unitCopper: 200, notes: "" },
      { id: "anvil", purseId: "durra", name: "Small anvil", kind: "item", quantity: 1, unitCopper: 900, notes: "" },
    ],
    shops: [
      shop("chandlery", "Saltmarsh Chandlery", "harbour"),
      shop("armoury", "Ironhold Armoury", "ironhold"),
      shop("peddler", "Wandering peddler"),
    ],
    stock: [
      line("rope", "chandlery", "Hempen rope", 100),
      line("sword", "armoury", "Longsword", 1500),
      line("sack", "peddler", "Sack", 10),
    ],
    listings: [
      { id: "cottage", name: "Ironhold cottage", kind: "property", copper: 1000, quantity: 1, notes: "", locationId: "ironhold" },
      { id: "shed", name: "Harbour shed", kind: "property", copper: 1000, quantity: 1, notes: "", locationId: "harbour" },
    ] as CloudTable["listings"],
    journal: readJournal({
      market: {
        currentLocationId: "harbour",
        locations: [
          { id: "coast", name: "The Sunken Coast", kind: "region", parentId: null, description: "" },
          { id: "saltmarsh", name: "Saltmarsh", kind: "town", parentId: "coast", description: "" },
          { id: "harbour", name: "Harbour ward", kind: "area", parentId: "saltmarsh", description: "" },
          { id: "ironhold", name: "Ironhold", kind: "town", parentId: "coast", description: "" },
          { id: "undercroft", name: "The Undercroft", kind: "area", parentId: "ironhold", description: "" },
          { id: "ford", name: "Greywater Ford", kind: "town", parentId: "coast", description: "" },
        ],
      },
      world: {
        npcs: [
          npc("garrick", "Old Garrick", "harbour"),
          npc("maud", "Sister Maud", "harbour", { visible: false }),
          npc("durra", "Master Durra", "ironhold"),
          npc("ilse", "Sister Ilse", "harbour"),
        ],
        characterPositions: [position("garrick"), position("maud", { visible: false, sheetVisible: false })],
      },
      finance: { ...readFinance(), day: 14, minuteOfDay: 9 * 60 },
      sessions: [{ id: "session", name: "Adventure", startedAt: 1 }],
    }),
  };
}

/** The mockups' split: Harbour watch (main, A) stays; Ironhold riders (B) go to Ironhold. */
export function splitFixture(t = partyFixture()) {
  return run(t, {
    id: "split-7f3a",
    kind: "party-split",
    before: partyGroupsFingerprint(t),
    main: { name: "Harbour watch", colour: "green" },
    groups: [{ id: "riders", name: "Ironhold riders", colour: "blue", locationId: "ironhold", memberIds: ["tamsin", "kettle", "maud"] }],
  });
}
