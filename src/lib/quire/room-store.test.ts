import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createRoom, readRoom, updateRoom, deleteRoom } from "./room-store.server.ts";
import { emptyCloudTable } from "./cloud.ts";
import { openRoom, joinRoom, roomState, previewRoom, submitCommands } from "./cloud.server.ts";
import { emptyCoins } from "./money.ts";
import {
  pushSettings,
  setPushSubscription,
  validPushEndpoint,
  pushAuthorization,
} from "./push.server.ts";
import { jwtVerify, importJWK } from "jose";
const sql = new DatabaseSync(":memory:");
test("property purchases and deed transfers persist once across lost responses and independent player reads", async () => {
  const { choosePace } = await import("./cloud.server.ts");
  const { blankShop } = await import("./economy.ts");
  const table = { ...emptyCloudTable(), purses: ["buyer", "recipient"].map(id => ({ id, name: id, kind: "character" as const, coins: { ...emptyCoins(), gp: id === "buyer" ? 100 : 0 } })),
    shops: [{ ...blankShop(), id: "broker", category: "mixed" as const, buyRate: 0.5 }],
    journal: { sessions: [], requests: [], events: [], market: { currentLocationId: "coast", locations: ["coast", "desert"].map(id => ({ id, name: id, kind: "region" as const, parentId: null, description: "" })) } },
    listings: [{ id: "mill", name: "Mill", kind: "property" as const, copper: 5000, quantity: 1, notes: "", locationId: "coast", property: { type: "workshop" as const, features: ["Waterwheel"] } },
      { id: "remote", name: "Remote keep", kind: "property" as const, copper: 2000, quantity: 1, notes: "", locationId: "desert" }] };
  const host = await openRoom({ name: "DM", table }), buyer = await joinRoom({ code: host.code, purseId: "buyer", name: "Buyer" }), recipient = await joinRoom({ code: host.code, purseId: "recipient", name: "Recipient" });
  await choosePace({ ...host, live: true });
  const buyerAuth = { code: host.code, token: buyer.token }, recipientAuth = { code: host.code, token: recipient.token };
  assert.deepEqual((await roomState(buyerAuth)).table.listings.map(l => l.id), ["mill"]);
  const purchase = { id: "deed-purchase", kind: "listing", listingId: "mill", purseId: "buyer", quantity: 1, before: table.listings[0] };
  await submitCommands({ ...buyerAuth, batchId: "deed-buy", commands: [purchase] });
  await submitCommands({ ...buyerAuth, batchId: "deed-buy", commands: [purchase] });
  await submitCommands({ ...buyerAuth, batchId: "buy-response-lost", commands: [purchase] });
  const bought = (await roomState(buyerAuth)).table;
  assert.equal(bought.holdings.length, 1); assert.equal(bought.ledger.length, 1); assert.equal(bought.holdings[0].deed!.totalCopper, 5000);
  assert.equal((await roomState(recipientAuth)).table.holdings.length, 0);
  const transfer = { id: "deed-transfer", kind: "give", fromId: "buyer", toId: "recipient", copper: 0, holdingId: bought.holdings[0].id, quantity: 1 };
  await submitCommands({ ...buyerAuth, batchId: "transfer-first", commands: [transfer] });
  await submitCommands({ ...buyerAuth, batchId: "transfer-response-lost", commands: [transfer] });
  assert.equal((await roomState(buyerAuth)).table.holdings.length, 0);
  const received = (await roomState(recipientAuth)).table.holdings[0];
  assert.equal(received.deed!.ownerName, "recipient"); assert.equal(received.deed!.buyerName, "buyer");
  await submitCommands({ ...host, batchId: "travel", commands: [{ id: "travel", kind: "party-location", before: "coast", locationId: "desert" }] });
  const traveled = await roomState(recipientAuth);
  assert.equal(traveled.table.holdings[0].locationId, "coast");
  assert.deepEqual(traveled.table.journal!.market!.locations.map(l => l.id), ["coast", "desert"]);
  await submitCommands({ ...recipientAuth, batchId: "sell-deed", commands: [{ id: "sell-deed", kind: "sell", holdingId: received.id, shopId: "broker", quantity: 1 }] });
  assert.equal((await roomState(recipientAuth)).table.holdings.length, 0);
  const final = await roomState(host);
  assert.equal(final.table.ledger.filter(l => l.listingPurchase).length, 1);
  assert.equal(final.table.listings.find(l => l.id === "mill")!.quantity, 0);
  await deleteRoom(host.code, final.revision);
});
test("DM name imports persist atomically and a lost-response retry cannot duplicate shops; players cannot import", async () => {
  const { parseMarketNames, marketNameFingerprint } = await import("./market-name-import.ts");
  const { readMarketLocations } = await import("./shop-locations.ts");
  const { choosePace } = await import("./cloud.server.ts");
  const table = { ...emptyCloudTable(), purses: [{ id: "import-hero", name: "Hero", kind: "character" as const, coins: emptyCoins() }] };
  const host = await openRoom({ name: "Import DM", table });
  const player = await joinRoom({ code: host.code, purseId: "import-hero", name: "Hero" });
  await choosePace({ ...host, live: true });
  const command = { id: "import-once", kind: "market-name-import", before: marketNameFingerprint(readMarketLocations(), []), rows: parseMarketNames("region,town,shop\nCoast,Village,Inn\nCoast,Village,Forge", "region", null) };
  const before = await readRoom(host.code);
  await assert.rejects(submitCommands({ code: host.code, token: player.token, batchId: "player-import", commands: [command] }), /Only the DM/);
  assert.deepEqual(await readRoom(host.code), before);
  await submitCommands({ ...host, batchId: "import-first", commands: [command] });
  await submitCommands({ ...host, batchId: "import-first", commands: [command] });
  await submitCommands({ ...host, batchId: "lost-response", commands: [command] });
  const read = await roomState(host);
  assert.equal(read.table.shops.length, 2);
  assert.equal(read.table.journal!.market!.locations.length, 2);
  assert.ok(read.table.shops.every(shop => shop.closed));
  assert.deepEqual(read.table.purses, table.purses);
  assert.equal(read.table.journal!.events.filter(event => event.summary.startsWith("Names imported:")).length, 1);
  await deleteRoom(host.code, read.revision);
});
test("independent player room reads follow DM location changes and reject hidden-shop trades without committing", async () => {
  const { blankShop } = await import("./economy.ts");
  const { choosePace } = await import("./cloud.server.ts");
  const table = { ...emptyCloudTable(),
    purses: [{ id: "location-hero", name: "Hero", kind: "character" as const, coins: { ...emptyCoins(), gp: 10 } }],
    shops: [{ ...blankShop(), id: "east-shop", locationId: "east" }, { ...blankShop(), id: "west-shop", locationId: "west" }],
    stock: ["east", "west"].map(side => ({ id: `${side}-stock`, shopId: `${side}-shop`, name: "Good", copper: 10, quantity: 3, baseCopper: 10, rarity: "common" as const, notes: "" })),
    journal: { sessions: [], requests: [], events: [], market: { currentLocationId: "east", locations: ["east", "west"].map(side => ({ id: side, name: side, kind: "region" as const, parentId: null, description: "", image: "/art/shop-default.webp" })) } },
  };
  const host = await openRoom({ name: "DM", table });
  const guest = await joinRoom({ code: host.code, purseId: "location-hero", name: "Player" });
  await choosePace({ ...host, live: true });
  assert.deepEqual(guest.shopIds, ["east-shop"]);
  const read = await roomState({ code: host.code, token: guest.token });
  assert.deepEqual(read.shopIds, ["east-shop"]);
  assert.deepEqual(read.table.journal!.market!.locations.map(location => location.id), ["east"]);
  assert.equal(read.table.journal!.market!.locations[0].image, "/art/shop-default.webp");
  const before = await readRoom(host.code);
  await assert.rejects(submitCommands({ code: host.code, token: guest.token, batchId: "hidden-shop", commands: [{ id: "hidden-buy", kind: "buy", stockId: "west-stock", purseId: "location-hero", quantity: 1 }] }), /not available/);
  assert.deepEqual(await readRoom(host.code), before);
  await assert.rejects(submitCommands({ code: host.code, token: guest.token, batchId: "move-player", commands: [{ id: "move-player", kind: "party-location", before: "east", locationId: "west" }] }), /Only the DM/);
  await submitCommands({ ...host, batchId: "move-host", commands: [{ id: "move-host", kind: "party-location", before: "east", locationId: "west" }] });
  const moved = await roomState({ code: host.code, token: guest.token });
  assert.deepEqual(moved.shopIds, ["west-shop"]);
  assert.equal(moved.table.stock[0].id, "west-stock");
  assert.deepEqual(moved.table.purses[0].coins, table.purses[0].coins);
  assert.equal((await roomState(host)).table.shops.length, 2);
  await deleteRoom(host.code, moved.revision);
});
sql.exec(
  readFileSync(new URL("../../../drizzle/0000_mysterious_lord_tyger.sql", import.meta.url), "utf8"),
);
sql.exec(
  readFileSync(
    new URL("../../../cloudflare/migrations/0002_web_push.sql", import.meta.url),
    "utf8",
  ),
);
sql.exec(readFileSync(new URL("../../../cloudflare/migrations/0012_campaign_room_images.sql",import.meta.url),"utf8"));
(globalThis as any).__env__ = {
  DB: {
    async batch(statements: {run:()=>Promise<unknown>}[]) {
      sql.exec("BEGIN");try { const results=[];for(const statement of statements)results.push(await statement.run());sql.exec("COMMIT");return results; } catch(error) { sql.exec("ROLLBACK");throw error; }
    },
    prepare(query: string) {
      let values: any[] = [];
      return {
        bind(...args: any[]) {
          values = args;
          return this;
        },
        async all() {
          return {
            results: query.includes("FROM play_characters")
              ? []
              : sql.prepare(query).all(...values),
          };
        },
        async first() {
          return sql.prepare(query).get(...values) ?? null;
        },
        async run() {
          const r = sql.prepare(query).run(...values);
          return { meta: { changes: Number(r.changes) } };
        },
      };
    },
  },
};
test("durable shared rooms reject stale writes and survive independent reads", async () => {
  const room = {
    code: "CAS01",
    revision: 1,
    turn: 0,
    live: false,
    seats: [],
    table: emptyCloudTable(),
    seen: { gifts: [], sales: [] },
  };
  await createRoom(room);
  assert.equal((await readRoom("CAS01"))?.revision, 1);
  await updateRoom({ ...room, revision: 2 }, 1);
  await assert.rejects(updateRoom({ ...room, revision: 2 }, 1), /table changed/);
  await assert.rejects(deleteRoom(room.code, 1), /table changed/);
  await deleteRoom(room.code, 2);
  assert.equal(await readRoom(room.code), null);
});
test("a cloudflare worker without D1 does not fall back to a local file", async () => {
  const previous = (globalThis as { __env__?: unknown }).__env__;
  (globalThis as { __env__?: unknown }).__env__ = { ASSETS: {} };
  try {
    await assert.rejects(readRoom("NONE"), /D1 database bound as DB/);
  } finally {
    (globalThis as { __env__?: unknown }).__env__ = previous;
  }
});
test("player responses exclude other private messages, loans, and NPC join choices", async () => {
  const table = {
    ...emptyCloudTable(),
    purses: [
      { id: "pc", name: "PC", kind: "character" as const, coins: emptyCoins() },
      {
        id: "npc",
        name: "NPC",
        kind: "character" as const,
        control: "npc" as const,
        coins: emptyCoins(),
      },
    ],
    notes: [
      {
        id: "public",
        at: 1,
        from: "dm" as const,
        to: "party" as const,
        purseId: "",
        text: "Party note",
      },
      {
        id: "private",
        at: 1,
        from: "dm" as const,
        to: "dm" as const,
        purseId: "npc",
        text: "Secret",
      },
    ],
  };
  const opened = await openRoom({ name: "DM", table });
  assert.deepEqual(
    (await previewRoom(opened.code)).characters.map((p) => p.id),
    ["pc"],
  );
  const joined = await joinRoom({ code: opened.code, purseId: "pc", name: "PC" });
  const view = await roomState({ code: opened.code, token: joined.token });
  assert.deepEqual(
    view.table.notes.map((n) => n.id),
    ["public"],
  );
  await assert.rejects(roomState({ code: opened.code, token: "invalid" }), /not seated/);
});

test("private chat is isolated, idempotent, and independent of turns", async () => {
  const opened = await openRoom({
    name: "DM",
    table: {
      ...emptyCloudTable(),
      purses: ["a", "b", "c"].map((id) => ({
        id,
        name: id,
        kind: "character",
        coins: emptyCoins(),
      })),
    },
  });
  const a = await joinRoom({ code: opened.code, purseId: "a", name: "A" });
  const b = await joinRoom({ code: opened.code, purseId: "b", name: "B" });
  const c = await joinRoom({ code: opened.code, purseId: "c", name: "C" });
  const message = {
    kind: "message",
    id: "private-chat",
    to: "player",
    purseId: "a",
    recipientId: "b",
    text: "Only A and B",
  };
  const result = await submitCommands({
    code: opened.code,
    token: a.token,
    batchId: "first",
    commands: [message],
  });
  assert.equal(result.turn, 0);
  assert.equal(result.table.notes.length, 1);
  await submitCommands({
    code: opened.code,
    token: a.token,
    batchId: "retry",
    commands: [message],
  });
  assert.equal((await roomState({ code: opened.code, token: b.token })).table.notes.length, 1);
  assert.equal((await roomState({ code: opened.code, token: c.token })).table.notes.length, 0);
  assert.equal((await roomState({ code: opened.code, token: opened.token })).table.notes.length, 0);
  await assert.rejects(
    submitCommands({
      code: opened.code,
      token: c.token,
      batchId: "forge",
      commands: [{ ...message, id: "forged" }],
    }),
    /permission/,
  );
  await assert.rejects(
    submitCommands({
      code: opened.code,
      token: a.token,
      batchId: "bad-target",
      commands: [{ ...message, id: "bad", recipientId: "missing" }],
    }),
    /another player/,
  );
});

test("push subscriptions require membership and preserve stable signing keys", async () => {
  const opened = await openRoom({
    name: "DM",
    table: {
      ...emptyCloudTable(),
      purses: [{ id: "push-player", name: "Player", kind: "character", coins: emptyCoins() }],
    },
  });
  const player = await joinRoom({ code: opened.code, purseId: "push-player", name: "Player" });
  const endpoint = "https://fcm.googleapis.com/fcm/send/test-subscription";
  const config = await pushSettings(opened);
  assert.equal(config.publicKey, (await pushSettings(opened)).publicKey);
  assert.equal("privateKey" in config, false);
  await assert.rejects(
    setPushSubscription({ ...opened, token: "invalid", endpoint, enabled: true }),
    /Join a room/,
  );
  await assert.rejects(
    setPushSubscription({ ...opened, endpoint: "https://localhost/private", enabled: true }),
    /not supported/,
  );
  await setPushSubscription({ ...player, code: opened.code, endpoint, enabled: true });
  assert.equal((await pushSettings({ ...player, code: opened.code, endpoint })).subscribed, true);
  assert.equal((await pushSettings({ ...opened, endpoint })).subscribed, false);
  const row = sql.prepare("SELECT body FROM push_config WHERE id='vapid'").get() as {
    body: string;
  };
  const keys = JSON.parse(row.body);
  const header = await pushAuthorization(endpoint, keys);
  const jwt = header.slice("vapid t=".length).split(", k=")[0]!;
  const jwk = { ...keys.privateKey };
  delete jwk.d;
  jwk.key_ops = ["verify"];
  const verified = await jwtVerify(jwt, await importJWK(jwk, "ES256"), {
    audience: "https://fcm.googleapis.com",
  });
  assert.equal(verified.payload.sub, "https://lootsplit.oliverstorie2017.workers.dev");
  const originalFetch = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = async (url, init) => {
    sends++;
    assert.equal(url, endpoint);
    assert.equal(init?.body, undefined);
    assert.equal(init?.redirect, "error");
    return new Response(null, { status: 201 });
  };
  try {
    const cmd = {
      kind: "message",
      id: "push-note",
      to: "party",
      purseId: "",
      text: "Do not expose this text",
    };
    await submitCommands({ ...opened, batchId: "push-send", commands: [cmd] });
    await submitCommands({ ...opened, batchId: "push-retry", commands: [cmd] });
    assert.equal(sends, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
  await setPushSubscription({ ...player, code: opened.code, endpoint, enabled: false });
  assert.equal((await pushSettings({ ...player, code: opened.code, endpoint })).subscribed, false);
  assert.equal(validPushEndpoint("https://fcm.googleapis.com.evil.example/test"), false);
  assert.equal(validPushEndpoint("https://user@fcm.googleapis.com/test"), false);
});

test("lost acknowledgement can retry after an independent room read without double spending", async () => {
  const table = {
    ...emptyCloudTable(),
    purses: [
      {
        id: "recover",
        name: "Recover",
        kind: "character" as const,
        coins: { ...emptyCoins(), gp: 5 },
      },
    ],
    shops: [
      {
        id: "recovery-shop",
        name: "Shop",
        keeper: "",
        place: "",
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
        id: "recovery-item",
        shopId: "recovery-shop",
        name: "Item",
        copper: 10,
        quantity: 3,
        notes: "",
        baseCopper: 10,
        rarity: "common" as const,
      },
    ],
  };
  const opened = await openRoom({ name: "Recovery test", table });
  const { choosePace } = await import("./cloud.server.ts");
  await choosePace({ ...opened, live: true });
  const player = await joinRoom({ code: opened.code, purseId: "recover", name: "Player" });
  const savedRequest = JSON.stringify({
    code: opened.code,
    token: player.token,
    batchId: "persisted-batch",
    commands: [
      {
        id: "persisted-buy",
        kind: "buy",
        purseId: "recover",
        stockId: "recovery-item",
        quantity: 1,
      },
    ],
  });
  await submitCommands(JSON.parse(savedRequest)); // Simulate committed request whose response was lost.
  const beforeRetry = await roomState({ code: opened.code, token: player.token });
  assert.equal(beforeRetry.table.stock[0]?.quantity, 2);
  await submitCommands(JSON.parse(savedRequest)); // Recovered persisted queue.
  const recovered = await roomState(opened);
  assert.equal(recovered.table.stock[0]?.quantity, 2);
  assert.equal(recovered.table.ledger.length, 1);
  assert.equal(recovered.table.ledger[0]?.transactionType, "purchase");
});

test("structured DM audit details stay server-side for player responses", async () => {
  const table = {
    ...emptyCloudTable(),
    purses: [{ id: "pc", name: "PC", kind: "character" as const, coins: emptyCoins() }],
    journal: {
      sessions: [],
      requests: [],
      events: [
        {
          id: "price",
          at: 1,
          kind: "prices" as const,
          summary: "Price changed",
          change: { entity: "stock" as const, before: { copper: 10 }, after: { copper: 20 } },
        },
      ],
    },
  };
  const dm = await openRoom({ name: "DM", table });
  const pc = await joinRoom({ code: dm.code, purseId: "pc", name: "PC" });
  assert.equal(
    (await roomState({ code: dm.code, token: pc.token })).table.journal?.events[0]?.change,
    undefined,
  );
  assert.equal((await roomState(dm)).table.journal?.events[0]?.change?.after?.copper, 20);
});

test("players receive only their own finance agreements in persisted room projections", async () => {
  const { applyCommand } = await import("./commands.ts");
  let table: import("./cloud.ts").CloudTable = {
    ...emptyCloudTable(),
    purses: [{ id: "finance-pc", name: "PC", kind: "character" as const, coins: emptyCoins() }],
  };
  table = applyCommand(
    table,
    { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] },
    {
      id: "finance-create",
      kind: "finance-loan",
      principal: 500,
      terms: {
        name: "Private NPC lender",
        purseId: "finance-pc",
        lenderId: "",
        rateBps: 100,
        periodDays: 7,
        compound: false,
        payment: 50,
      },
    },
  );
  const host = await openRoom({ name: "Finance DM", table });
  const pc = await joinRoom({ code: host.code, purseId: "finance-pc", name: "PC" });
  assert.equal((await roomState(host)).table.journal?.finance?.loans[0].principal, 500);
  const projected=(await roomState({code:host.code,token:pc.token})).table.journal!.finance!;
  assert.equal(projected.loans.length,1);
  assert.equal(projected.loans[0].principal,500);
  assert.deepEqual(projected.downtime,[]);
});

test("maps, NPC barter, vendor toggles and session time remain authoritative and retry-safe across independent seats",async()=>{
  const {choosePace}=await import("./cloud.server.ts"),{readJournal}=await import("./journal.ts"),{canonicalJson}=await import("./canonical-json.ts"),{sessionTimeFingerprint}=await import("./session-time.ts");
  const table={...emptyCloudTable(),purses:["world-a","world-b"].map(id=>({id,name:id,kind:"character" as const,coins:{...emptyCoins(),gp:100}})),holdings:[{id:"world-lot",name:"Sword",kind:"item" as const,purseId:"world-a",quantity:2,unitCopper:500,notes:""}],journal:readJournal({market:{currentLocationId:"world-city",locations:[{id:"world-region",name:"Realm",kind:"region",parentId:null,description:""},{id:"world-city",name:"City",kind:"city",parentId:"world-region",description:""}]},sessions:[{id:"world-session",name:"Travel",startedAt:1}]})};
  const host=await openRoom({name:"World DM",table}),a=await joinRoom({code:host.code,purseId:"world-a",name:"A"}),b=await joinRoom({code:host.code,purseId:"world-b",name:"B"});await choosePace({...host,live:true});const aAuth={code:host.code,token:a.token},bAuth={code:host.code,token:b.token};
  const map={id:"world-map",name:"City map",image:"data:image/png;base64,AAAA",locationId:"world-city",visible:true,anchors:[{locationId:"world-city",x:.5,y:.5}],markers:[]};
  await assert.rejects(submitCommands({...aAuth,batchId:"forged-map",commands:[{id:"forged-map",kind:"map-save",mapId:map.id,before:null,map}]}),/Only the DM/);
  const save={id:"world-map-save",kind:"map-save",mapId:map.id,before:null,map};await submitCommands({...host,batchId:"map-save",commands:[save]});await submitCommands({...host,batchId:"map-lost-response",commands:[save]});assert.equal((await roomState(aAuth)).table.journal!.world!.maps.length,1);
  const marker={id:"world-marker",label:"Live landmark",description:"Public",visibility:"party",x:.2,y:.3};await submitCommands({...host,batchId:"marker-add",commands:[{id:"world-marker-add",kind:"map-marker",mapId:map.id,markerId:marker.id,before:null,marker}]});assert.equal((await roomState(bAuth)).table.journal!.world!.maps[0].markers[0].label,"Live landmark");await submitCommands({...host,batchId:"marker-remove",commands:[{id:"world-marker-remove",kind:"map-marker",mapId:map.id,markerId:marker.id,before:marker,marker:null}]});assert.equal((await roomState(aAuth)).table.journal!.world!.maps[0].markers.length,0);
  const create={id:"world-npc-create",kind:"npc-create",npc:{id:"world-npc",name:"Broker",description:"Near",locationId:"world-city",visible:true,barterAllowed:true,controllerPurseId:null},copper:500,inventory:[{name:"Gem",quantity:1,unitCopper:500,notes:""}]};await submitCommands({...host,batchId:"npc-create",commands:[create]});await submitCommands({...host,batchId:"npc-retry",commands:[create]});assert.equal((await roomState(aAuth)).table.journal!.world!.npcs.length,1);
  const offer={id:"world-offer",kind:"trade-offer",tradeId:"world-trade",revision:null,actorId:"world-a",left:{purseId:"world-a",copper:100,items:[{holdingId:"world-lot",quantity:1,before:canonicalJson(table.holdings[0])}]},right:{purseId:"world-b",copper:0,items:[]},note:"Sword"};await submitCommands({...aAuth,batchId:"offer",commands:[offer]});const decision={id:"world-accept",kind:"trade-decision",tradeId:"world-trade",revision:0,actorId:"world-b",decision:"accepted"};await assert.rejects(submitCommands({...aAuth,batchId:"forged-accept",commands:[decision]}),/participant/);await submitCommands({...bAuth,batchId:"accept",commands:[decision]});await submitCommands({...bAuth,batchId:"accept-retry",commands:[decision]});assert.equal((await roomState(bAuth)).table.holdings.find(h=>h.name==="Sword")!.quantity,1);assert.equal((await roomState(host)).table.ledger.filter(l=>l.summary.startsWith("Barter")).length,2);
  const before=(await roomState(host)).table,time={id:"world-time",kind:"session-time",before:sessionTimeFingerprint(before),hours:24,rest:"none",purseIds:[],allowDowntime:false,note:"Travel"};await submitCommands({...host,batchId:"time",commands:[time]});await submitCommands({...host,batchId:"time-retry",commands:[time]});const final=await roomState(host);assert.equal(final.table.journal!.finance!.day,1);assert.equal(final.table.journal!.world!.timeHistory.length,1);await deleteRoom(host.code,final.revision);
});


test("multiple large maps persist outside the D1 room row and hydrate exact archive bytes with campaign isolation",async()=>{
  const {readJournal}=await import("./journal.ts"),{hydrateRoomImages}=await import("../../../cloudflare/room-images.mjs"),{database}=await import("./room-store.server.ts");
  const maps=Array.from({length:6},(_,i)=>({id:`large-${i}`,name:`Map ${i}`,image:"data:image/png;base64,"+String.fromCharCode(65+i).repeat(480000),locationId:null,visible:true,anchors:[],markers:[]}));
  const table={...emptyCloudTable(),purses:[{id:"map-hero",name:"Hero",kind:"character" as const,coins:emptyCoins()}],journal:readJournal({world:{maps}})};
  const snapshot=JSON.stringify(table,null,2);table.journal.reports=[{id:"map-report",name:"Original bytes",at:1,snapshot}];
  const host=await openRoom({name:"Maps DM",table});const raw=sql.prepare("SELECT body FROM campaign_rooms WHERE code=?").get(host.code) as {body:string};assert.ok(raw.body.length<10000);assert.ok(!raw.body.includes(maps[0].image));assert.equal(sql.prepare("SELECT count(*) AS n FROM campaign_room_images WHERE code=?").get(host.code)!.n,6);
  const hydrated=await readRoom(host.code);assert.deepEqual(hydrated!.table.journal!.world!.maps,maps);assert.equal(hydrated!.table.journal!.reports![0].snapshot,snapshot);
  await updateRoom({...hydrated!,revision:hydrated!.revision+1},hydrated!.revision);assert.equal(sql.prepare("SELECT count(*) AS n FROM campaign_room_images WHERE code=?").get(host.code)!.n,6);
  await assert.rejects(hydrateRoomImages(database()!,"another-campaign",JSON.parse(raw.body)),/missing/);
  const latest=await readRoom(host.code),stale=structuredClone(latest!);stale.revision++;stale.table.journal!.world!.maps[0].image="data:image/png;base64,"+"Z".repeat(480000);
  await assert.rejects(updateRoom(stale,latest!.revision-1),/changed/);assert.equal(sql.prepare("SELECT count(*) AS n FROM campaign_room_images WHERE code=?").get(host.code)!.n,6);
  assert.deepEqual((await readRoom(host.code))!.table.journal!.world!.maps,maps);await deleteRoom(host.code,latest!.revision);
});
