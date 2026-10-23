import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand } from "./commands.ts";
import { smithFixture, smithDm } from "./test-fixtures/blacksmith.ts";
import { npcServices, servicesReply, DOWNTIME_LOCK, NO_CHARACTER_LOCK } from "./service-hub.ts";
import { smithAvailability, smithHere } from "./blacksmith.ts";
import {
  assertContribution,
  controlOrder,
  money,
  presentAt,
  previewDays,
  quoteFingerprint,
} from "./service-core.ts";
import { canonicalJson } from "./canonical-json.ts";
import { defaultSmith } from "./blacksmith-schema.ts";
import type { CloudTable } from "./cloud.ts";

const npcPatch = (t: CloudTable, patch: Record<string, unknown>) => {
  const npc = t.journal!.world!.npcs.find((n) => n.id === "maker")!;
  Object.assign(npc, patch);
  return t;
};

test("hub lists the forge with the same availability check the order command runs", () => {
  const t = smithFixture();
  const [forge] = npcServices(t, "maker", "hero");
  assert.equal(forge.tag, "Services · Blacksmith");
  assert.equal(forge.href, "/shop/forge");
  assert.equal(forge.locked, "");
  const reply = servicesReply(npcServices(t, "maker", "hero"), "Aster");
  assert.equal(reply.mode, "direct");

  // No character chosen.
  assert.equal(npcServices(t, "maker", undefined)[0].locked, NO_CHARACTER_LOCK);
  // NPC permission off: the hub used to open the shop anyway (proposal 1.8).
  const off = npcPatch(smithFixture(), { blacksmithServices: false });
  assert.equal(
    npcServices(off, "maker", "hero")[0].locked,
    "The DM has not enabled this NPC's blacksmith services.",
  );
  // Shop closed.
  const closed = smithFixture();
  closed.shops[0].closed = true;
  assert.equal(npcServices(closed, "maker", "hero")[0].locked, smithAvailability(closed, closed.journal!.blacksmith!.profiles[0], "hero"));
  assert.match(npcServices(closed, "maker", "hero")[0].locked, /closed/);
  // Payer elsewhere.
  const away = smithFixture();
  away.journal!.world!.characterPositions.push({
    purseId: "hero",
    inParty: false,
    locationId: "far",
    visible: true,
    sheetVisible: true,
  });
  assert.equal(
    npcServices(away, "maker", "hero")[0].locked,
    "Visit the forge with the paying character and materials first.",
  );
  // Pending downtime freezes services first.
  const pending = smithFixture();
  (pending.journal!.finance as { downtime: unknown[] }).downtime.push({ status: "pending" });
  assert.equal(npcServices(pending, "maker", "hero")[0].locked, DOWNTIME_LOCK);
});

test("hub: no provider is locked, several providers open a sub-list enabled while one is usable", () => {
  const t = smithFixture();
  const none = servicesReply(npcServices(t, "nobody", "hero"), "Bob");
  assert.equal(none.mode, "none");
  assert.equal(none.locked, "Bob offers no services.");

  // A second forge run by the same NPC.
  let two: CloudTable = {
    ...t,
    shops: [...t.shops, { ...t.shops[0], id: "forge2", name: "Far Forge", locationId: "far" }],
  };
  two = applyCommand(two, smithDm, {
    id: "profile2",
    kind: "smith-profile",
    shopId: "forge2",
    before: null,
    profile: defaultSmith("forge2", "maker"),
  });
  const list = npcServices(two, "maker", "hero");
  assert.equal(list.length, 2);
  assert.equal(list[0].locked, "");
  assert.equal(list[1].locked, "The smith's shop is closed or unavailable.");
  const reply = servicesReply(list, "Aster");
  assert.equal(reply.mode, "list");
  assert.equal(reply.locked, "");
  assert.equal(reply.tag, "Services · Blacksmith");
  // Every provider locked: the reply is locked with the first reason.
  const allLocked = servicesReply(npcServices(two, "maker", undefined), "Aster");
  assert.equal(allLocked.locked, NO_CHARACTER_LOCK);
});

test("service-core keeps the forge's rules: presence, whole copper, fingerprint, contribution, control, days", () => {
  const t = smithFixture();
  for (const [loc, purse] of [
    ["city", "hero"],
    ["far", "hero"],
    ["region", "other"],
    ["city", "nobody"],
  ])
    assert.equal(presentAt(t, loc, purse), smithHere(t, loc, purse));
  assert.equal(money(10.2), 11);
  assert.throws(() => money(-1), /copper range/);
  assert.throws(() => money(2e12, "Too much."), /Too much/);
  assert.throws(() => money(Number.NaN));
  assert.equal(quoteFingerprint({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));

  const rule = { materialKey: "steel", mismatch: "Mismatch.", equipped: "Equipped." };
  assert.equal(assertContribution(t, "steel-lot", "hero", rule).id, "steel-lot");
  assert.throws(() => assertContribution(t, "steel-lot", "other", rule), /Mismatch/);
  assert.throws(() => assertContribution(t, "steel-lot", "hero", { ...rule, materialKey: "wood" }), /Mismatch/);
  assert.throws(() => assertContribution(t, "steel-lot", "hero", { ...rule, minCopper: 101 }), /Mismatch/);
  assert.equal(assertContribution(t, "steel-lot", "hero", { ...rule, minCopper: 100 }).id, "steel-lot");
  t.holdings[0].equipped = true;
  assert.throws(() => assertContribution(t, "steel-lot", "hero", rule), /Equipped/);
  t.holdings[0].equipped = false;
  t.holdings[0].reservedFor = "job";
  assert.throws(() => assertContribution(t, "steel-lot", "hero", rule), /Retrieve this item/);

  const open = (o: { status: string }) => ["active", "paused", "ready"].includes(o.status);
  const order = { id: "o", purseId: "hero", status: "active", progressDays: 1, message: "" };
  assert.throws(() => controlOrder(order, "resume", "r", open), /cannot make that status change/);
  controlOrder(order, "pause", "Out of silver", open);
  assert.deepEqual([order.status, order.message], ["paused", "Out of silver"]);
  const notices = previewDays([order, { ...order, id: "p", status: "active" }], 5, { day: 10, minuteOfDay: 60 }, {
    workDays: () => 3,
    name: (o) => o.id,
    readyMessage: "Done.",
  });
  assert.equal(order.progressDays, 1, "paused orders keep progress and do not advance");
  assert.deepEqual(notices, [{ orderId: "p", purseId: "hero", summary: "p: 3/3 days; ready; completed campaign day 12." }]);
});
