import { emptyCloudTable, type CloudSeat, type CloudTable } from "../cloud.ts";
import { applyCommand, type CommandInput } from "../commands.ts";
import { readJournal } from "../journal.ts";
import { readFinance } from "../finance.ts";
import { fromCopper } from "../money.ts";
import { blankSheet } from "../../characters/model.mjs";

/** Disposable NPC barter campaign (docs/NPC-BARTER.md): Odile answers on her own. */
export const barterDm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
let n = 0;
const run = (t: CloudTable, input: CommandInput) => applyCommand(t, barterDm, { ...input, id: `fixture-${++n}` } as never);
export function barterSheet(cha: number, persuasionRank = 0) {
  const s = blankSheet();
  s.name = "x";
  s.scores.cha = cha;
  s.proficiency = 2;
  if (persuasionRank) s.skills.Persuasion = { rank: persuasionRank, extra: 0 };
  return s;
}

export function barterFixture(mode: "auto" | "dm" | "confirm" = "auto"): CloudTable {
  const base: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      { id: "mira", name: "Mira Ashfall", kind: "character", coins: fromCopper(3740), sheet: barterSheet(16, 1) },
      { id: "tamsin", name: "Tamsin Reed", kind: "character", coins: fromCopper(3740) },
      { id: "bram", name: "Bram Stoneward", kind: "character", coins: fromCopper(3740), sheet: barterSheet(8) },
    ],
    holdings: [
      { id: "mirror", purseId: "mira", name: "Silver hand mirror", kind: "item", quantity: 1, unitCopper: 1000, notes: "", category: "jewels" },
      { id: "mirror-t", purseId: "tamsin", name: "Silver hand mirror", kind: "item", quantity: 1, unitCopper: 1000, notes: "", category: "jewels" },
      { id: "mirror-b", purseId: "bram", name: "Silver hand mirror", kind: "item", quantity: 1, unitCopper: 1000, notes: "", category: "jewels" },
      { id: "ring", purseId: "bram", name: "Silver ring", kind: "item", quantity: 10, unitCopper: 100, notes: "", category: "jewels" },
      { id: "pelt", purseId: "bram", name: "Wolf pelt", kind: "item", quantity: 20, unitCopper: 200, notes: "", category: "cloth" },
      { id: "dice", purseId: "mira", name: "Lucky bone dice", kind: "item", quantity: 1, unitCopper: 2500, notes: "", category: "curios", valueSource: "player" },
    ],
    journal: readJournal({
      market: {
        currentLocationId: "row",
        locations: [
          { id: "region", name: "Eastmarch", kind: "region", parentId: null, description: "" },
          { id: "city", name: "Harrowgate", kind: "city", parentId: "region", description: "" },
          { id: "row", name: "Lantern Row", kind: "area", parentId: "city", description: "" },
        ],
      },
      finance: { ...readFinance(), day: 12, minuteOfDay: 14 * 60 + 20 },
      sessions: [{ id: "session", name: "Adventure", startedAt: 1 }],
    }),
  };
  const t = run(base, {
    kind: "npc-create",
    npc: { id: "odile", name: "Odile Marsh", description: "Keeper of The Brass Lantern", locationId: "row", visible: true, barterAllowed: true, controllerPurseId: null },
    copper: 10000,
    inventory: [
      { name: "Hooded lantern", quantity: 3, unitCopper: 500, notes: "", category: "general" },
      { name: "Traveler's cloak", quantity: 2, unitCopper: 400, notes: "", category: "cloth" },
      { name: "Brass spyglass", quantity: 1, unitCopper: 10000, notes: "", category: "curios" },
    ],
  });
  return run(t, { kind: "npc-barter-npc", npcId: "odile", before: null, config: { mode, wants: ["general", "curios", "jewels"] } });
}

