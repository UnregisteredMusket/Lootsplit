// Differential test (review P3b): offline executeFinanceCommand must give the
// same outcome as the shared command engine in a campaign that has a blacksmith.
// The smith validator needs the real shops table; the offline path used to load
// `shops: []` for finance commands and failed every one of them.
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand, type CommandInput } from "./commands.ts";
import type { CloudTable } from "./cloud.ts";
import { applyCloudTable, economySnapshot, executeFinanceCommand } from "./economy.ts";
import { smithDm, smithFixture } from "./test-fixtures/blacksmith.ts";

type FinanceInput = CommandInput; // every case below is a finance command kind
// CommandInput omits `id` from the whole union; the shared engine takes it with one.
type SharedCommand = Parameters<typeof applyCommand>[2];

function buildCampaign(): CloudTable {
  let t = smithFixture();
  t.holdings.push({
    id: "keep",
    purseId: "hero",
    name: "Hill keep",
    kind: "property",
    quantity: 1,
    unitCopper: 50000,
    notes: "Old notes",
  });
  t = applyCommand(t, smithDm, {
    id: "loan",
    kind: "finance-loan",
    terms: {
      name: "Guild loan",
      purseId: "hero",
      lenderId: "",
      rateBps: 1000,
      periodDays: 10,
      compound: false,
      payment: 200,
    },
    principal: 1000,
  });
  return t;
}

const built = buildCampaign();
const campaign = (): CloudTable => structuredClone(built);

const cases: Array<[string, FinanceInput]> = [
  [
    "finance-rule",
    {
      kind: "finance-rule",
      rule: {
        id: "tithe",
        name: "Tithe",
        purseId: "hero",
        kind: "expense",
        copper: 10,
        periodDays: 7,
        holdingId: "",
        active: true,
      },
    } as FinanceInput,
  ],
  [
    "finance-loan",
    {
      kind: "finance-loan",
      terms: {
        name: "Second loan",
        purseId: "hero",
        lenderId: "other",
        rateBps: 500,
        periodDays: 5,
        compound: false,
        payment: 100,
      },
      principal: 400,
    } as FinanceInput,
  ],
  [
    "finance-terms",
    {
      kind: "finance-terms",
      loanId: "loan",
      terms: {
        name: "Guild loan (renegotiated)",
        purseId: "hero",
        lenderId: "",
        rateBps: 800,
        periodDays: 10,
        compound: true,
        payment: 150,
      },
    } as FinanceInput,
  ],
  ["finance-repay", { kind: "finance-repay", loanId: "loan", copper: 300 } as FinanceInput],
  ["bank-repay", { kind: "bank-repay", loanId: "loan", copper: 250 } as FinanceInput],
  [
    "property-plan",
    {
      kind: "property-plan",
      holdingId: "keep",
      income: 120,
      upkeep: 30,
      periodDays: 7,
      active: true,
    } as FinanceInput,
  ],
  [
    "property-details",
    {
      kind: "property-details",
      holdingId: "keep",
      before: { name: "Hill keep", notes: "Old notes" },
      name: "Hill fortress",
      notes: "Restored walls",
    } as FinanceInput,
  ],
];

/** The parts of a table a finance command may change, minus timestamps. */
function outcome(t: CloudTable) {
  return {
    purses: t.purses.map((p) => ({ id: p.id, coins: p.coins })).sort((a, b) => a.id.localeCompare(b.id)),
    holdings: [...t.holdings].sort((a, b) => a.id.localeCompare(b.id)),
    shops: [...t.shops].sort((a, b) => a.id.localeCompare(b.id)),
    stock: [...t.stock].sort((a, b) => a.id.localeCompare(b.id)),
    finance: t.journal!.finance,
    blacksmith: t.journal!.blacksmith,
    ledger: t.ledger
      .map((l) => ({ ...l, at: 0 }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

for (const [kind, input] of cases) {
  test(`offline ${kind} matches the shared engine in a campaign with a blacksmith`, async () => {
    await applyCloudTable(campaign());
    // Both engines start from the same stored campaign (as the device reads it).
    const base = await economySnapshot();
    const commandId = `cmd-${kind}`;
    const shared = applyCommand(structuredClone(base), smithDm, {
      ...input,
      id: commandId,
    } as unknown as SharedCommand);
    const original = crypto.randomUUID;
    crypto.randomUUID = (() => commandId) as typeof crypto.randomUUID;
    try {
      await executeFinanceCommand(input);
    } finally {
      crypto.randomUUID = original;
    }
    const offline = await economySnapshot();
    assert.deepEqual(outcome(offline), outcome(shared));
    assert.equal(offline.shops.length, 1, "the smith's shop is kept");
    assert.ok(offline.journal!.blacksmith!.profiles.length, "the smith profile is kept");
  });
}
