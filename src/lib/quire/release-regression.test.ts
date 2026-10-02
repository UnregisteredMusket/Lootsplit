import assert from "node:assert/strict";
import test from "node:test";
import { sessionSummary, readJournal, preserveJournalMetadata } from "./journal.ts";
import { validateEconomyRows } from "./validation.ts";
import { emptyCloudTable } from "./cloud.ts";

test("explicit transfer classification survives changed labels while old saves retain fallback", () => {
  const base = { id: "a", at: 2, purseId: "pc", shopId: null, copper: 100 };
  const session = { id: "s", name: "Session", startedAt: 1 };
  const ledger = [
    { ...base, summary: "A translated label", transactionType: "transfer" as const },
    { ...base, id: "b", summary: "Transfer received" },
    { ...base, id: "c", summary: "Transfer received", transactionType: "sale" as const },
  ];
  assert.deepEqual(sessionSummary(ledger, session), { net: 300, received: 100, spent: 0 });
  validateEconomyRows({ ...emptyCloudTable(), ledger });
});

test("structured history round-trips without inventing values for old events", () => {
  const value = {
    events: [
      { id: "old", at: 1, summary: "Old price", kind: "prices" },
      {
        id: "new",
        at: 2,
        summary: "Price",
        kind: "prices",
        change: {
          entity: "stock",
          entityId: "item",
          before: { copper: 10 },
          after: { copper: 20 },
        },
      },
    ],
  };
  const journal = readJournal(JSON.parse(JSON.stringify(value)));
  assert.equal(journal.events[0]?.change, undefined);
  assert.equal(journal.events[1]?.change?.after?.copper, 20);
  assert.throws(() =>
    readJournal({
      events: [
        {
          ...value.events[1],
          change: { entity: "stock", before: {}, after: { copper: Infinity } },
        },
      ],
    }),
  );
});

test("old clients cannot erase structured history simply by omitting new metadata", () => {
  const current = readJournal({ events: [{ id: "e", at: 1, kind: "prices", summary: "Price", change: { entity: "stock", before: { copper: 1 }, after: { copper: 2 } } }] });
  const old = { ...current, events: current.events.map(({ change, ...event }) => event) };
  assert.deepEqual(preserveJournalMetadata(old, current), current);
});
