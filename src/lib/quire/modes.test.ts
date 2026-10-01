import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  openRoom,
  joinRoom,
  roomState,
  choosePace,
  closeRoom,
  submitCommands,
  manageRoom,
  passTurn,
  publishTurn,
} from "./cloud.server.ts";
import { emptyCloudTable } from "./cloud.ts";
import { emptyCoins } from "./money.ts";
import { applyCommand, tablePatch } from "./commands.ts";
import { verifyReportBase } from "./local-report.ts";
const sql = new DatabaseSync(":memory:");
sql.exec(
  readFileSync(new URL("../../../drizzle/0000_mysterious_lord_tyger.sql", import.meta.url), "utf8"),
);
(globalThis as any).__env__ = {
  DB: {
    prepare(query: string) {
      let args: any[] = [];
      return {
        bind(...v: any[]) {
          args = v;
          return this;
        },
        async first() {
          return sql.prepare(query).get(...args) ?? null;
        },
        async run() {
          return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } };
        },
      };
    },
  },
};
const coins = () => ({ ...emptyCoins(), gp: 10 });
const table = () => ({
  ...emptyCloudTable(),
  purses: [
    { id: "A", name: "A", kind: "character" as const, coins: coins() },
    { id: "B", name: "B", kind: "character" as const, coins: coins() },
    { id: "party", name: "Party", kind: "party" as const, coins: coins() },
  ],
  shops: [
    {
      id: "shop",
      name: "Shop",
      keeper: "NPC",
      place: "Town",
      notes: "",
      sellRate: 1,
      buyRate: 0.5,
      wealth: "modest" as const,
      category: "general" as const,
      priceScale: 1,
    },
  ],
  stock: [
    {
      id: "rope",
      shopId: "shop",
      name: "Rope",
      copper: 100,
      quantity: 1,
      notes: "",
      baseCopper: 100,
      rarity: "common" as const,
    },
  ],
});
async function setup(live = true) {
  const dm = await openRoom({ name: "DM", table: table() });
  const a = await joinRoom({ code: dm.code, purseId: "A", name: "A" });
  const b = await joinRoom({ code: dm.code, purseId: "B", name: "B" });
  if (live) await choosePace({ ...dm, live: true });
  return { dm, a, b };
}
const buy = (who = "A", id = crypto.randomUUID()) => ({
  id,
  kind: "buy" as const,
  purseId: who,
  stockId: "rope",
  quantity: 1,
});
test("authoritative simultaneous buyers cannot oversell the last item", async () => {
  const { dm, a, b } = await setup();
  const results = await Promise.allSettled([
    submitCommands({ code: dm.code, token: a.token, batchId: "A", commands: [buy()] }),
    submitCommands({ code: dm.code, token: b.token, batchId: "B", commands: [buy("B")] }),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  const state = await roomState(dm);
  assert.equal(state.table.stock[0].quantity, 0);
  assert.equal(state.table.holdings.length, 1);
  assert.equal(state.table.ledger.length, 1);
});
test("network retry neither repeats a purchase nor advances twice", async () => {
  const { dm, a } = await setup(false);
  await submitCommands({ ...dm, batchId: "dm-end", commands: [], endTurn: true });
  const request = {
    code: dm.code,
    token: a.token,
    batchId: "purchase",
    commands: [buy()],
    endTurn: true,
  };
  const first = await submitCommands(request),
    again = await submitCommands(request);
  assert.equal(again.revision, first.revision);
  assert.equal(again.who, "B");
  assert.equal(again.table.holdings.length, 1);
});
test("staged turn persists without changing server balances and blocks mode changes/skip/close", async () => {
  const { dm, a } = await setup(false);
  await submitCommands({ ...dm, batchId: "dm-end", commands: [], endTurn: true });
  const draft = await submitCommands({
    code: dm.code,
    token: a.token,
    batchId: "stage",
    commands: [buy()],
    stage: true,
  });
  assert.equal(draft.table.purses[0].coins.gp, 10);
  assert.equal(JSON.parse(draft.draft).length, 1);
  await assert.rejects(choosePace({ ...dm, live: true }), /pending/);
  await assert.rejects(passTurn(dm), /pending/);
  await assert.rejects(closeRoom(dm), /pending/);
});
test("new joins and chat preserve staged operations", async () => {
  const { dm, a } = await setup(false);
  await submitCommands({ ...dm, batchId: "end", commands: [], endTurn: true });
  await submitCommands({
    code: dm.code,
    token: a.token,
    batchId: "stage",
    commands: [buy()],
    stage: true,
  });
  await submitCommands({
    ...dm,
    batchId: "chat",
    commands: [{ id: "chat", kind: "message", to: "party", purseId: "", text: "Hello" }],
  });
  const state = await roomState({ code: dm.code, token: a.token });
  assert.equal(JSON.parse(state.draft).length, 1);
  assert.equal(state.table.notes[0].text, "Hello");
});
test("out-of-turn purchases rejected but messages accepted", async () => {
  const { dm, a } = await setup(false);
  await assert.rejects(
    submitCommands({ code: dm.code, token: a.token, batchId: "bad", commands: [buy()] }),
    /not your turn/,
  );
  await submitCommands({
    code: dm.code,
    token: a.token,
    batchId: "chat",
    commands: [{ id: "chat", kind: "message", to: "dm", purseId: "A", text: "Ready" }],
  });
  assert.equal((await roomState(dm)).who, "DM");
});
test("party spending requires explicit DM permission", async () => {
  const { dm, a } = await setup();
  await assert.rejects(
    submitCommands({ code: dm.code, token: a.token, batchId: "bad", commands: [buy("party")] }),
    /permission/,
  );
  await manageRoom({ ...dm, action: "permission", seatId: a.seatId, allowParty: true });
  await submitCommands({
    code: dm.code,
    token: a.token,
    batchId: "allowed",
    commands: [buy("party")],
  });
  assert.equal((await roomState(dm)).table.purses.find((p) => p.id === "party")?.coins.gp, 9);
});
test("released character can rejoin and old token is rejected", async () => {
  const { dm, a } = await setup();
  await manageRoom({ ...dm, action: "release", seatId: a.seatId });
  await assert.rejects(roomState({ code: dm.code, token: a.token }), /not seated/);
  const fresh = await joinRoom({ code: dm.code, purseId: "A", name: "Rejoined" });
  assert.notEqual(fresh.token, a.token);
});
test("non-DM cannot change permissions, release others, or submit arbitrary balance patches", async () => {
  const { dm, a, b } = await setup();
  await assert.rejects(
    manageRoom({ code: dm.code, token: a.token, action: "release", seatId: b.seatId }),
    /Only/,
  );
  await assert.rejects(
    submitCommands({
      code: dm.code,
      token: a.token,
      batchId: "fake",
      commands: [{ id: "fake", kind: "patch", changes: [] }],
    }),
    /Only/,
  );
});
test("legacy snapshot endpoint is disabled", async () => {
  const { dm } = await setup();
  await assert.rejects(publishTurn({ ...dm, table: table() }), /older sharing protocol/);
});
test("invalid quantities and insufficient funds are rejected with no partial writes", async () => {
  const { dm, a } = await setup();
  await assert.rejects(
    submitCommands({
      code: dm.code,
      token: a.token,
      batchId: "nan",
      commands: [{ ...buy(), quantity: -1 }],
    }),
  );
  await assert.rejects(
    submitCommands({
      code: dm.code,
      token: a.token,
      batchId: "too-much",
      commands: [
        {
          id: "give",
          kind: "give",
          fromId: "A",
          toId: "B",
          copper: 100000,
          holdingId: null,
          quantity: 0,
        },
      ],
    }),
    /Insufficient/,
  );
  assert.equal((await roomState(dm)).table.purses[0].coins.gp, 10);
});
test("duplicate loan decisions cannot credit twice", async () => {
  const { dm, a } = await setup();
  await submitCommands({
    code: dm.code,
    token: a.token,
    batchId: "loan",
    commands: [{ id: "loan", kind: "loan", purseId: "A", copper: 100, note: "Food" }],
  });
  await submitCommands({
    ...dm,
    batchId: "approve",
    commands: [{ id: "approve", kind: "decision", loanId: "loan", status: "approved" }],
  });
  await assert.rejects(
    submitCommands({
      ...dm,
      batchId: "approve-again",
      commands: [{ id: "approve2", kind: "decision", loanId: "loan", status: "approved" }],
    }),
    /already/,
  );
  assert.equal((await roomState(dm)).table.purses[0].coins.gp, 11);
});
test("DM patches preserve unrelated concurrent changes and reject conflicting edits", () => {
  const start = table();
  const edited = structuredClone(start);
  edited.shops[0].name = "New shop";
  const patch = { ...tablePatch(start, edited), id: "patch" };
  const elsewhere = structuredClone(start);
  elsewhere.purses[0].coins.gp = 9;
  const dm = { id: "dm", token: "dm", name: "DM", role: "dm" as const, purseIds: [] };
  assert.equal(applyCommand(elsewhere, dm, patch).purses[0].coins.gp, 9);
  elsewhere.shops[0].name = "Another name";
  assert.throws(() => applyCommand(elsewhere, dm, patch), /Conflict/);
});
test("Local reports reject stale stock and balance snapshots and legacy reports", () => {
  const base = { purses: table().purses, holdings: [], stock: table().stock };
  const changed = structuredClone(base);
  changed.stock[0].quantity = 0;
  const incoming = structuredClone(base);
  incoming.stock[0].quantity = 0;
  assert.throws(() => verifyReportBase(base, changed, incoming), /stock/);
  changed.stock[0].quantity = 1;
  changed.purses[0].coins.gp = 9;
  assert.throws(() => verifyReportBase(base, changed, incoming), /funds/);
  assert.throws(() => verifyReportBase(undefined, base, incoming), /older/);
});
test("discarding a turn removes staged operations and permits safe mode switch", async () => {
  const { dm, a } = await setup(false);
  await submitCommands({ ...dm, batchId: "end", commands: [], endTurn: true });
  await submitCommands({
    code: dm.code,
    token: a.token,
    batchId: "stage",
    commands: [buy()],
    stage: true,
  });
  await manageRoom({ code: dm.code, token: a.token, action: "discard", seatId: a.seatId });
  await choosePace({ ...dm, live: true });
  assert.equal((await roomState(dm)).table.stock[0].quantity, 1);
});
test("acknowledgments let a client recover a committed purchase after losing the response", async () => {
  const { dm, a } = await setup();
  const command = buy();
  await submitCommands({
    code: dm.code,
    token: a.token,
    batchId: "lost-response",
    commands: [command],
  });
  const state = await roomState({ code: dm.code, token: a.token });
  assert.ok(state.acknowledged.includes(command.id));
  assert.equal(state.table.holdings.length, 1);
});
