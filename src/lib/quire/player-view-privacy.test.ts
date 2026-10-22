import "./commands.ts";
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
  npcBarterQuote,
  type RoomView,
} from "./cloud.server.ts";
import { readNpcBarter } from "./npc-barter.ts";
import { defaultBarterRules } from "./npc-barter-schema.ts";
import { canonicalJson } from "./canonical-json.ts";
import { tradeFixture } from "./test-fixtures/trade-economy.ts";
import { exchangeQuoteKey } from "./trade-economy.ts";
import { toCopper } from "./money.ts";
import { characterPosition } from "./character-position.ts";
import { projectRecord } from "./session-records.ts";

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

test("NPC barter: players receive only their own attempts and a public quote; a retried offer is never rolled twice", async () => {
  const { dm, a, b } = await privacyRoom();
  await submitCommands({
    ...dm,
    batchId: "barter-setup",
    commands: [
      { id: "barter-rules", kind: "npc-barter-rules", revision: 0, rules: { ...defaultBarterRules(), mode: "auto", receivePercent: 37, stance: "shrewd" } },
      { id: "barter-item", kind: "npc-item", npcId: "near-npc", item: { name: "Lantern", quantity: 3, unitCopper: 500, notes: "" } },
    ],
  });
  const host = (await roomState(dm)).table;
  const lantern = host.holdings.find((h) => h.purseId === "near-npc" && h.name === "Lantern")!;
  const offerFor = (purseId: string, id: string) => ({
    id,
    kind: "npc-barter-offer",
    npcId: "near-npc",
    purseId,
    give: { purseId, copper: 400, items: [] },
    ask: { purseId: "near-npc", copper: 0, items: [{ holdingId: lantern.id, quantity: 1, before: canonicalJson(lantern) }] },
    reply: "persuade",
  });
  const aAuth = { code: dm.code, token: a.token },
    bAuth = { code: dm.code, token: b.token };
  // The public quote has the DC and odds, never the NPC's valuation.
  const quote = await npcBarterQuote({ ...aAuth, ...offerFor("a", "q") });
  assert.equal("received" in quote || "given" in quote || "ratio" in quote, false);
  assert.equal(quote.kind, "check");
  assert.equal(quote.dc, 17, "400 for 500 is 80%: DC 15, Shrewd +2");
  await assert.rejects(npcBarterQuote({ ...bAuth, ...offerFor("a", "q") }), /Only this character's player/);
  // Staged (turn draft) barter is refused: the room answers it directly.
  await assert.rejects(submitCommands({ ...aAuth, batchId: "a-stage", commands: [offerFor("a", "a-staged")], stage: true }), /answered by the room directly/);
  await submitCommands({ ...aAuth, batchId: "a-barter", commands: [offerFor("a", "a-offer")] });
  const first = readNpcBarter((await roomState(dm)).table.journal!.world!).attempts;
  assert.equal(first.length, 1);
  assert.ok(first[0].roll, "the room server rolled");
  // A retry of the same action (a fresh batch after a lost response) changes nothing.
  await submitCommands({ ...aAuth, batchId: "a-barter-retry", commands: [offerFor("a", "a-offer")] });
  const again = readNpcBarter((await roomState(dm)).table.journal!.world!).attempts;
  assert.equal(again.length, 1);
  assert.deepEqual(again[0].roll, first[0].roll);
  await submitCommands({ ...bAuth, batchId: "b-barter", commands: [offerFor("b", "b-offer")] }).catch(() => undefined);
  const aView = (await roomState(aAuth)).table,
    bView = (await roomState(bAuth)).table;
  const aState = readNpcBarter(aView.journal!.world!);
  assert.deepEqual(aState.attempts.map((x) => x.purseId), ["a"]);
  assert.equal(aState.attempts[0].quote.received + aState.attempts[0].quote.given + aState.attempts[0].quote.ratio, 0);
  assert.equal(aState.rules.receivePercent, 50, "the DM's rules never reach players");
  assert.ok(readNpcBarter(bView.journal!.world!).attempts.every((x) => x.purseId === "b"));
  const json = JSON.stringify(aView);
  assert.doesNotMatch(json, /user-a"|"receivePercent":37|"stance":"shrewd"/);
  const near = aView.journal!.world!.npcs.find((n) => n.id === "near-npc")!;
  assert.deepEqual(Object.keys(near.barter ?? {}), ["lines"]);
  // The DM still sees the valuation.
  assert.ok(readNpcBarter((await roomState(dm)).table.journal!.world!).attempts[0].quote.given > 0);
});

test("party balances and ledger lines reach only party players; a non-party player keeps their own", async () => {
  const { dm, a, b, c } = await privacyRoom();
  const auth = (seat: { token: string }) => ({ code: dm.code, token: seat.token });
  // A (account seat) buys too, so A has a ledger line of its own.
  const e = (await roomState(dm)).table.journal!.tradeEconomy!;
  await submitCommands({
    ...auth(a),
    batchId: "a-buys",
    commands: [
      {
        id: "a-trade",
        kind: "trade-buy",
        exchangeId: "harbor",
        commodityId: "timber",
        purseId: "a",
        quantity: 1,
        before: exchangeQuoteKey(e, e.exchanges[0], e.commodities[0]),
      },
    ],
  });
  // Guest B's character leaves the party (DM placement); A (account) and guest C stay with it.
  let host = (await roomState(dm)).table;
  await submitCommands({
    ...dm,
    batchId: "b-leaves",
    commands: [
      {
        id: "b-leaves",
        kind: "character-position",
        purseId: "b",
        before: characterPosition(host, host.purses.find((p) => p.id === "b")!),
        inParty: false,
        locationId: "dock",
        visible: true,
        sheetVisible: true,
      },
    ],
  });
  host = (await roomState(dm)).table;
  const hostCoins = (id: string) => toCopper(host.purses.find((p) => p.id === id)!.coins);
  assert.ok(hostCoins("a") > 0 && hostCoins("c") > 0 && hostCoins("party") > 0);
  assert.ok(host.ledger.some((l) => l.purseId === "a"));
  const coins = (t: RoomView["table"], id: string) => {
    const p = t.purses.find((p) => p.id === id);
    return p ? toCopper(p.coins) : 0;
  };
  const lines = (t: RoomView["table"], id: string) => t.ledger.filter((l) => l.purseId === id);
  const views = async (seat: { token: string }, label: string) => [
    { label: `${label} roomState`, t: (await roomState(auth(seat))).table },
    {
      label: `${label} pollRoom`,
      t: ((await pollRoom({ ...auth(seat), knownRevision: -1, knownSeatId: "" })) as RoomView).table,
    },
    {
      label: `${label} submitCommands`,
      t: (await submitCommands({ ...auth(seat), batchId: `${label}-noop`, commands: [] })).table,
    },
  ];

  // Party viewers (account seat A, guest seat C) see each other's balances and ledger lines,
  // exactly as before. (The party treasury is only sent to seats the DM lets use it.)
  for (const { label, t } of [...(await views(a, "A")), ...(await views(c, "C"))]) {
    for (const id of ["a", "c"]) assert.equal(coins(t, id), hostCoins(id), `${label}: ${id}`);
    assert.ok(lines(t, "a").length > 0, `${label}: A's ledger lines`);
  }

  // Non-party viewer B (guest) receives no party balances or ledger lines in the raw payload...
  for (const { label, t } of await views(b, "B")) {
    for (const id of ["a", "c", "party"]) {
      assert.equal(coins(t, id), 0, `${label}: ${id} balance sent to a non-party player`);
      assert.equal(lines(t, id).length, 0, `${label}: ${id} ledger lines sent to a non-party player`);
    }
    // ...but always its own purse, exactly as stored, and its own ledger lines.
    assert.deepEqual(t.purses.find((p) => p.id === "b"), host.purses.find((p) => p.id === "b"), label);
    assert.deepEqual(
      lines(t, "b").map((l) => l.id),
      lines(host, "b").map((l) => l.id),
      `${label}: own ledger`,
    );
    assert.ok(lines(t, "b").length > 0, `${label}: own ledger lines`);
  }
  // A player outside the party is not a party player: party members no longer receive B's balance.
  for (const { label, t } of await views(a, "A-after")) {
    assert.equal(coins(t, "b"), 0, `${label}: non-party B's balance`);
    assert.equal(lines(t, "b").length, 0, `${label}: non-party B's ledger lines`);
  }

  // B rejoins the party: B again sees party balances and the party again sees B's.
  host = (await roomState(dm)).table;
  await submitCommands({
    ...dm,
    batchId: "b-returns",
    commands: [
      {
        id: "b-returns",
        kind: "character-position",
        purseId: "b",
        before: characterPosition(host, host.purses.find((p) => p.id === "b")!),
        inParty: true,
        locationId: null,
        visible: true,
        sheetVisible: true,
      },
    ],
  });
  host = (await roomState(dm)).table;
  const back = (await roomState(auth(b))).table;
  for (const id of ["a", "c"]) assert.equal(coins(back, id), hostCoins(id), `B back: ${id}`);
  assert.equal(coins((await roomState(auth(a))).table, "b"), hostCoins("b"));

  // The DM is unaffected.
  const dmView = (await roomState(dm)).table;
  for (const id of ["a", "b", "c", "party"]) assert.equal(coins(dmView, id), hostCoins(id), `DM ${id}`);
});

test("device projection: a non-party player gets only their own balance and ledger lines", async () => {
  const { dm, b } = await privacyRoom();
  let host = (await roomState(dm)).table;
  await submitCommands({
    ...dm,
    batchId: "b-leaves",
    commands: [
      {
        id: "b-leaves",
        kind: "character-position",
        purseId: "b",
        before: characterPosition(host, host.purses.find((p) => p.id === "b")!),
        inParty: false,
        locationId: "dock",
        visible: true,
        sheetVisible: true,
      },
    ],
  });
  host = (await roomState(dm)).table;
  // The offline/device player projection (economyView) and the projection of the payload B receives.
  const raw = (await roomState({ code: dm.code, token: b.token })).table;
  for (const [label, source] of [
    ["host table", host],
    ["B's room payload", raw],
  ] as const) {
    const t = projectRecord(source, { role: "player", purseIds: ["b"] }, { directory: true });
    for (const p of t.purses.filter((p) => p.id !== "b"))
      assert.equal(toCopper(p.coins), 0, `${label}: ${p.id} balance`);
    assert.equal(t.ledger.every((l) => l.purseId === "b"), true, `${label}: ledger`);
    assert.equal(
      toCopper(t.purses.find((p) => p.id === "b")!.coins),
      toCopper(host.purses.find((p) => p.id === "b")!.coins),
      `${label}: own balance`,
    );
    assert.ok(t.ledger.some((l) => l.purseId === "b"), `${label}: own ledger`);
  }
});
