import { captureDeviceMutationScope, assertDeviceMutationScope } from "./mutation-scope.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import {
  applyBill,
  applyCloudTable,
  askLoan,
  buyFromShop,
  decideLoan,
  economySnapshot,
  executeLocalCommand,
  executeFinanceCommand,
  addListing,
  saveStock,
  giveToPlayer,
  postCopper,
  sellToShop,
  setCoins,
  snapshot,
  restore,
  voidLedgerLine,
} from "./economy.ts";
import { loadLoans } from "./market.ts";
import { fromCopper, spendCoins, toCopper } from "./money.ts";
import { coinsSchema, validateEconomyRows } from "./validation.ts";
import { applyCommand } from "./commands.ts";
import { buildBill, readShare } from "./table.ts";
import { presentReceipt, getReceipt } from "./receipt.ts";
import { quireDb } from "./db.ts";

const fixture = (): CloudTable => ({
  ...emptyCloudTable(),
  purses: ["a", "b"].map((id) => ({ id, name: id, kind: "character", coins: fromCopper(1000) })),
  shops: [
    {
      id: "s",
      name: "Shop",
      keeper: "",
      place: "",
      notes: "",
      sellRate: 1,
      buyRate: 0.5,
      wealth: "modest",
      category: "mixed",
      priceScale: 1,
    },
  ],
  stock: [
    {
      id: "x",
      shopId: "s",
      name: "Rope",
      copper: 100,
      baseCopper: 100,
      rarity: "common",
      quantity: 100,
      notes: "new stock",
      category: "general",
    },
  ],
});
const wallet = (t: CloudTable, id = "a") => toCopper(t.purses.find((p) => p.id === id)!.coins);
const total = (t: CloudTable) => t.purses.reduce((sum, p) => sum + toCopper(p.coins), 0);
const debit = (id: string) => ({
  id,
  purseId: "a",
  shopId: null,
  copper: -100,
  at: 1,
  summary: "Expense",
  transactionType: "payment" as const,
});

test("purchasing the same name preserves old lots, valuation and equipment", async () => {
  const t = fixture();
  const old = {
    id: "old",
    purseId: "a",
    kind: "item" as const,
    name: "Rope",
    quantity: 100,
    unitCopper: 1,
    notes: "old rope",
    category: "general",
    equipped: true,
    weight: 1,
  };
  t.holdings = [old];
  await applyCloudTable(t);
  await buyFromShop({ stockId: "x", purseId: "a", quantity: 1 });
  const purchased = await economySnapshot();
  assert.deepEqual(
    purchased.holdings.find((h) => h.id === "old"),
    old,
  );
  const fresh = purchased.holdings.find((h) => h.id !== "old")!;
  assert.equal(fresh.unitCopper, 100);
  assert.equal(fresh.quantity, 1);
  await sellToShop({ holdingId: old.id, shopId: "s", quantity: 100 });
  await sellToShop({ holdingId: fresh.id, shopId: "s", quantity: 1 });
  assert.equal(wallet(await economySnapshot()), 1050);
});

test("purchase reversal uses its exact lot and preserves other same-name assets", async () => {
  const t = fixture();
  const old = {
    id: "old",
    purseId: "a",
    kind: "item" as const,
    name: "Rope",
    quantity: 1,
    unitCopper: 1,
    notes: "personal",
  };
  t.holdings = [old];
  await applyCloudTable(t);
  await buyFromShop({ stockId: "x", purseId: "a", quantity: 3 });
  const bought = await economySnapshot();
  const copy = await snapshot();
  await applyCloudTable(fixture());
  await restore(copy);
  await voidLedgerLine(bought.ledger[0].id);
  const after = await economySnapshot();
  assert.deepEqual(after.holdings, [old]);
  assert.equal(wallet(after), 1000);
  assert.equal(after.stock[0].quantity, 100);
  assert.equal(
    after.ledger.reduce((sum, l) => sum + l.copper, 0),
    0,
  );
});

test("ambiguous legacy purchase reversal leaves every asset unchanged", async () => {
  const t = fixture();
  t.purses[0].coins = fromCopper(700);
  t.stock[0].quantity = 97;
  t.holdings = [
    {
      id: "old",
      purseId: "a",
      kind: "item",
      name: "Rope",
      quantity: 1,
      unitCopper: 1,
      notes: "old",
    },
    {
      id: "purchase",
      purseId: "a",
      kind: "item",
      name: "Rope",
      quantity: 3,
      unitCopper: 100,
      notes: "purchased",
    },
  ];
  t.ledger = [
    {
      ...debit("purchase"),
      shopId: "s",
      copper: -300,
      summary: "Bought 3 Rope from Shop",
      transactionType: "purchase",
    },
  ];
  await applyCloudTable(t);
  const before = await economySnapshot();
  await assert.rejects(voidLedgerLine("purchase"), /ambiguous/);
  assert.deepEqual(await economySnapshot(), before);
});

test("an unambiguous older purchase remains reversible", async () => {
  const t = fixture();
  t.purses[0].coins = fromCopper(700);
  t.stock[0].quantity = 97;
  t.holdings = [
    {
      id: "legacy",
      purseId: "a",
      kind: "item",
      name: "Rope",
      quantity: 4,
      unitCopper: 100,
      notes: t.stock[0].notes,
    },
  ];
  t.ledger = [
    {
      ...debit("purchase"),
      shopId: "s",
      copper: -300,
      summary: "Bought 3 Rope from Shop",
      transactionType: "purchase",
    },
  ];
  await applyCloudTable(t);
  await voidLedgerLine("purchase");
  const after = await economySnapshot();
  assert.equal(after.holdings[0].quantity, 1);
  assert.equal(wallet(after), 1000);
  assert.equal(after.stock[0].quantity, 100);
});

test("a changed purchased lot cannot refund coins or restore stock", async () => {
  await applyCloudTable(fixture());
  await buyFromShop({ stockId: "x", purseId: "a", quantity: 3 });
  const bought = await economySnapshot();
  await sellToShop({ holdingId: bought.holdings[0].id, shopId: "s", quantity: 1 });
  const before = await economySnapshot();
  await assert.rejects(voidLedgerLine(bought.ledger[0].id), /changed or left/);
  assert.deepEqual(await economySnapshot(), before);
});

test("a sold legacy purchase cannot remove the sole older same-name lot", async () => {
  for (const metadata of [
    { unitCopper: 1, notes: "new stock", category: "general" },
    { unitCopper: 100, notes: "personal rope", category: "general" },
    { unitCopper: 100, notes: "new stock", category: "smith" },
  ]) {
    const t = fixture();
    t.holdings = [
      { id: "old", purseId: "a", name: "Rope", kind: "item", quantity: 100, ...metadata },
    ];
    t.ledger = [
      {
        ...debit("purchase"),
        shopId: "s",
        copper: -300,
        summary: "Bought 3 Rope from Shop",
        transactionType: "purchase",
      },
      { ...debit("sold"), copper: 150, summary: "Sold 3 Rope to Shop", transactionType: "sale" },
    ];
    t.purses[0].coins = fromCopper(850);
    t.stock[0].quantity = 97;
    await applyCloudTable(t);
    const before = await economySnapshot();
    await assert.rejects(voidLedgerLine("purchase"), /no longer matches/);
    assert.deepEqual(await economySnapshot(), before);
  }
});

test("neither half of a coin transfer can be independently reversed", async () => {
  await applyCloudTable(fixture());
  await giveToPlayer({ fromId: "a", toId: "b", copper: 100, holdingId: null, quantity: 0 });
  const before = await economySnapshot();
  for (const line of before.ledger)
    await assert.rejects(voidLedgerLine(line.id), /cannot be reversed safely/);
  assert.deepEqual(await economySnapshot(), before);
  assert.equal(total(before), 2000);
});

test("retained legacy report receipt protects both sides of a transfer", async () => {
  const t = fixture();
  const dm = { id: "dm", token: "", name: "DM", role: "dm" as const, purseIds: [] };
  const changed = applyCommand(t, dm, {
    id: "transfer",
    kind: "give",
    fromId: "a",
    toId: "b",
    copper: 100,
    holdingId: null,
    quantity: 0,
  });
  const report = readShare(
    JSON.parse(
      JSON.stringify(
        buildBill(
          {
            ...changed,
            purses: changed.purses.filter((p) => p.id === "a"),
            shareBase: { purses: t.purses, holdings: [], stock: t.stock },
            gifts: [
              {
                id: "gift",
                at: Date.now(),
                fromId: "a",
                toId: "b",
                fromName: "a",
                toName: "b",
                copper: 100,
                holding: null,
              },
            ],
          },
          { role: "player", purseIds: ["a"], shopIds: [], openedAt: 1 },
        ),
      ),
    ),
  );
  assert.ok(report && report.kind === "quire-bill");
  await applyCloudTable(t);
  await applyBill(report);
  presentReceipt(report);
  const before = await economySnapshot();
  await assert.rejects(voidLedgerLine(getReceipt()!.entries[0].id), /cannot be reversed safely/);
  assert.deepEqual(await economySnapshot(), before);
  assert.equal(total(before), 2000);
});

test("concurrent different reversals refund both debits and preserve ledger agreement", async () => {
  const t = fixture();
  t.purses[0].coins = fromCopper(800);
  t.ledger = [debit("one"), debit("two")];
  await applyCloudTable(t);
  await Promise.all(t.ledger.map((line) => voidLedgerLine(line.id)));
  const after = await economySnapshot();
  assert.equal(wallet(after), 1000);
  assert.equal(
    after.ledger.reduce((sum, l) => sum + l.copper, 0),
    0,
  );
});

test("concurrent and delayed reversal retries produce one refund and one receipt", async () => {
  const t = fixture();
  t.purses[0].coins = fromCopper(900);
  t.ledger = [debit("one")];
  await applyCloudTable(t);
  await Promise.all([voidLedgerLine("one"), voidLedgerLine("one")]);
  await voidLedgerLine("one");
  const after = await economySnapshot();
  assert.equal(wallet(after), 1000);
  assert.equal(after.ledger.filter((l) => l.reversalOf === "one").length, 1);
});

test("wallet replacement and a concurrent award use the committed balance for their ledger delta", async () => {
  for (const editFirst of [true, false]) {
    await applyCloudTable(fixture());
    const edit = () => setCoins("a", fromCopper(500));
    const award = () => postCopper("a", 100, "Award");
    await Promise.all(editFirst ? [edit(), award()] : [award(), edit()]);
    const after = await economySnapshot();
    assert.equal(wallet(after), 1000 + after.ledger.reduce((sum, l) => sum + l.copper, 0));
  }
});

test("concurrent local requests and a purchase retain all committed state", async () => {
  await applyCloudTable(fixture());
  await Promise.all([
    executeLocalCommand({ kind: "payment-request", purseId: "a", copper: 100, note: "First" }),
    executeLocalCommand({ kind: "payment-request", purseId: "a", copper: 200, note: "Second" }),
    buyFromShop({ stockId: "x", purseId: "a", quantity: 1 }),
  ]);
  const after = await economySnapshot();
  assert.deepEqual(after.journal!.requests.map((r) => r.note).sort(), ["First", "Second"]);
  assert.equal(wallet(after), 900);
  assert.equal(after.holdings[0].quantity, 1);
  assert.equal(after.stock[0].quantity, 99);
});

test("concurrent local approvals debit each request once without replacing other records", async () => {
  await applyCloudTable(fixture());
  await executeLocalCommand({ kind: "payment-request", purseId: "a", copper: 100, note: "First" });
  await executeLocalCommand({ kind: "payment-request", purseId: "a", copper: 200, note: "Second" });
  const requests = (await economySnapshot()).journal!.requests;
  await Promise.all(
    requests.map((r) =>
      executeLocalCommand({ kind: "payment-decision", requestId: r.id, status: "approved" }),
    ),
  );
  const after = await economySnapshot();
  assert.equal(wallet(after), 700);
  assert.equal(after.journal!.requests.filter((r) => r.status === "approved").length, 2);
  await assert.rejects(
    executeLocalCommand({
      kind: "payment-decision",
      requestId: requests[0].id,
      status: "approved",
    }),
    /already decided/,
  );
  assert.equal(wallet(await economySnapshot()), 700);
});

test("concurrent loan appends retain both requests and private notes; retry IDs remain stable", async () => {
  await applyCloudTable(fixture());
  const first = { requestId: "first", purseId: "a", copper: 100, note: "First" };
  await Promise.all([
    askLoan(first),
    askLoan({ requestId: "second", purseId: "a", copper: 200, note: "Second" }),
    askLoan(first),
  ]);
  assert.equal((await loadLoans()).length, 2);
  assert.equal((await economySnapshot()).notes.length, 2);
  await assert.rejects(askLoan({ ...first, copper: 101 }), /different request/);
  await Promise.all([
    decideLoan("first", "approved"),
    askLoan({ requestId: "third", purseId: "a", copper: 300, note: "Third" }),
  ]);
  assert.equal((await loadLoans()).find((r) => r.id === "first")!.status, "approved");
  assert.equal((await loadLoans()).length, 3);
  assert.equal(wallet(await economySnapshot()), 1100);
});

test("coin validation rejects aggregate overflow but preserves exactly representable legacy balances", async () => {
  const t = fixture();
  t.purses[0].coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: Number.MAX_SAFE_INTEGER };
  assert.throws(() => validateEconomyRows(t), /invalid or missing/);
  const largest = fromCopper(Number.MAX_SAFE_INTEGER);
  assert.ok(coinsSchema.safeParse(largest).success);
  assert.equal(toCopper(largest), Number.MAX_SAFE_INTEGER);
  assert.equal(toCopper(spendCoins(largest, 1)!), Number.MAX_SAFE_INTEGER - 1);
  assert.equal(coinsSchema.safeParse({ ...largest, cp: largest.cp + 1 }).success, false);
  await applyCloudTable(fixture());
  await setCoins("a", largest);
  const before = await economySnapshot();
  await assert.rejects(postCopper("a", 1, "Overflow"), /Insufficient funds/);
  await assert.rejects(setCoins("a", t.purses[0].coins), /exactly representable/);
  assert.deepEqual(await economySnapshot(), before);
  await postCopper("a", -1, "One copper");
  assert.equal(wallet(await economySnapshot()), Number.MAX_SAFE_INTEGER - 1);
  // A previously stored unsafe wallet remains readable/exportable; even a
  // subtraction that rounds into the safe range cannot replace it with null.
  const db = await quireDb();
  const old = {
    ...t.purses[0],
    coins: { cp: Number.MAX_SAFE_INTEGER, sp: 0, ep: 0, gp: 0, pp: 1 },
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("purses", "readwrite");
    tx.objectStore("purses").put(old);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await assert.rejects(postCopper("a", -1000, "Unsafe old subtraction"), /represented exactly/);
  assert.deepEqual(
    (await snapshot()).purses.find((p) => p.id === "a"),
    old,
  );
});

test("local command scope rejection after the atomic read leaves every saved record unchanged", async () => {
  await applyCloudTable(fixture());
  const before = await economySnapshot();
  let checks = 0;
  await assert.rejects(
    executeLocalCommand(
      { kind: "payment-request", purseId: "a", copper: 100, note: "Reviewed original campaign" },
      () => {
        if (++checks === 2) throw Error("Synthetic campaign changed during source read");
      },
    ),
    /campaign changed during source read/,
  );
  assert.equal(checks, 2);
  assert.deepEqual(await economySnapshot(), before);
});
test("finance command scope rejection after the atomic read retains its original schedule and balances", async () => {
  await applyCloudTable(fixture());
  const before = await economySnapshot();
  let checks = 0;
  await assert.rejects(
    executeFinanceCommand(
      {
        kind: "shop-schedule",
        shopId: "s",
        schedule: {
          cycleDays: 7,
          openDays: [0, 1],
          restockEveryDays: 7,
          restockQuantity: 5,
          lastRestockDay: 0,
        },
      },
      () => {
        if (++checks === 2) throw Error("Synthetic campaign changed during source read");
      },
    ),
    /campaign changed during source read/,
  );
  assert.equal(checks, 2);
  assert.deepEqual(await economySnapshot(), before);
});

test("listing, stock and loan forms reject a campaign/account switch during their own source reads", async () => {
  const prior = {
    window: globalThis.window,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
  };
  const values = new Map([
    ["quire.campaign.v1", "scope-original"],
    [
      "quire.campaigns.v1",
      JSON.stringify([
        { id: "scope-original", db: "quire-form-original" },
        { id: "scope-other", db: "quire-form-other" },
      ]),
    ],
  ]);
  const tickets = new Map([["lootsplit.verified-account", "scope-owner"]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  Object.assign(globalThis, {
    localStorage: storage,
    sessionStorage: { getItem: (key: string) => tickets.get(key) ?? null },
    window: { localStorage: storage },
  });
  try {
    const actions = [
      (guard: () => void) =>
        addListing(
          { name: "Retained listing", kind: "item", copper: 100, quantity: 1, notes: "" },
          guard,
        ),
      (guard: () => void) =>
        saveStock(
          {
            id: "new-stock",
            shopId: "s",
            name: "Retained stock",
            copper: 100,
            baseCopper: 100,
            rarity: "common",
            quantity: 2,
            notes: "",
          },
          guard,
        ),
      (guard: () => void) => askLoan({ purseId: "a", copper: 100, note: "Retained loan" }, guard),
    ];
    for (const action of actions) {
      values.set("quire.campaign.v1", "scope-original");
      tickets.set("lootsplit.verified-account", "scope-owner");
      await applyCloudTable(fixture());
      const beforeOriginal = await economySnapshot();
      values.set("quire.campaign.v1", "scope-other");
      const other = fixture();
      other.purses[0]!.coins = fromCopper(2020);
      await applyCloudTable(other);
      const beforeOther = await economySnapshot();
      values.set("quire.campaign.v1", "scope-original");
      const expected = captureDeviceMutationScope();
      let checks = 0;
      await assert.rejects(
        action(() => {
          if (++checks === 2) {
            values.set("quire.campaign.v1", "scope-other");
            tickets.set("lootsplit.verified-account", "different-owner");
          }
          assertDeviceMutationScope(expected);
        }),
        /campaign or account changed/,
      );
      assert.equal(checks, 2);
      assert.deepEqual(await economySnapshot(), beforeOther);
      values.set("quire.campaign.v1", "scope-original");
      tickets.set("lootsplit.verified-account", "scope-owner");
      assert.deepEqual(await economySnapshot(), beforeOriginal);
    }
  } finally {
    Object.assign(globalThis, prior);
  }
});
