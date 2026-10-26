// Review Inbox (design D2): one queue sorted by age across request types, the chip counts and
// the Desk total, "Approve all payments under N gp" selection, and the exactly-once guarantee
// the bulk approval relies on (each payment-decision is its own command, refused once decided,
// shared and on the device alike).
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand, type CommandInput } from "./commands.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { toCopper } from "./money.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import {
  paymentsUnder,
  reviewAge,
  reviewCounts,
  reviewItems,
  reviewTotal,
  sortReviewItems,
} from "./review-inbox.ts";

const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const player: CloudSeat = { ...dm, id: "p", role: "player", purseIds: ["ilsa"] };
const coins = (gp: number) => ({ cp: 0, sp: 0, ep: 0, gp, pp: 0 });

function campaign(): CloudTable {
  const t: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      { id: "ilsa", name: "Ilsa Brann", kind: "character", coins: coins(50) },
      { id: "tor", name: "Tor", kind: "character", coins: coins(5) },
    ],
    journal: readJournal({
      requests: [
        { id: "pay-new", purseId: "ilsa", note: "Inn bill", copper: 300, at: 3000, status: "pending" },
        { id: "pay-old", purseId: "tor", note: "Ferry", copper: 80, at: 1000, status: "pending" },
        { id: "pay-big", purseId: "ilsa", note: "Warhorse", copper: 40000, at: 4000, status: "pending" },
        { id: "pay-done", purseId: "ilsa", note: "Old", copper: 1, at: 1, status: "approved" },
      ],
    }),
    loans: [
      { id: "loan-1", at: 2000, purseId: "tor", purseName: "Tor", copper: 1000, note: "Ship deposit", status: "pending" },
      { id: "loan-2", at: 1500, purseId: "tor", purseName: "Tor", copper: 1000, note: "Done", status: "denied" },
    ],
  };
  return t;
}

test("one queue: pending only, oldest first across types, undated after dated", () => {
  const t = campaign();
  const items = reviewItems(t);
  assert.deepEqual(
    items.map((i) => i.key),
    ["payment:pay-old", "loan:loan-1", "payment:pay-new", "payment:pay-big"],
  );
  assert.deepEqual(
    sortReviewItems([{ at: undefined, n: 1 }, { at: 5, n: 2 }, { at: undefined, n: 3 }, { at: 2, n: 4 }]).map((x) => x.n),
    [4, 2, 1, 3],
  );
});

test("cards carry who, what, amount and the balance after approval", () => {
  const items = reviewItems(campaign());
  const pay = items.find((i) => i.id === "pay-new")!;
  assert.equal(pay.who, "Ilsa Brann");
  assert.equal(pay.what, "Inn bill");
  assert.equal(pay.copper, 300);
  assert.equal(pay.balanceAfter, 5000 - 300);
  const loan = items.find((i) => i.id === "loan-1")!;
  assert.equal(loan.direction, "in");
  assert.equal(loan.balanceAfter, 500 + 1000);
});

test("chip counts, the Desk total and the imports count", () => {
  const items = reviewItems(campaign(), 2);
  const counts = reviewCounts(items);
  assert.equal(counts.payments, 3);
  assert.equal(counts.loans, 1);
  assert.equal(counts.imports, 2);
  assert.equal(counts.pool, 0);
  assert.equal(reviewTotal(items), 6);
  assert.equal(reviewTotal(reviewItems(emptyCloudTable())), 0);
  // An unknown imports count (loading, offline) adds nothing rather than a guessed zero entry.
  assert.equal(reviewItems(campaign(), null).some((i) => i.kind === "imports"), false);
});

test("approve all payments under N gp selects only pending payments strictly below the limit", () => {
  const items = reviewItems(campaign());
  assert.deepEqual(paymentsUnder(items, 10 * 100).map((i) => i.id), ["pay-old", "pay-new"]);
  assert.deepEqual(paymentsUnder(items, 300).map((i) => i.id), ["pay-old"]);
  assert.deepEqual(paymentsUnder(items, 0), []);
});

test("other request types join the same queue", () => {
  const t = campaign();
  t.journal = readJournal({
    ...t.journal,
    downtimeActivities: {
      requests: [
        {
          id: "tr-1", windowId: "w", trainerId: "ilsa", npcId: "npc", trainerName: "Ilsa Brann", npcName: "Old Garrick",
          category: "martial", topic: "Longsword", description: "", className: "", minutes: 480,
          trainingHoursPerDay: 8, status: "pending", at: 500,
        },
      ],
    },
  });
  const items = reviewItems(t);
  assert.equal(items[0].key, "training:tr-1");
  assert.equal(items[0].type, "training");
  assert.equal(reviewCounts(items).training, 1);
});

test("ages read as people say them", () => {
  const now = 10 * 86400000;
  assert.equal(reviewAge(undefined, now), "");
  assert.equal(reviewAge(now - 20000, now), "just now");
  assert.equal(reviewAge(now - 5 * 60000, now), "5 min ago");
  assert.equal(reviewAge(now - 3 * 3600000, now), "3 h ago");
  assert.equal(reviewAge(now - 86400000, now), "1 day ago");
  assert.equal(reviewAge(now - 3 * 86400000, now), "3 days ago");
});

// Bulk approval sends one payment-decision per payment, each with its own ID. A retry of the same
// ID, a second ID for the same request (a reload mid-way) and a player are all refused or no-ops.
const decide = (requestId: string): CommandInput => ({ kind: "payment-decision", requestId, status: "approved" });

test("shared: each approval charges once; a repeat after a reload is refused; players are refused", () => {
  let t = campaign();
  assert.throws(() => applyCommand(t, player, { ...decide("pay-new"), id: "bulk-p" }), /DM|dungeon master/i);
  t = applyCommand(t, dm, { ...decide("pay-old"), id: "bulk-1" });
  t = applyCommand(t, dm, { ...decide("pay-new"), id: "bulk-2" });
  assert.equal(toCopper(t.purses.find((p) => p.id === "tor")!.coins), 500 - 80);
  assert.equal(toCopper(t.purses.find((p) => p.id === "ilsa")!.coins), 5000 - 300);
  // The page reloaded mid-way and lost its IDs: a new ID for an approved request changes nothing.
  assert.throws(() => applyCommand(t, dm, { ...decide("pay-new"), id: "bulk-2-after-reload" }), /already decided/);
  assert.equal(toCopper(t.purses.find((p) => p.id === "ilsa")!.coins), 5000 - 300);
  assert.equal(reviewItems(t).filter((i) => i.kind === "payment").length, 1);
});

test("device: the same approvals run the same command once, with matching balances", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  await executeLocalCommand({ ...decide("pay-old"), id: "dev-1" } as never);
  await executeLocalCommand({ ...decide("pay-old"), id: "dev-1" } as never).catch(() => undefined);
  await assert.rejects(() => executeLocalCommand({ ...decide("pay-old"), id: "dev-1b" } as never), /already decided/);
  const shown = await economySnapshot();
  const shared = applyCommand(campaign(), dm, { ...decide("pay-old"), id: "dev-1" });
  assert.deepEqual(
    shown.purses.map((p) => [p.id, toCopper(p.coins)]),
    shared.purses.map((p) => [p.id, toCopper(p.coins)]),
  );
  assert.equal(shown.ledger.filter((l) => l.copper === -80).length, 1);
  assert.equal(shown.journal!.requests.find((r) => r.id === "pay-old")!.status, "approved");
});
