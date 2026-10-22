// Offline parity (money-command checklist): an NPC barter on the DM's device runs the
// shared command engine, writes the same records, and a retried action applies once.
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand } from "./commands.ts";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { canonicalJson } from "./canonical-json.ts";
import { toCopper } from "./money.ts";
import { readWorld } from "./world-schema.ts";
import { readNpcBarter } from "./npc-barter.ts";
import { barterFixture } from "./test-fixtures/npc-barter.ts";

const localDm: CloudSeat = { id: "local", token: "", name: "Dungeon master", role: "dm", purseIds: [] };

function offer(t: CloudTable, copper: number, reply: "offer" | "persuade" | "too-low") {
  const lantern = t.holdings.find((h) => h.purseId === "odile" && h.name === "Hooded lantern")!;
  return {
    kind: "npc-barter-offer" as const,
    npcId: "odile",
    purseId: "mira",
    give: { purseId: "mira", copper, items: [] },
    ask: { purseId: "odile", copper: 0, items: [{ holdingId: lantern.id, quantity: 1, before: canonicalJson(lantern) }] },
    reply,
  };
}

function outcome(t: CloudTable) {
  const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((x, y) => x.id.localeCompare(y.id));
  return {
    purses: byId(t.purses).map((p) => ({ id: p.id, copper: toCopper(p.coins) })),
    holdings: byId(t.holdings),
    ledger: byId(t.ledger).map((l) => ({ ...l, at: 0 })),
    attempts: readNpcBarter(readWorld(t.journal?.world)).attempts.map((a) => ({ ...a, at: 0, decidedAt: 0 })),
  };
}

for (const [name, copper, reply] of [
  ["accepted without a roll", 600, "offer"],
  ["refused without a roll", 100, "too-low"],
] as const) {
  test(`offline NPC barter (${name}) writes the same records as the shared engine`, async () => {
    setSeat(DM_SEAT);
    await applyCloudTable(barterFixture());
    const base = await economySnapshot();
    const input = { ...offer(base, copper, reply), id: `offline-${reply}` };
    const shared = applyCommand(structuredClone(base), localDm, input, { source: "local", random: () => 1 });
    await executeLocalCommand(input);
    assert.deepEqual(outcome(await economySnapshot()), outcome(shared));
  });
}

test("offline: the DM's device rolls once; retrying the same command ID changes nothing", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(barterFixture());
  const base = await economySnapshot();
  const input = { ...offer(base, 400, "persuade"), id: "offline-roll" };
  await executeLocalCommand(input);
  const once = outcome(await economySnapshot());
  assert.equal(once.attempts.length, 1);
  assert.equal(once.attempts[0].roll?.source, "local");
  await executeLocalCommand(input);
  assert.deepEqual(outcome(await economySnapshot()), once);
});

test("offline: a player-link device cannot roll an NPC barter check", async () => {
  setSeat({ ...DM_SEAT, role: "player", purseIds: ["mira"] });
  await applyCloudTable(barterFixture());
  const base = await economySnapshot();
  await assert.rejects(executeLocalCommand({ ...offer(base, 400, "persuade"), id: "player-roll" }), /DM's device or a shared room/);
  setSeat(DM_SEAT);
});
