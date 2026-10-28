// Session chip and "Since last session" (design D5, Q7): read-only summaries of existing records.
import assert from "node:assert/strict";
import test from "node:test";
import { readJournal } from "./journal.ts";
import { sessionChipLabel, sessionDigest, sessionStatus } from "./session-digest.ts";

const coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
const line = (id: string, at: number, copper: number, extra: Record<string, unknown> = {}) =>
  ({ id, at, purseId: "mira", copper, summary: "Line", ...extra }) as never;

test("the chip names the running session and the campaign day", () => {
  const journal = readJournal({
    sessions: [
      { id: "a", name: "One", startedAt: 1, endedAt: 2 },
      { id: "b", name: "Two", startedAt: 3 },
    ],
    finance: undefined,
  });
  const status = sessionStatus(journal);
  assert.deepEqual([status.number, status.active, status.name], [2, true, "Two"]);
  assert.equal(sessionChipLabel(status), "Session 2 · day 0");
  const idle = sessionStatus(readJournal({ sessions: [{ id: "a", name: "One", startedAt: 1, endedAt: 2 }] }));
  assert.equal(sessionChipLabel(idle), "No session · day 0");
  assert.equal(idle.number, 2);
  const named = readJournal({
    sessions: [
      { id: "a", name: "Session 11 · The Archive", startedAt: 1, endedAt: 2 },
      { id: "b", name: "Session 12 · Smugglers", startedAt: 3 },
    ],
  });
  assert.equal(sessionStatus(named).number, 12, "the number in the session name wins");
  named.sessions[1].endedAt = 4;
  assert.equal(sessionStatus(named).number, 13);
});

test("since the last ended session: awards, money in and out, characters away", () => {
  const journal = readJournal({
    sessions: [
      { id: "a", name: "Old", startedAt: 1, endedAt: 50 },
      { id: "b", name: "Last", startedAt: 60, endedAt: 100 },
    ],
    world: {
      characterPositions: [{ purseId: "bram", inParty: false, locationId: null, visible: true, sheetVisible: true }],
    },
  });
  const digest = sessionDigest({
    journal,
    purses: [
      { id: "mira", name: "Mira", kind: "character", coins },
      { id: "bram", name: "Bram", kind: "character", coins },
      { id: "npc", name: "Guide", kind: "character", control: "npc", coins },
    ] as never,
    ledger: [
      line("before", 99, 5000),
      line("coins", 120, 3000, { award: { receiptId: "r1", role: "coins" } }),
      line("item", 120, 0, { award: { receiptId: "r1", role: "item", quantity: 2, unitCopper: 750 } }),
      line("spent", 130, -400, { transactionType: "purchase" }),
      line("moved", 140, -1000, { transactionType: "transfer" }),
    ],
  });
  assert.equal(digest.since, 100);
  assert.equal(digest.sinceName, "Last");
  assert.equal(digest.lootAwards, 1);
  assert.equal(digest.lootCopper, 4500);
  assert.equal(digest.moneyIn, 3000);
  assert.equal(digest.moneyOut, 400, "transfers between campaign accounts are not spending");
  assert.deepEqual(digest.away, ["Bram"]);
});

test("no ended session: nothing to summarize yet", () => {
  const digest = sessionDigest({ journal: readJournal({}), purses: [], ledger: [line("x", 5, 100)] });
  assert.equal(digest.since, null);
  assert.equal(digest.moneyIn, 0);
});
