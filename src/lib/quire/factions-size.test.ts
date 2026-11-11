// Faction storage cap (audit 2026-11-10, F6; owner decision 2026-11-11): a faction save that would
// take the campaign's factions past 400 KB is refused, nothing changes. New writes only: a campaign
// already above it keeps reading, revealing, scoring and editing its factions, and an edit that
// doesn't grow them is accepted. The device runs the same command with the same refusal.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type Command } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { fromCopper } from "./money.ts";
import { defaultFactionDraft, factionsBytes, MAX_FACTIONS_BYTES, readFactions, type FactionDraft } from "./factions.ts";
import type { Shop } from "./types.ts";

const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const shopId = (i: number) => `shop-${String(i).padStart(4, "0")}-${"x".repeat(130)}`;
const shop = (i: number): Shop => ({
  id: shopId(i),
  name: `Shop ${i}`,
  keeper: "",
  place: "",
  notes: "",
  sellRate: 1,
  buyRate: 0.5,
  wealth: "modest",
  category: "general",
  priceScale: 1,
});
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [{ id: "a", name: "Ash", kind: "character", coins: fromCopper(100) }],
    shops: Array.from({ length: 300 }, (_, i) => shop(i)),
    journal: readJournal({}),
  };
}
/** About 44 KB stored: 300 controlled shops with long IDs, a full description and note. */
function bigDraft(name: string, shops = 300): FactionDraft {
  return {
    ...defaultFactionDraft(),
    name,
    description: "d".repeat(1000),
    note: "n".repeat(1000),
    controls: { locationIds: [], shopIds: Array.from({ length: shops }, (_, i) => shopId(i)) },
  };
}
const save = (id: string, factionId: string, revision: number | null, faction: FactionDraft): Command =>
  ({ id, kind: "faction-save", factionId, revision, faction }) as Command;
const errorOf = (work: () => unknown) => {
  try {
    work();
  } catch (e) {
    return (e as Error).message;
  }
  return "";
};

test("F6: a faction save past 400 KB in total is refused and changes nothing", () => {
  assert.equal(MAX_FACTIONS_BYTES, 400_000);
  let t = campaign();
  let i = 0;
  for (; i < 20; i++) {
    const next = errorOf(() => (t = applyCommand(t, dm, save(`c${i}`, `f${i}`, null, bigDraft(`Guild ${i}`)))));
    if (next) {
      assert.match(next, /400 KB/);
      break;
    }
  }
  assert.ok(i > 5 && i < 20, `refused at faction ${i}`);
  const stored = readFactions(t.journal!.factions);
  assert.equal(stored.length, i);
  assert.ok(factionsBytes(stored) <= MAX_FACTIONS_BYTES);
  // A small faction that still fits is accepted.
  const small = { ...defaultFactionDraft(), name: "Small" };
  if (factionsBytes(stored) + 2_000 < MAX_FACTIONS_BYTES) t = applyCommand(t, dm, save("small", "small", null, small));
});

test("F6: a campaign already above the cap keeps working; edits that don't grow are accepted", async () => {
  // Saved before the cap: 12 big factions, about 530 KB.
  let t = campaign();
  const factions = [];
  for (let i = 0; i < 12; i++) {
    const draft = bigDraft(`Old ${i}`);
    factions.push({ id: `old${i}`, ...draft, hidden: true, standing: {}, revision: 0 });
  }
  t.journal = readJournal({ factions });
  assert.equal(readFactions(t.journal.factions).length, 12, "old data stays readable");
  assert.ok(factionsBytes(readFactions(t.journal.factions)) > MAX_FACTIONS_BYTES);
  // Reveal, delete, restore and renown keep working.
  t = applyCommand(t, dm, { id: "v", kind: "faction-visibility", factionId: "old0", revision: 0, hidden: false } as Command);
  // Editing down is accepted; an unchanged save too.
  t = applyCommand(t, dm, save("down", "old1", 0, bigDraft("Old 1", 10)));
  t = applyCommand(t, dm, save("same", "old2", 0, bigDraft("Old 2")));
  // Growing an existing faction, or adding one, is refused.
  assert.match(errorOf(() => applyCommand(t, dm, save("grow", "old1", 1, bigDraft("Old 1", 300)))), /400 KB/);
  assert.match(errorOf(() => applyCommand(t, dm, save("new", "new", null, { ...defaultFactionDraft(), name: "New" }))), /400 KB/);
  // The device refuses with the same words and keeps the campaign unchanged.
  setSeat(DM_SEAT);
  await applyCloudTable(t);
  const before = JSON.stringify((await economySnapshot()).journal?.factions);
  await assert.rejects(executeLocalCommand(save("dev-new", "dev", null, { ...defaultFactionDraft(), name: "New" }) as never), /400 KB/);
  assert.equal(JSON.stringify((await economySnapshot()).journal?.factions), before);
  await executeLocalCommand(save("dev-down", "old3", 0, bigDraft("Old 3", 5)) as never);
  assert.equal(readFactions((await economySnapshot()).journal?.factions).find((f) => f.id === "old3")!.controls.shopIds.length, 5);
});
