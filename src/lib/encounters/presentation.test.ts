import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmedLootSummary,
  currentPartyMembers,
  encounterReadiness,
  recipientAwardPreview,
  reviewedPartyPlan,
} from "./presentation.ts";

const coins = { cp: 0, sp: 0, ep: 0, gp: 20, pp: 0 };
const body = {
  coins,
  coinPurseId: "party",
  loot: [{ id: "one", name: "Private sword", quantity: 3, purseId: "hero" }],
  tables: [{ name: "Physical table", selected: null as number | null }],
};
const recipients = [
  { id: "party", name: "Party", kind: "party" },
  { id: "hero", name: "Hero", kind: "character" },
];

test("readiness distinguishes unresolved tables from post-conclude recipients and campaign turns", () => {
  const first = encounterReadiness({ status: "active", body, recipients, dirty: false });
  assert.deepEqual(first.conclude, ["Choose or roll a result for Physical table."]);
  const next = encounterReadiness({
    status: "review",
    body: { ...body, coinPurseId: "removed", loot: [{ ...body.loot[0]!, purseId: "" }] },
    recipients,
    dirty: true,
    shared: { live: false, mine: false, pending: 2 },
  });
  assert.equal(next.transfer.length, 5);
  assert.ok(
    !next.transfer.some((line) => line.includes("Physical table")),
    "resolved review stage does not report the pre-conclude table",
  );
  assert.deepEqual(
    encounterReadiness({
      status: "review",
      body,
      recipients,
      dirty: false,
      shared: { live: true, mine: true, pending: 0 },
    }).transfer,
    [],
  );
  assert.ok(
    encounterReadiness({
      status: "review",
      body,
      recipients,
      dirty: false,
      personal: true,
    }).transfer.some((line) => line.includes("Account-only")),
  );
});

test("recipient preview never silently assigns unknown IDs or changes the award", () => {
  const original = structuredClone(body);
  const preview = recipientAwardPreview(
    {
      ...body,
      loot: [...body.loot, { id: "missing", name: "Gem", quantity: 1, purseId: "revoked" }],
    },
    recipients,
  );
  assert.equal(preview.recipients[0]!.coins!.gp, 20);
  assert.equal(preview.recipients[1]!.items[0]!.quantity, 3);
  assert.equal(preview.unresolved[0]!.id, "missing");
  assert.deepEqual(body, original);
});

test("reviewed party plan uses selected canonical levels without averaging or overwriting manual difficulty", () => {
  const members = currentPartyMembers([
    { id: "party", name: "Treasury", kind: "party" },
    { id: "a", name: "A", kind: "character", sheet: { level: 3, edition: "2014" } },
    { id: "b", name: "B", kind: "character", sheet: { level: 7, edition: "custom" } },
    { id: "c", name: "C", kind: "character" },
  ]);
  assert.equal(members.length, 3);
  const plan = reviewedPartyPlan(members, ["a", "b", "revoked"], 5);
  assert.equal(plan.partySize, 2);
  assert.equal(plan.level, 5);
  assert.equal(plan.mixedLevels, true);
  assert.equal(plan.non2014, true);
  assert.equal(reviewedPartyPlan(members, ["c"], 1).unknownLevels, true);
  assert.equal(reviewedPartyPlan(members, [], 1).valid, false);
});

test("party loot summary requires a confirmed award and only emits safe aggregate data", () => {
  const detail = {
    id: "encounter-stable",
    status: "awarded",
    body: {
      ...body,
      notes: "SECRET enemy tactics",
      loot: [{ ...body.loot[0]!, unitCopper: 123456, notes: "SECRET item" }],
    },
    award: { receiptId: "receipt-stable", at: 1700000000000 },
  };
  assert.equal(confirmedLootSummary({ ...detail, status: "review" }), null);
  assert.equal(confirmedLootSummary({ ...detail, status: "pending" }), null);
  assert.equal(confirmedLootSummary({ ...detail, award: null }), null);
  assert.equal(
    confirmedLootSummary({
      ...detail,
      award: { receiptId: "receipt-stable", at: Number.MAX_SAFE_INTEGER },
    }),
    null,
  );
  const summary = confirmedLootSummary(detail)!;
  assert.match(summary.text, /Items awarded: 3 across 1 item entries/);
  assert.match(summary.text, /receipt-stable/);
  for (const privateText of ["SECRET", "Private sword", "Hero", "123456"])
    assert.ok(
      !summary.text.includes(privateText),
      "private fields are excluded from party publication",
    );
  assert.ok(!summary.text.includes("20 gp"));
  assert.deepEqual(Object.keys(summary), ["title", "text", "encounterId", "receiptId"]);
});
