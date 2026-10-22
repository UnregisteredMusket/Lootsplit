import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  openRoom,
  joinRoom,
  roomState,
  pollRoom,
  submitCommands,
  choosePace,
  type RoomView,
} from "./cloud.server.ts";
import { tradeFixture } from "./test-fixtures/trade-economy.ts";
import { exchangeQuoteKey } from "./trade-economy.ts";
import { toCopper } from "./money.ts";
import { characterPosition } from "./character-position.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of ["0001_campaign_rooms.sql", "0003_accounts.sql", "0008_encounters.sql"])
  sql.exec(readFileSync(new URL(`../../../cloudflare/migrations/${file}`, import.meta.url), "utf8"));
sql.exec(`INSERT INTO "user" VALUES ('user-a','A','a@example.invalid',1,null,0,0)`);
(globalThis as any).__env__ = {
  DB: {
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(query: string) {
      let values: any[] = [];
      return {
        bind(...args: any[]) {
          values = args;
          return this;
        },
        async all() {
          if (query.includes("FROM play_characters")) return { results: [] };
          return { results: sql.prepare(query).all(...values) };
        },
        async first() {
          return sql.prepare(query).get(...values) ?? null;
        },
        async run() {
          return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } };
        },
      };
    },
  },
};

// Command IDs deliberately omit the NPC ID, so the JSON check below finds only real leaks.
const npc = (id: string, locationId: string, visible: boolean, gp: number, controllerPurseId: string | null = null) => ({
  id: `create-${locationId}-${gp}`,
  kind: "npc-create",
  npc: {
    id,
    name: `NPC ${id}`,
    description: "Private NPC text",
    locationId,
    visible,
    barterAllowed: true,
    controllerPurseId,
  },
  copper: gp * 100,
  inventory: [],
});

/** DM + players A (account seat), B and C (guest seats); NPCs here, elsewhere and hidden; funded treasury. */
async function privacyRoom() {
  const table = tradeFixture();
  table.purses.push({
    id: "c",
    name: "Cato",
    kind: "character",
    coins: { cp: 0, sp: 0, ep: 0, gp: 42, pp: 0 },
  });
  const dm = await openRoom({ name: "Privacy DM", table });
  const a = await joinRoom({ code: dm.code, purseId: "a", name: "A", userId: "user-a" });
  const b = await joinRoom({ code: dm.code, purseId: "b", name: "B" });
  const c = await joinRoom({ code: dm.code, purseId: "c", name: "C" });
  await choosePace({ ...dm, live: true });
  await submitCommands({
    ...dm,
    batchId: "npcs",
    commands: [
      npc("far-npc", "desert", true, 7777),
      npc("near-npc", "dock", true, 1234),
      npc("hidden-npc", "dock", false, 555),
      npc("agent-npc", "dock", true, 321, "c"),
    ],
  });
  await submitCommands({
    ...dm,
    batchId: "funds",
    commands: [
      { id: "far-funds", kind: "npc-funds", npcId: "far-npc", before: 777700, copper: 777800 },
      { id: "near-funds", kind: "npc-funds", npcId: "near-npc", before: 123400, copper: 123500 },
      { id: "hidden-funds", kind: "npc-funds", npcId: "hidden-npc", before: 55500, copper: 55600 },
    ],
  });
  const e = (await roomState(dm)).table.journal!.tradeEconomy!;
  await submitCommands({
    code: dm.code,
    token: b.token,
    batchId: "b-buys",
    commands: [
      {
        id: "b-trade",
        kind: "trade-buy",
        exchangeId: "harbor",
        commodityId: "timber",
        purseId: "b",
        quantity: 1,
        before: exchangeQuoteKey(e, e.exchanges[0], e.commodities[0]),
      },
    ],
  });
  const host = (await roomState(dm)).table;
  return { dm, a, b, c, host };
}

const npcIds = ["far-npc", "near-npc", "hidden-npc", "agent-npc"];

function assertPrivate(view: RoomView, own: string[], host: RoomView["table"], label: string) {
  const t = view.table;
  const treasuries = new Set(
    host.journal!.tradeEconomy!.exchanges.map((x) => x.purseId).concat("exchange-treasury"),
  );
  const npcOrTreasury = (id: string) =>
    npcIds.includes(id) || treasuries.has(id) || host.purses.find((p) => p.id === id)?.control === "npc";
  // Nothing about the hidden NPC, and nothing for NPCs that are not listed.
  assert.equal(JSON.stringify(t).includes("hidden-npc"), false, `${label}: hidden NPC leaked`);
  for (const p of t.purses) {
    if (own.includes(p.id)) continue;
    if (npcOrTreasury(p.id))
      assert.equal(toCopper(p.coins), 0, `${label}: ${p.id} balance projected`);
    assert.equal("permissions" in p, false, `${label}: ${p.id} permissions projected`);
    assert.equal("editingAllowed" in p, false, `${label}: ${p.id} editingAllowed projected`);
    assert.equal("sheetReadOnlyForDm" in p, false, `${label}: ${p.id} sheetReadOnlyForDm projected`);
    assert.equal("editBaseline" in p, false, `${label}: ${p.id} edit baseline projected`);
    assert.equal("rolls" in p, false, `${label}: ${p.id} rolls projected`);
  }
  for (const l of t.ledger.filter((l) => !own.includes(l.purseId)))
    assert.equal(npcOrTreasury(l.purseId), false, `${label}: ledger line ${l.id} for ${l.purseId}`);
  assert.equal(
    t.ledger.some((l) => !own.includes(l.purseId) && /NPC funds/.test(l.summary)),
    false,
    `${label}: NPC funds ledger line projected`,
  );
}

test("player room views never project NPC or treasury balances, their ledger lines or hidden NPCs", async () => {
  const { dm, a, b, c, host } = await privacyRoom();
  // The fixture really holds the private balances the players must not see.
  assert.equal(toCopper(host.purses.find((p) => p.id === "far-npc")!.coins), 777800);
  assert.equal(toCopper(host.purses.find((p) => p.id === "near-npc")!.coins), 123500);
  assert.ok(toCopper(host.purses.find((p) => p.id === "exchange-treasury")!.coins) > 50000);
  assert.ok(host.ledger.some((l) => l.purseId === "exchange-treasury"));

  const seats = [
    { auth: { code: dm.code, token: a.token }, own: ["a"], label: "account seat A" },
    { auth: { code: dm.code, token: b.token }, own: ["b"], label: "guest seat B" },
    { auth: { code: dm.code, token: c.token }, own: ["c", "agent-npc"], label: "guest seat C" },
  ];
  for (const { auth, own, label } of seats) {
    const state = await roomState(auth);
    assertPrivate(state, own, host, `${label} roomState`);
    const poll = await pollRoom({ ...auth, knownRevision: -1, knownSeatId: "" });
    assert.ok("table" in poll);
    assertPrivate(poll as RoomView, own, host, `${label} pollRoom`);
    const submitted = await submitCommands({ ...auth, batchId: `${own[0]}-noop`, commands: [] });
    assertPrivate(submitted, own, host, `${label} submitCommands`);
  }
  // Visible NPC records stay listed by name for the party; only their balances are private.
  const aView = (await roomState(seats[0].auth)).table;
  assert.ok(aView.purses.some((p) => p.id === "near-npc"));
  assert.ok(aView.journal!.world!.npcs.some((n) => n.id === "near-npc"));
  // A delegated NPC controller keeps that NPC's funds readout for barter; nobody else does.
  const agent = (v: RoomView) => v.table.purses.find((p) => p.id === "agent-npc")!;
  assert.equal(toCopper(agent(await roomState(seats[2].auth)).coins), 32100);
  assert.equal(toCopper(agent(await roomState(seats[0].auth)).coins), 0);
  assert.equal("permissions" in agent(await roomState(seats[2].auth)), false);
});

test("owner decision: party players' balances and ledger lines stay visible; the seat keeps its own purse in full", async () => {
  const { dm, a, host } = await privacyRoom();
  const view = (await roomState({ code: dm.code, token: a.token })).table;
  const coins = (t: RoomView["table"], id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);
  for (const id of ["a", "b", "c"]) assert.equal(coins(view, id), coins(host, id), id);
  // B's purchase line remains visible to A (existing shared readout, kept by owner decision 2026-10-22).
  assert.ok(view.ledger.some((l) => l.purseId === "b"));
  // A's own purse is returned exactly as stored.
  assert.deepEqual(
    view.purses.find((p) => p.id === "a"),
    host.purses.find((p) => p.id === "a"),
  );
  // The DM still sees everything.
  const dmView = (await roomState(dm)).table;
  assert.equal(coins(dmView, "far-npc"), 777800);
  assert.ok(dmView.ledger.some((l) => l.id === "far-funds"));
});

test("DM toggle: party companion NPC funds are private when off, readable by party players when on, never for hidden NPCs", async () => {
  const { dm, a, b, c } = await privacyRoom();
  const auth = (seat: { token: string }) => ({ code: dm.code, token: seat.token });
  const place = async (purseId: string, inParty: boolean, visible = true) => {
    const host = (await roomState(dm)).table;
    const before = characterPosition(host, host.purses.find((p) => p.id === purseId)!);
    await submitCommands({
      ...dm,
      batchId: `place-${purseId}`,
      commands: [
        {
          id: `place-${purseId}`,
          kind: "character-position",
          purseId,
          before,
          inParty,
          locationId: inParty ? null : "dock",
          visible,
          sheetVisible: visible,
        },
      ],
    });
  };
  // Companions: a visible NPC, C's delegated NPC and a hidden NPC travel with the party; B stays behind.
  await place("near-npc", true);
  await place("agent-npc", true);
  await place("hidden-npc", true, false);
  await place("b", false);
  const coins = (v: RoomView, id: string) => {
    const p = v.table.purses.find((p) => p.id === id);
    return p ? toCopper(p.coins) : undefined;
  };
  const lines = (v: RoomView, id: string) => v.table.ledger.filter((l) => l.purseId === id).length;

  // Off (default): today's behaviour.
  const offA = await roomState(auth(a));
  assertPrivate(offA, ["a"], (await roomState(dm)).table, "setting off, A");
  assert.equal(coins(offA, "near-npc"), 0);
  assert.equal(lines(offA, "near-npc"), 0);
  // The controller keeps its NPC's funds readout either way, without permissions.
  const offC = await roomState(auth(c));
  assert.equal(coins(offC, "agent-npc"), 32100);
  assert.equal("permissions" in offC.table.purses.find((p) => p.id === "agent-npc")!, false);

  // Only the DM may change the setting; the server refuses players and guests.
  for (const seat of [a, b, c])
    await assert.rejects(
      submitCommands({
        ...auth(seat),
        batchId: `toggle-${seat.token}`,
        commands: [
          {
            id: `toggle-${seat.token}`,
            kind: "companion-funds-visibility",
            before: false,
            visible: true,
          },
        ],
      }),
      /Only the DM/,
    );
  assert.equal((await roomState(dm)).table.journal!.world!.companionFundsVisible, undefined);
  await submitCommands({
    ...dm,
    batchId: "companions-on",
    commands: [
      { id: "companions-on", kind: "companion-funds-visibility", before: false, visible: true },
    ],
  });

  // On: party player A reads visible companions' coins and ledger lines, read-only.
  for (const view of [
    await roomState(auth(a)),
    (await pollRoom({ ...auth(a), knownRevision: -1, knownSeatId: "" })) as RoomView,
    await submitCommands({ ...auth(a), batchId: "a-noop-on", commands: [] }),
  ]) {
    assert.equal(coins(view, "near-npc"), 123500);
    assert.equal(coins(view, "agent-npc"), 32100);
    assert.ok(view.table.ledger.some((l) => l.id === "near-funds"));
    for (const id of ["near-npc", "agent-npc"]) {
      const p = view.table.purses.find((p) => p.id === id)!;
      assert.equal("permissions" in p || "editingAllowed" in p || "editBaseline" in p, false, id);
    }
    // Hidden companion, NPCs elsewhere and treasuries stay private.
    assert.equal(JSON.stringify(view.table).includes("hidden-npc"), false, "hidden NPC leaked");
    assert.equal(coins(view, "far-npc") ?? 0, 0);
    assert.equal(lines(view, "far-npc"), 0);
    assert.equal(coins(view, "exchange-treasury") ?? 0, 0);
    assert.equal(lines(view, "exchange-treasury"), 0);
  }
  // A player whose character is not with the party does not get companions' funds.
  const onB = await roomState(auth(b));
  assert.equal(coins(onB, "near-npc") ?? 0, 0);
  assert.equal(lines(onB, "near-npc"), 0);
  assert.equal(JSON.stringify(onB.table).includes("hidden-npc"), false);
  // The controller still sees its NPC, and now the other companion too.
  const onC = await roomState(auth(c));
  assert.equal(coins(onC, "agent-npc"), 32100);
  assert.equal(coins(onC, "near-npc"), 123500);
  // The DM's view is unchanged.
  assert.equal(coins(await roomState(dm), "hidden-npc"), 55600);
});
