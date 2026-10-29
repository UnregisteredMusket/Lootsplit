import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { smithFixture, smithDesign } from "./test-fixtures/blacksmith.ts";
import { deploymentOrigins } from "../deployment/origins.mjs";
import { smithQuote } from "./blacksmith.ts";
import { readFileSync } from "node:fs";
import { createRoom, readRoom, readRoomAccess, updateRoom, deleteRoom } from "./room-store.server.ts";
import { emptyCloudTable } from "./cloud.ts";
import { tradeFixture } from "./test-fixtures/trade-economy.ts";
import { STARTER_COMMODITIES } from "./commodity-catalog.ts";
import { commodityImportFingerprint } from "./commodity-import.ts";
import { exchangeQuoteKey, tradeSeasonFingerprint } from "./trade-economy.ts";
import { canonicalJson } from "./canonical-json.ts";
import { applyCommand, tablePatch } from "./commands.ts";
import { openRoom, joinRoom, roomState, pollRoom, previewRoom, submitCommands } from "./cloud.server.ts";
import { emptyCoins, fromCopper, toCopper } from "./money.ts";
import { resourcePackFixture } from "./test-fixtures/resource-pack.ts";
import {
  pushSettings,
  setPushSubscription,
  validPushEndpoint,
  pushAuthorization,
} from "./push.server.ts";
import { jwtVerify, importJWK } from "jose";
const sql = new DatabaseSync(":memory:");
test("shared blacksmith commissions debit materials and funds once, enforce DM enchantments and collect once after approved downtime", async () => {
  const table = smithFixture(), host = await openRoom({ name: "Smith DM", table });
  const guest = await joinRoom({ code: host.code, purseId: "hero", name: "Smith hero" }), auth = { code: host.code, token: guest.token };
  const { choosePace } = await import("./cloud.server.ts"); await choosePace({ ...host, live: true });
  const initial = (await roomState(auth)).table, design = smithDesign(initial); design.parts[0].holdingId = "steel-lot";
  const q = smithQuote(initial, "forge", "hero", design), command = { id: "shared-smith-order", kind: "smith-order", shopId: "forge", purseId: "hero", design, before: q.before };
  const p = table.journal!.blacksmith!.profiles[0];
  await assert.rejects(submitCommands({ ...auth, batchId: "smith-forged-config", commands: [{ id: "forged-smith", kind: "smith-profile", shopId: "forge", before: p, profile: { ...p, magicalForge: true } }] }), /Only the DM/);
  await submitCommands({ ...auth, batchId: "smith-order-first", commands: [command] });
  await submitCommands({ ...auth, batchId: "smith-order-lost-response", commands: [command] });
  let saved = (await roomState(host)).table;
  assert.equal(saved.journal!.blacksmith!.orders.length, 1); assert.equal(saved.holdings[0].quantity, 5);
  assert.equal(toCopper(saved.purses.find(p => p.id === "hero")!.coins), 100000 - q.terms.costCopper);
  assert.equal(saved.ledger.filter(l => l.shopId === "forge").length, 1);
  const preview = { id: "smith-downtime", kind: "downtime-plan", name: "Forge downtime", days: 5 };
  await assert.rejects(submitCommands({ ...auth, batchId: "forged-smith-downtime", commands: [preview] }), /Only the DM/);
  await submitCommands({ ...host, batchId: "smith-preview", commands: [preview] });
  await submitCommands({ ...host, batchId: "smith-approve", commands: [{ id: "smith-approval", kind: "downtime-apply", downtimeId: preview.id, endSession: false }] });
  saved = (await roomState(auth)).table; const o = saved.journal!.blacksmith!.orders[0]; assert.equal(o.status, "ready");
  const collect = { id: "smith-collection", kind: "smith-claim", orderId: o.id, before: o };
  await submitCommands({ ...auth, batchId: "smith-collect-first", commands: [collect] });
  await submitCommands({ ...auth, batchId: "smith-collect-retry", commands: [collect] });
  saved = (await roomState(host)).table;
  assert.equal(saved.holdings.filter(h => h.id.endsWith("-crafted")).length, 1); assert.equal(saved.journal!.blacksmith!.orders[0].status, "claimed");
  assert.match(saved.holdings.find(h => h.id.endsWith("-crafted"))!.notes, /Made by Aster/);
});
sql.exec(readFileSync(new URL("../../../cloudflare/migrations/0008_encounters.sql", import.meta.url), "utf8"));
test("shared hourly training preserves private NPC budgets and applies requests, decisions and resets once", async () => {
  const { choosePace } = await import("./cloud.server.ts");
  const { blankSheet } = await import("../characters/model.mjs");
  const { trainingCounters } = await import("./downtime-activities.ts");
  const table = smithFixture();
  table.purses.find((p) => p.id === "hero")!.sheet = { ...blankSheet(), name: "Hero", level: 5 };
  const host = await openRoom({ name: "Training DM", table });
  const guest = await joinRoom({ code: host.code, purseId: "hero", name: "Training player" });
  const auth = { code: host.code, token: guest.token };
  await choosePace({ ...host, live: true });
  await submitCommands({
    ...host,
    batchId: "training-clock",
    commands: [{ id: "training-clock", kind: "downtime-plan", name: "Training day", days: 1 }],
  });
  await submitCommands({
    ...host,
    batchId: "training-clock-apply",
    commands: [
      {
        id: "training-clock-apply",
        kind: "downtime-apply",
        downtimeId: "training-clock",
        endSession: false,
      },
    ],
  });
  const before = (await roomState(host)).table;
  const view = (await roomState(auth)).table;
  assert.deepEqual(
    view.journal!.downtimeActivities!.windows[0].budgets.map((b) => b.purseId),
    ["hero"],
  );
  const request = {
    id: "shared-training",
    kind: "downtime-training" as const,
    windowId: "training-clock",
    trainerId: "hero",
    npcId: "maker",
    category: "martial" as const,
    topic: "Weapon care",
    description: "Blade maintenance and stance drills",
    className: "",
    minutes: 480,
  };
  const preview = applyCommand(
    view,
    {
      id: guest.seatId,
      token: guest.token,
      name: "Training player",
      role: "player",
      purseIds: ["hero"],
    },
    request,
    { preview: true },
  );
  assert.equal(preview.journal!.downtimeActivities!.requests.length, 1);
  await submitCommands({ ...auth, batchId: "shared-training-first", commands: [request] });
  await submitCommands({ ...auth, batchId: "shared-training-retry", commands: [request] });
  let saved = (await roomState(host)).table;
  const r = saved.journal!.downtimeActivities!.requests[0];
  assert.equal(saved.journal!.downtimeActivities!.requests.length, 1);
  const approve = {
    id: "approve-training",
    kind: "downtime-training-review",
    requestId: r.id,
    before: r,
    approve: true,
    note: "DM confirms NPC is lower level and time was completed together.",
  };
  await assert.rejects(
    submitCommands({ ...auth, batchId: "forged-training-approve", commands: [approve] }),
    /Only the DM/,
  );
  await submitCommands({ ...host, batchId: "training-approve-first", commands: [approve] });
  await submitCommands({ ...host, batchId: "training-approve-retry", commands: [approve] });
  saved = (await roomState(host)).table;
  assert.deepEqual(saved.purses, before.purses);
  assert.deepEqual(saved.holdings, before.holdings);
  assert.deepEqual(saved.sheets, before.sheets);
  assert.equal(trainingCounters(saved.journal!.downtimeActivities!)[0].lifetimeMinutes, 480);
  const reset = {
    id: "training-reset",
    kind: "downtime-training-reset",
    trainerId: "hero",
    npcId: "maker",
    category: "martial",
    topic: "Weapon care",
    before: [r.id],
    note: "Milestone applied manually.",
  };
  await submitCommands({ ...host, batchId: "training-reset-first", commands: [reset] });
  await submitCommands({ ...host, batchId: "training-reset-retry", commands: [reset] });
  saved = (await roomState(host)).table;
  assert.equal(saved.journal!.downtimeActivities!.resets.length, 1);
  assert.equal(trainingCounters(saved.journal!.downtimeActivities!)[0].currentMinutes, 0);
  assert.equal(trainingCounters(saved.journal!.downtimeActivities!)[0].lifetimeMinutes, 480);
  await deleteRoom(host.code, (await roomState(host)).revision);
});
test("shared ships enforce DM overrides, player-owned boarding reviews, projection privacy and one-time receipts", async()=>{
  const {defaultShip}=await import("./ships-schema.ts"),{shipFingerprint}=await import("./ships.ts");
  let table=tradeFixture();
  const seat={id:"dm",token:"",name:"DM",role:"dm" as const,purseIds:[]};
  table=applyCommand(table,seat,{id:"ship-setup",kind:"ship-configure",before:null,vessel:{...defaultShip(),propertyId:"warehouse",mode:"docked",facilityId:null,installed:[],arrearsCopper:0,expenseRemainder:0,dmNotes:"Private navigation clue"}});
  const host=await openRoom({name:"Ship DM",table});
  const guest=await joinRoom({code:host.code,purseId:"a",name:"Ship player"}),auth={code:host.code,token:guest.token};
  const {choosePace}=await import("./cloud.server.ts");await choosePace({...host,live:true});
  const view=(await roomState(auth)).table;assert.equal(view.journal!.fleet!.vessels[0].dmNotes,"");
  const forbidden={id:"forged-teleport",kind:"ship-teleport",propertyId:"warehouse",destinationId:"desert",facilityId:null,before:shipFingerprint(view,"warehouse"),reason:""};
  await assert.rejects(submitCommands({...auth,batchId:"forged-ship",commands:[forbidden]}),/Only the DM/);
  const request={id:"board-review",kind:"ship-board",propertyId:"warehouse",purseId:"a",action:"board",before:shipFingerprint(view,"warehouse")};
  await submitCommands({...auth,batchId:"board-first",commands:[request]});await submitCommands({...auth,batchId:"board-response-retry",commands:[request]});
  let saved=(await roomState(host)).table;assert.equal(saved.journal!.fleet!.boarding.length,1);assert.equal(saved.journal!.fleet!.aboard.length,0);
  const r=saved.journal!.fleet!.boarding[0],approve={id:"approve-board",kind:"ship-board-review",requestId:r.id,before:r,approve:true};
  await submitCommands({...host,batchId:"approve-first",commands:[approve]});await submitCommands({...host,batchId:"approve-retry",commands:[approve]});
  saved=(await roomState(host)).table;assert.equal(saved.journal!.fleet!.aboard.length,1);
  const teleport={...forbidden,id:"real-teleport",before:shipFingerprint(saved,"warehouse"),reason:"DM portal"};
  const coins=saved.purses.map(p=>p.coins),day=saved.journal!.finance!.day;
  await submitCommands({...host,batchId:"teleport-first",commands:[teleport]});await submitCommands({...host,batchId:"teleport-response-retry",commands:[teleport]});
  saved=(await roomState(host)).table;assert.deepEqual(saved.purses.map(p=>p.coins),coins);assert.equal(saved.journal!.finance!.day,day);
  assert.equal(saved.journal!.world!.characterPositions.find(p=>p.purseId==="a")!.locationId,"desert");
  assert.equal(saved.journal!.events.filter(e=>e.id==="real-teleport-ship").length,1);
});
test("shared commodity imports are DM-only, isolated and replay-safe; global trade is checked against the room's city location", async () => {
  const table=tradeFixture(); table.journal!.tradeEconomy!.exchanges[0].locationId=null;
  const host=await openRoom({name:"City market DM",table}), other=await openRoom({name:"Other commodity campaign",table:tradeFixture()});
  const guest=await joinRoom({code:host.code,purseId:"a",name:"Trader"});
  const player={code:host.code,token:guest.token};
  const {choosePace}=await import("./cloud.server.ts"); await choosePace({...host,live:true});
  const command={id:"add-catalog",kind:"trade-commodity-import",before:commodityImportFingerprint(table.journal!.tradeEconomy!),commodities:STARTER_COMMODITIES,reason:"Reviewed starter definitions"};
  await assert.rejects(submitCommands({...player,batchId:"unauthorized-catalog",commands:[command]}),/Only the DM/);
  await submitCommands({...host,batchId:"catalog-first",commands:[command]});
  await submitCommands({...host,batchId:"catalog-response-retry",commands:[command]});
  const saved=(await roomState(host)).table;
  assert.equal(saved.journal!.tradeEconomy!.commodities.length,61);
  assert.deepEqual(saved.purses,table.purses); assert.deepEqual(saved.holdings,table.holdings);
  assert.equal((await roomState(other)).table.journal!.tradeEconomy!.commodities.length,1);
  assert.equal(saved.journal!.events.filter(e=>e.id==="add-catalog-event").length,1);
  const e=saved.journal!.tradeEconomy!, buy={id:"global-away-buy",kind:"trade-buy",exchangeId:"harbor",commodityId:"timber",purseId:"a",quantity:1,before:exchangeQuoteKey(e,e.exchanges[0],e.commodities[0])};
  await submitCommands({...host,batchId:"leave-city",commands:[{id:"leave-city",kind:"party-location",before:"dock",locationId:"desert"}]});
  assert.equal((await roomState(player)).table.journal!.tradeEconomy!.exchanges.length,0);
  const away=await readRoom(host.code);
  await assert.rejects(submitCommands({...player,batchId:"global-away-buy",commands:[buy]}),/city/);
  assert.deepEqual(await readRoom(host.code),away,"Rejected remote trade does not partly spend or move goods");
  await submitCommands({...host,batchId:"return-city",commands:[{id:"return-city",kind:"party-location",before:"desert",locationId:"dock"}]});
  await submitCommands({...player,batchId:"global-city-buy",commands:[buy]});
  assert.equal((await roomState(host)).table.journal!.tradeEconomy!.receipts.length,1);
});
test("shared NPC transfers, sheet privacy and campaign-time returns survive retries and independent seat reads", async () => {
  const { characterPosition } = await import("./character-position.ts");
  const { choosePace, characterRoll } = await import("./cloud.server.ts");
  const t = tradeFixture(),
    host = await openRoom({ name: "Placement DM", table: t });
  const guest = await joinRoom({ code: host.code, purseId: "a", name: "Player" }),
    auth = { code: host.code, token: guest.token };
  await choosePace({ ...host, live: true });
  const create = {
    id: "placement-npc",
    kind: "npc-create",
    npc: {
      id: "placement-npc",
      name: "Private scholar",
      description: "Private NPC text",
      locationId: "port",
      visible: true,
      barterAllowed: false,
      controllerPurseId: null,
    },
    copper: 123,
    inventory: [{ name: "Book", quantity: 1, unitCopper: 20, notes: "" }],
  };
  await submitCommands({ ...host, batchId: "placement-create", commands: [create] });
  let table = (await roomState(host)).table;
  const state = () =>
    characterPosition(
      table,
      table.purses.find((p) => p.id === create.npc.id)!,
    );
  const join = {
    id: "placement-join",
    kind: "character-position",
    purseId: create.npc.id,
    before: state(),
    inParty: true,
    locationId: null,
    visible: true,
    sheetVisible: true,
  };
  await assert.rejects(
    submitCommands({ ...auth, batchId: "placement-forged", commands: [join] }),
    /Only the DM/,
  );
  await submitCommands({ ...host, batchId: "placement-join", commands: [join] });
  await submitCommands({ ...host, batchId: "placement-join-retry", commands: [join] });
  table = (await roomState(host)).table;
  assert.equal(table.purses.filter((p) => p.id === create.npc.id).length, 1);
  assert.equal(toCopper(table.purses.find((p) => p.id === create.npc.id)!.coins), 123);
  assert.equal(
    (await roomState(auth)).table.purses.find((p) => p.id === create.npc.id)!.sheet!.description,
    "Private NPC text",
  );
  await assert.rejects(characterRoll({ ...auth, purseId: create.npc.id, policy: true }), /control/);
  const start = {
    id: "placement-action",
    kind: "character-downtime-start",
    purseId: create.npc.id,
    before: state(),
    name: "Study",
    days: 1,
    locationId: "port",
  };
  await submitCommands({ ...host, batchId: "placement-start", commands: [start] });
  await submitCommands({ ...host, batchId: "placement-start-retry", commands: [start] });
  table = (await roomState(host)).table;
  assert.equal(state().inParty, false);
  const hide = {
    id: "placement-hide",
    kind: "character-position",
    purseId: create.npc.id,
    before: state(),
    inParty: false,
    locationId: "port",
    visible: false,
    sheetVisible: false,
  };
  await submitCommands({ ...host, batchId: "placement-hide", commands: [hide] });
  assert.ok(!JSON.stringify(await roomState(auth)).includes("Private NPC text"));
  assert.ok(!JSON.stringify(await roomState(auth)).includes("Private scholar"));
  table = (await roomState(host)).table;
  const plan = { id: "placement-plan", kind: "downtime-plan", name: "Study day", days: 1 };
  await submitCommands({ ...host, batchId: "placement-plan", commands: [plan] });
  table = (await roomState(host)).table;
  const apply = {
    id: "placement-approve",
    kind: "downtime-apply",
    downtimeId: table.journal!.finance!.downtime.at(-1)!.id,
    endSession: false,
  };
  await submitCommands({ ...host, batchId: "placement-approve", commands: [apply] });
  await submitCommands({ ...host, batchId: "placement-approve-retry", commands: [apply] });
  table = (await roomState(host)).table;
  assert.equal(state().inParty, true);
  assert.equal(state().visible, false);
  assert.equal(state().downtime, undefined);
  assert.equal(
    table.journal!.events.filter((e) => e.summary.includes("completed Study")).length,
    1,
  );
  assert.equal(table.holdings.filter((h) => h.purseId === create.npc.id).length, 1);
});
test("shared exchange corrections restore both cash legs once across retries and reject changed goods atomically", async () => {
  const { choosePace } = await import("./cloud.server.ts");
  const host = await openRoom({ name: "Correction DM", table: tradeFixture() });
  const joined = await joinRoom({ code: host.code, purseId: "a", name: "Arden" });
  await choosePace({ ...host, live: true });
  const auth = { code: host.code, token: joined.token };
  const initial = (await roomState(host)).table, e = initial.journal!.tradeEconomy!;
  const purchase = {
    id: "correction-buy", kind: "trade-buy", exchangeId: "harbor", commodityId: "timber",
    purseId: "a", quantity: 10, before: exchangeQuoteKey(e, e.exchanges[0], e.commodities[0]),
  };
  await submitCommands({ ...auth, batchId: "correction-purchase", commands: [purchase] });
  const bought = (await roomState(host)).table, receipt = bought.journal!.tradeEconomy!.receipts[0];
  const correction = {
    id: "shared-correction", kind: "ledger-void", target: { kind: "trade", id: receipt.id },
    before: canonicalJson(receipt), reason: "The party reviewed the mistaken purchase.",
  };
  const unchanged = await readRoom(host.code);
  await assert.rejects(submitCommands({ ...auth, batchId: "player-forged-correction", commands: [correction] }), /Only the DM/);
  assert.deepEqual(await readRoom(host.code), unchanged);
  await submitCommands({ ...host, batchId: "correct-first", commands: [correction] });
  await submitCommands({ ...host, batchId: "correct-lost-response", commands: [correction] });
  const corrected = (await roomState(host)).table;
  assert.deepEqual(corrected.holdings, initial.holdings);
  assert.equal(toCopper(corrected.purses.find(p => p.id === "a")!.coins), 100000);
  assert.equal(toCopper(corrected.purses.find(p => p.id === "exchange-treasury")!.coins), 50000);
  assert.equal(corrected.journal!.tradeEconomy!.exchanges[0].offers[0].stock, 100);
  assert.equal(corrected.journal!.tradeEconomy!.receipts.length, 2);
  assert.equal(corrected.ledger.length, 4);
  assert.equal(corrected.journal!.events.filter(event => event.summary.startsWith("Ledger correction:")).length, 1);
  assert.equal(canonicalJson(corrected.journal!.tradeEconomy!.receipts[0]), canonicalJson(receipt));
  await submitCommands({ ...host, batchId: "independent-duplicate-correction", commands: [{ ...correction, id: "independent-correction" }] });
  assert.deepEqual((await roomState(host)).table, corrected);
  const playerView = (await roomState(auth)).table;
  assert.equal(playerView.journal!.tradeEconomy!.receipts.length, 2);
  assert.ok(playerView.journal!.tradeEconomy!.receipts.every(r => !r.settlement && !r.operationId));
  assert.equal(toCopper(playerView.purses.find(p => p.id === "a")!.coins), 100000);

  await submitCommands({ ...auth, batchId: "second-buy", commands: [{ ...purchase, id: "second-correction-buy", quantity: 2 }] });
  const later = (await roomState(host)).table, laterReceipt = later.journal!.tradeEconomy!.receipts.at(-1)!;
  await submitCommands({ ...auth, batchId: "goods-moved", commands: [{
    id: "goods-moved", kind: "give", fromId: "a", toId: "b", copper: 0,
    holdingId: later.holdings.find(h => h.commodityId)!.id, quantity: 1,
  }] });
  const moved = await readRoom(host.code);
  const rejected = { ...correction, id: "changed-goods-correction", target: { kind: "trade", id: laterReceipt.id }, before: canonicalJson(laterReceipt) };
  await assert.rejects(submitCommands({ ...host, batchId: "changed-goods-correction", commands: [rejected] }), /changed or left/);
  await assert.rejects(submitCommands({ ...host, batchId: "stale-correction-review", commands: [{ ...rejected, id: "stale-review", before: "{}" }] }), /receipt changed/);
  assert.deepEqual(await readRoom(host.code), moved);
  await deleteRoom(host.code, moved!.revision);
});

test("shared linked shop corrections preserve seasonal feedback and reject legacy partial table patches", async () => {
  const { choosePace } = await import("./cloud.server.ts");
  const table = tradeFixture();
  table.shops.push({ id: "reviewed-shop", name: "Reviewed shop", keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "mixed", priceScale: 1, locationId: "port" });
  table.stock.push({ id: "reviewed-stock", shopId: "reviewed-shop", name: "Timber bundle", copper: 100, quantity: 100, notes: "", baseCopper: 100, rarity: "common", category: "general", commodityId: "timber", tradeExchangeId: "harbor" });
  const host = await openRoom({ name: "Shop DM", table }), joined = await joinRoom({ code: host.code, purseId: "a", name: "Arden" });
  await choosePace({ ...host, live: true });
  await submitCommands({ code: host.code, token: joined.token, batchId: "linked-shop-purchase", commands: [{ id: "linked-shop-buy", kind: "buy", stockId: "reviewed-stock", purseId: "a", quantity: 3 }] });
  const bought = (await roomState(host)).table, receipt = bought.journal!.tradeEconomy!.receipts[0];
  assert.ok(bought.ledger[0].purchase?.holding);
  assert.deepEqual(bought.ledger[0].trade, { receiptId: receipt.id, leg: "owner" });
  const correction = { id: "linked-shop-correction", kind: "ledger-void" as const, target: { kind: "ledger" as const, id: bought.ledger[0].id }, before: canonicalJson(bought.ledger[0]), reason: "Wrong shop purchase" };
  const current = await readRoom(host.code), dm = current!.seats.find(seat => seat.token === host.token)!;
  const proposed = applyCommand(bought, dm, correction, { source: "server" });
  await assert.rejects(submitCommands({ ...host, batchId: "legacy-partial-shop-void", commands: [{ ...tablePatch(bought, proposed), id: "legacy-void-patch" }] }), /money, goods and seasonal activity/);
  assert.deepEqual(await readRoom(host.code), current);
  await submitCommands({ ...host, batchId: "typed-shop-void", commands: [correction] });
  await submitCommands({ ...host, batchId: "typed-shop-void-retry", commands: [correction] });
  const corrected = (await roomState(host)).table;
  assert.equal(corrected.ledger.length, 2);
  assert.equal(corrected.stock[0].quantity, 100);
  assert.equal(toCopper(corrected.purses.find(p => p.id === "a")!.coins), 100000);
  assert.deepEqual(corrected.holdings, table.holdings);
  await submitCommands({ ...host, batchId: "corrected-shop-season", commands: [{ id: "corrected-shop-season", kind: "trade-season-plan", before: tradeSeasonFingerprint(corrected) }] });
  const final = await roomState(host);
  assert.deepEqual(final.table.journal!.tradeEconomy!.pendingSeason!.feedback, [{ exchangeId: "harbor", commodityId: "timber", bought: 3, sold: 3 }]);
  await deleteRoom(host.code, final.revision);
});

test("shared zero-copper sale corrections need no cash ledger and retain historical image metadata through persistence", async () => {
  const { choosePace } = await import("./cloud.server.ts");
  const table = tradeFixture();
  table.journal!.tradeEconomy!.exchanges[0].offers[0].bidCopper = 0;
  const lot = { id: "zero-price-lot", purseId: "a", name: "Illustrated timber", kind: "item" as const, quantity: 5, unitCopper: 41, notes: "Keep the saved description", commodityId: "timber", weight: 2, image: "data:image/webp;base64," + "P".repeat(12000), historicalMetadata: { source: "Player archive", details: ["original"] } };
  table.holdings.push(lot);
  const host = await openRoom({ name: "Zero-price DM", table }), joined = await joinRoom({ code: host.code, purseId: "a", name: "Arden" });
  await choosePace({ ...host, live: true });
  const e = table.journal!.tradeEconomy!, sale = { id: "zero-sale", kind: "trade-sell", exchangeId: "harbor", commodityId: "timber", holdingId: lot.id, quantity: 4, before: exchangeQuoteKey(e, e.exchanges[0], e.commodities[0]) };
  await submitCommands({ code: host.code, token: joined.token, batchId: "zero-sale", commands: [sale] });
  const sold = (await roomState(host)).table, receipt = sold.journal!.tradeEconomy!.receipts[0];
  assert.equal(receipt.copper, 0);
  assert.deepEqual(JSON.parse(receipt.settlement!.holding), lot);
  assert.equal(sold.ledger.length, 0);
  const correction = { id: "zero-correction", kind: "ledger-void", target: { kind: "trade", id: receipt.id }, before: canonicalJson(receipt), reason: "Correct free goods movement" };
  await submitCommands({ ...host, batchId: "zero-correction", commands: [correction] });
  await submitCommands({ ...host, batchId: "zero-correction-lost", commands: [correction] });
  const final = await roomState(host);
  assert.deepEqual(final.table.holdings.find(h => h.id === lot.id), lot);
  assert.equal(final.table.ledger.length, 0);
  assert.equal(final.table.journal!.tradeEconomy!.receipts.length, 2);
  assert.equal(final.table.journal!.tradeEconomy!.exchanges[0].offers[0].stock, 100);
  await deleteRoom(host.code, final.revision);
});

test("large exact snapshots retain metadata and leave shared state intact when batch or backing row storage rejects", async () => {
  const { choosePace } = await import("./cloud.server.ts");
  const table = tradeFixture();
  const image = "data:image/webp;base64," + "P".repeat(450000);
  const lot = { id: "large-image-lot", purseId: "a", name: "Illustrated timber", kind: "item" as const, quantity: 2, unitCopper: 41, notes: "", commodityId: "timber", weight: 2, image, metadata: { preserve: true } };
  table.holdings.push(lot);
  const host = await openRoom({ name: "Large receipt DM", table });
  await choosePace({ ...host, live: true });
  const e = table.journal!.tradeEconomy!;
  const sale = { id: "large-sale", kind: "trade-sell", exchangeId: "harbor", commodityId: "timber", holdingId: lot.id, quantity: 1, before: exchangeQuoteKey(e, e.exchanges[0], e.commodities[0]) };
  await submitCommands({ ...host, batchId: "large-sale", commands: [sale] });
  const sold = (await roomState(host)).table, receipt = sold.journal!.tradeEconomy!.receipts[0];
  assert.equal(JSON.parse(receipt.settlement!.holding).image, image);
  const before = await readRoom(host.code);
  const oversized = Array.from({ length: 5 }, (_, index) => ({ id: "large-reversal-" + index, kind: "ledger-void", target: { kind: "trade", id: receipt.id }, before: canonicalJson(receipt), reason: "Review" }));
  await assert.rejects(submitCommands({ ...host, batchId: "oversized-correction-batch", commands: oversized }), /batch is too large/);
  assert.deepEqual(await readRoom(host.code), before);
  await deleteRoom(host.code, before!.revision);

  const nearLimit = tradeFixture();
  nearLimit.holdings.push(...Array.from({ length: 2 }, (_, index) => ({ ...lot, id: "near-limit-" + index })));
  const bounded = await openRoom({ name: "Backing write DM", table: nearLimit });
  const saved = await readRoom(bounded.code);
  // Disposable SQLite models a backing size rejection at the actual UPDATE,
  // after the command has built its full candidate, without changing product limits.
  // The budget sits below ROOM_BODY_LIMIT (1.8 MB) so the application size guard,
  // covered in scripts/room-row-growth.test.mjs, does not refuse the write first:
  // the sale's receipt copies the 450 KB lot, taking the row from ~0.9 MB to ~1.35 MB.
  sql.exec("CREATE TEMP TRIGGER market_test_row_budget BEFORE UPDATE ON campaign_rooms WHEN length(CAST(NEW.body AS BLOB)) > 1000000 BEGIN SELECT RAISE(ABORT, 'market test row storage budget'); END");
  // When the room is stored sectioned (suites run with the sectioning threshold forced to 0), the
  // same rejection comes from a section row instead; every section here starts below this budget.
  sql.exec("CREATE TEMP TRIGGER market_test_section_budget BEFORE INSERT ON campaign_room_sections WHEN length(CAST(NEW.body AS BLOB)) > 400000 BEGIN SELECT RAISE(ABORT, 'market test row storage budget'); END");
  try {
    await assert.rejects(submitCommands({ ...bounded, batchId: "row-budget-sale", commands: [{ ...sale, id: "row-budget-sale", holdingId: "near-limit-0" }] }), /row storage budget/);
    assert.deepEqual(await readRoom(bounded.code), saved);
  } finally {
    sql.exec("DROP TRIGGER market_test_row_budget");
    sql.exec("DROP TRIGGER market_test_section_budget");
    await deleteRoom(bounded.code, saved!.revision);
  }
});

test("separate shared campaign exchanges persist authoritative seasonal rolls, trades and one-time settlement across retries", async () => {
  const { choosePace } = await import("./cloud.server.ts");
  const host=await openRoom({name:"Economy DM",table:tradeFixture()}),other=await openRoom({name:"Separate economy",table:tradeFixture()});
  const joined=await joinRoom({code:host.code,purseId:"a",name:"Arden"});await choosePace({...host,live:true});
  const auth={code:host.code,token:joined.token},initial=(await roomState(auth)).table,e=initial.journal!.tradeEconomy!;
  const command={id:"economy-buy",kind:"trade-buy",exchangeId:"harbor",commodityId:"timber",purseId:"a",quantity:10,before:exchangeQuoteKey(e,e.exchanges[0],e.commodities[0])};
  await submitCommands({...auth,batchId:"economy-buy-first",commands:[command]});
  await submitCommands({...auth,batchId:"economy-buy-lost-response",commands:[command]});
  const bought=(await roomState(host)).table;assert.equal(bought.journal!.tradeEconomy!.receipts.length,1);assert.equal(bought.holdings.find(h=>h.commodityId)!.quantity,10);
  assert.equal((await roomState(other)).table.journal!.tradeEconomy!.receipts.length,0);
  await assert.rejects(submitCommands({...auth,batchId:"player-mode",commands:[{id:"player-mode",kind:"trade-settings",before:e.settings,settings:{...e.settings,mode:"classic"},reason:"No permission"}]}),/Only the DM/);
  const plan={id:"server-season",kind:"trade-season-plan",before:tradeSeasonFingerprint(bought)};
  await assert.rejects(submitCommands({...host,batchId:"staged-roll",commands:[plan],stage:true}),/directly/);
  await submitCommands({...host,batchId:"server-plan",commands:[plan]});
  const prepared=(await roomState(host)).table.journal!.tradeEconomy!;assert.ok(prepared.draws.every(d=>d.source==="server"));assert.equal(prepared.draws.length,5);
  await submitCommands({...host,batchId:"server-plan-lost",commands:[plan]});assert.deepEqual((await roomState(host)).table.journal!.tradeEconomy!.draws,prepared.draws);
  const playerView=(await roomState(auth)).table.journal!.tradeEconomy!;assert.deepEqual(playerView.draws,[]);assert.equal(playerView.pendingSeason,undefined);
  await submitCommands({...host,batchId:"cancel-server-preview",commands:[{id:"cancel-server-preview",kind:"trade-season-cancel",previewId:plan.id}]});
  await submitCommands({...host,batchId:"end-season-downtime",commands:[{id:"end-season-downtime",kind:"downtime-plan",name:"Session end",days:7,advanceSeason:true}]});
  const downtime=(await roomState(host)).table.journal!.finance!.downtime.at(-1)!;assert.deepEqual(downtime.quote.tradeSeason!.draws,prepared.draws);
  const settle={id:"settle-economy",kind:"downtime-apply",downtimeId:downtime.id,endSession:false};
  await submitCommands({...host,batchId:"settle-first",commands:[settle]});await submitCommands({...host,batchId:"settle-lost",commands:[settle]});
  const final=(await roomState(host)).table;assert.equal(final.journal!.tradeEconomy!.epoch,1);assert.equal(final.journal!.tradeEconomy!.history.length,1);assert.equal(final.journal!.finance!.day,7);
  assert.equal((await roomState(other)).table.journal!.tradeEconomy!.epoch,0);
});
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
  readFileSync(new URL("../../../cloudflare/migrations/0001_campaign_rooms.sql", import.meta.url), "utf8"),
);
sql.exec(
  readFileSync(new URL("../../../cloudflare/migrations/0024_campaign_room_receipts.sql", import.meta.url), "utf8"),
);
sql.exec(
  readFileSync(new URL("../../../cloudflare/migrations/0026_campaign_room_sections.sql", import.meta.url), "utf8"),
);
sql.exec(
  readFileSync(
    new URL("../../../cloudflare/migrations/0002_web_push.sql", import.meta.url),
    "utf8",
  ),
);
sql.exec(readFileSync(new URL("../../../cloudflare/migrations/0012_campaign_room_images.sql",import.meta.url),"utf8"));
sql.exec(readFileSync(new URL("../../../cloudflare/migrations/0013_campaign_resource_documents.sql",import.meta.url),"utf8"));
sql.exec(readFileSync(new URL("../../../cloudflare/migrations/0014_campaign_map_pings.sql",import.meta.url),"utf8"));
sql.exec(readFileSync(new URL("../../../cloudflare/migrations/0019_campaign_room_reports.sql",import.meta.url),"utf8"));
sql.exec(readFileSync(new URL("../../../cloudflare/migrations/0029_campaign_room_report_parts.sql",import.meta.url),"utf8"));
sql.exec(readFileSync(new URL("../../../cloudflare/migrations/0030_campaign_room_archive_keys.sql",import.meta.url),"utf8"));
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
test("unchanged reads retain seat checks and fresh encounter policy without hydrating private media", async () => {
  const { readJournal } = await import("./journal.ts");
  const table = { ...emptyCloudTable(), purses: [{ id: "poll-hero", name: "Hero", kind: "character" as const, coins: emptyCoins() }],
    journal: readJournal({ world: { maps: [{ id: "poll-map", name: "Map", image: "data:image/png;base64," + "A".repeat(120000), locationId: null, visible: true, anchors: [], markers: [] }] } }) };
  const host = await openRoom({ name: "Poll DM", table });
  const guest = await joinRoom({ code: host.code, purseId: "poll-hero", name: "Poll guest" });
  const auth = { code: host.code, token: guest.token }, first = await roomState(auth);
  const known = { ...auth, knownRevision: first.revision, knownSeatId: guest.seatId };
  const access = await readRoomAccess(host.code);
  assert.equal(access!.revision, first.revision);
  assert.equal("table" in access!, false);
  assert.equal("seats" in access!, true);
  let unchanged = await pollRoom(known);
  assert.equal("unchanged" in unchanged && unchanged.unchanged, true);
  assert.equal("table" in unchanged, false);
  assert.equal(unchanged.encounterActive, false);
  sql.exec("CREATE TABLE IF NOT EXISTS user(id TEXT PRIMARY KEY)");
  sql.prepare("INSERT OR IGNORE INTO user(id) VALUES (?)").run("synthetic-owner");
  sql.prepare("INSERT INTO dm_encounters(id,user_id,code,body,status,revision,created_at,updated_at) VALUES (?,?,?,?,'active',0,1,1)")
    .run("poll-encounter", "synthetic-owner", host.code, JSON.stringify({ name: "Private enemy name" }));
  unchanged = await pollRoom(known);
  assert.equal(unchanged.encounterActive, true);
  assert.ok(!JSON.stringify(unchanged).includes("Private enemy name"));
  assert.ok("table" in await pollRoom({ ...known, knownSeatId: "another-seat" }));
  await assert.rejects(pollRoom({ ...known, token: "invalid-token" }), /not seated/);
  // If referenced media becomes unreadable, the unchanged path still does no media read.
  sql.prepare("DELETE FROM campaign_room_images WHERE code=?").run(host.code);
  assert.equal("unchanged" in await pollRoom(known), true);
  await assert.rejects(roomState(auth), /image is missing/);
  const body = JSON.parse(sql.prepare("SELECT body FROM campaign_rooms WHERE code=?").get(host.code)!.body as string);
  body.closed = true;body.revision++;
  sql.prepare("UPDATE campaign_rooms SET revision=?,body=? WHERE code=?").run(body.revision, JSON.stringify(body), host.code);
  await assert.rejects(pollRoom(known), /closed/);
});
test("changed revisions force complete reads with current drafts and acknowledgements", async () => {
  const host = await openRoom({ name: "Changed poll DM", table: { ...emptyCloudTable(), purses: [{ id: "poll-next", name: "Next", kind: "character" as const, coins: emptyCoins() }] } });
  const first = await roomState(host), known = { ...host, knownRevision: first.revision, knownSeatId: first.seatId };
  const command = { id: "poll-staged", kind: "portrait", purseId: "poll-next", portrait: "/art/player.webp" };
  await submitCommands({ ...host, batchId: "poll-stage", commands: [command], stage: true });
  const staged = await pollRoom(known);
  assert.ok("table" in staged);
  assert.match((staged as typeof first).draft, /poll-staged/);
  await submitCommands({ ...host, batchId: "poll-commit", commands: [command] });
  const committed = await pollRoom(known);
  assert.ok("table" in committed);
  assert.deepEqual((committed as typeof first).acknowledged, [command.id]);
});
test("one atomic command batch deduplicates repeated action IDs before applying financial changes", async () => {
  const host = await openRoom({ name:"Batch DM",table:{...emptyCloudTable(),purses:[
    {id:"batch-a",name:"A",kind:"character",coins:fromCopper(500)},
    {id:"batch-b",name:"B",kind:"character",coins:fromCopper(0)},
  ]} });
  const command={id:"batch-duplicate",kind:"give",fromId:"batch-a",toId:"batch-b",copper:100,holdingId:null,quantity:0};
  const request={...host,batchId:"batch-duplicate-receipt",commands:[command,command]};
  const saved=await submitCommands(request);
  assert.equal(toCopper(saved.table.purses[0].coins),400);assert.equal(toCopper(saved.table.purses[1].coins),100);
  assert.equal(saved.table.ledger.length,2);
  assert.deepEqual((await submitCommands(request)).table,saved.table);
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
  assert.equal(verified.payload.sub, deploymentOrigins.website);
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
    // F12: on a Worker the submit answers first and the push continues under waitUntil.
    const { runWithRequestContext } = await import("../../../cloudflare/request-context.mjs");
    sql.prepare("UPDATE push_subscriptions SET last_sent=0").run();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    globalThis.fetch = async () => {
      sends++;
      await held;
      return new Response(null, { status: 201 });
    };
    const deferred: Promise<unknown>[] = [];
    const answered = await runWithRequestContext({ waitUntil: (p: Promise<unknown>) => deferred.push(p) }, () =>
      submitCommands({ ...opened, batchId: "push-deferred", commands: [{ ...cmd, id: "push-later" }] }),
    );
    assert.ok(answered.revision > 0, "the submit answered while the push service was still waiting");
    assert.equal(deferred.length, 1);
    release();
    await Promise.all(deferred);
    assert.equal(sends, 2, "the deferred notification was still sent");
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
  const {readStoredRoom,roomWriteStatements}=await import("../../../cloudflare/room-storage.mjs");
  await assert.rejects(hydrateRoomImages(database()!,"another-campaign",(await readStoredRoom(database()!,host.code))!.room),/missing/);
  const directRead=(await readStoredRoom(database()!,host.code))!,direct=directRead.room;
  direct.table.purses[0].portrait=maps[0].image;
  const directBody=JSON.stringify(direct);
  await database()!.batch(roomWriteStatements(database()!,direct,{expect:directRead.version,body:directBody}).statements);
  const latest=await readRoom(host.code),stale=structuredClone(latest!);
  const {roomStorageBody}=await import("./room-store.server.ts"),{encodeRoomImages}=await import("../../../cloudflare/room-images.mjs");
  assert.equal(latest!.table.purses[0].portrait,maps[0].image);
  assert.equal(roomStorageBody(latest!),directBody);
  assert.notEqual((await encodeRoomImages(latest!)).body,directBody);
  assert.ok(!Object.keys(latest!).some(key=>key.includes("stored")));stale.revision++;stale.table.journal!.world!.maps[0].image="data:image/png;base64,"+"Z".repeat(480000);
  await assert.rejects(updateRoom(stale,latest!.revision-1),/changed/);assert.equal(sql.prepare("SELECT count(*) AS n FROM campaign_room_images WHERE code=?").get(host.code)!.n,6);
  assert.deepEqual((await readRoom(host.code))!.table.journal!.world!.maps,maps);await deleteRoom(host.code,latest!.revision);
});

test("map storage leaves raw character portraits and non-map inventory recovery bytes intact", async () => {
  const {encodeRoomImages} = await import("../../../cloudflare/room-images.mjs");
  const portrait = "data:image/webp;base64," + "P".repeat(12000);
  const mapImage = "data:image/webp;base64," + "M".repeat(12000);
  const table = emptyCloudTable();
  table.journal=(await import("./journal.ts")).readJournal(undefined);
  table.purses=[{id:"portrait-holder",name:"Portrait holder",kind:"character",coins:{cp:0,sp:0,ep:0,gp:0,pp:0},portrait}];
  table.holdings=[{id:"illustrated-item",purseId:"portrait-holder",name:"Illustrated item",kind:"item",quantity:1,unitCopper:1,notes:"",image:portrait}];
  const makeMap=(id:string,image:string)=>({id,name:id,image,locationId:null,visible:true,anchors:[],markers:[]});
  table.journal!.world={characterPositions:[],maps:[makeMap("map",mapImage),makeMap("portrait-map",portrait)],npcs:[],trades:[],conversations:[],blackMarketActive:false,timeHistory:[]};
  const snapshot = JSON.stringify(table,null,2);
  table.journal!.reports=[{id:"portrait-report",name:"Portrait record",at:1,snapshot}];
  const encoded=await encodeRoomImages({table,drafts:{dm:[{kind:"map-save",map:makeMap("queued",mapImage),before:null}]}});
  assert.equal(encoded.assets.length,1);
  const raw=JSON.parse(encoded.body);
  assert.equal(raw.table.purses[0].portrait,portrait);
  assert.equal(raw.table.holdings[0].image,portrait);
  // Archived snapshots are stored beside the room row (room-reports.mjs), byte for byte.
  assert.equal(raw.table.journal.reports[0].snapshot,undefined);
  assert.equal(encoded.reports.length,1);
  assert.equal(raw.table.journal.reports[0].snapshotReference,encoded.reports[0].reference);
  assert.ok(encoded.reports[0].body.includes(portrait));
  assert.equal(raw.table.journal.world.maps[1].image,portrait);
  assert.equal(raw.drafts.dm[0].map.image,encoded.assets[0].reference);
  const {snapshotReference:_reference,...report}=raw.table.journal.reports[0];
  raw.table.journal.reports[0]={...report,snapshot:encoded.reports[0].body};
  assert.equal(JSON.stringify(raw).split(encoded.assets[0].reference).join(encoded.assets[0].image),JSON.stringify({table,drafts:{dm:[{kind:"map-save",map:makeMap("queued",mapImage),before:null}]}}));
});

test("large resource packs deduplicate across archives, hydrate complete bytes and remain campaign-scoped and CAS-atomic", async () => {
  const { readJournal } = await import("./journal.ts");
  const { hydrateRoomResources } = await import("../../../cloudflare/room-resources.mjs");
  const { database } = await import("./room-store.server.ts");
  const table = emptyCloudTable(),
    pack = structuredClone(resourcePackFixture);
  const original = pack.entries[0];
  pack.entries = Array.from({ length: 100 }, (_, i) => ({
    ...original,
    id: `large-${i}`,
    name: `Large synthetic ${i}`,
    text: "Synthetic reference text. ".repeat(450),
  }));
  table.journal = readJournal({ resourceLibrary: { packs: [pack] } });
  const archived = JSON.stringify(table);
  table.journal.reports = Array.from({ length: 3 }, (_, i) => ({
    id: `large-archive-${i}`,
    name: "Synthetic archive",
    at: i,
    snapshot: archived,
  }));
  const room = {
    code: "resource-storage-test",
    revision: 1,
    turn: 0,
    live: false,
    seats: [{ id: "dm", token: "test", name: "DM", role: "dm" as const, purseIds: [] }],
    table,
    seen: { gifts: [], sales: [] },
  };
  await createRoom(room);
  const raw = sql.prepare("SELECT body FROM campaign_rooms WHERE code=?").get(room.code) as {
    body: string;
  };
  assert.ok(raw.body.length < 10000);
  assert.equal(
    (
      sql
        .prepare("SELECT count(*) AS n FROM campaign_resource_documents WHERE code=?")
        .get(room.code) as { n: number }
    ).n,
    1,
  );
  assert.deepEqual(await readRoom(room.code), room);
  await assert.rejects(
    hydrateRoomResources(
      database()!,
      "other-campaign",
      (await (await import("../../../cloudflare/room-storage.mjs")).readStoredRoom(database()!, room.code))!.room,
    ),
    /missing/,
  );
  const changed = structuredClone(room);
  changed.revision = 2;
  changed.table.journal!.resourceLibrary!.packs[0].revision = "2";
  await assert.rejects(updateRoom(changed, 0), /table changed/);
  assert.equal(
    (
      sql
        .prepare("SELECT count(*) AS n FROM campaign_resource_documents WHERE code=?")
        .get(room.code) as { n: number }
    ).n,
    1,
  );
  assert.deepEqual(await readRoom(room.code), room);
  await updateRoom(changed, 1);
  assert.deepEqual(await readRoom(room.code), changed);
  assert.equal(
    (
      sql
        .prepare("SELECT count(*) AS n FROM campaign_resource_documents WHERE code=?")
        .get(room.code) as { n: number }
    ).n,
    2,
  );
  await deleteRoom(room.code, 2);
});


test("map pings cross seats outside turns without changing campaigns; expiry, map privacy and revoked sessions are enforced", async () => {
  const {mapSignals} = await import("./map-signals.server.ts");
  const {choosePace,closeRoom,manageRoom} = await import("./cloud.server.ts");
  const table = emptyCloudTable();
  table.purses = [{id:"ping-hero",name:"Ping hero",kind:"character",coins:emptyCoins()}];
  const map = {id:"public-map",name:"Shared map",image:"data:image/webp;base64,fixture",locationId:null,visible:true,anchors:[],markers:[]};
  table.journal = {sessions:[],events:[],requests:[],world:{characterPositions:[],maps:[map,{...map,id:"secret-map",visible:false}],npcs:[],trades:[],timeHistory:[],conversations:[],blackMarketActive:false}};
  const host = await openRoom({name:"Pings DM",table});
  const guest = await joinRoom({code:host.code,purseId:"ping-hero",name:"Player"});
  const player = {code:host.code,token:guest.token,mapId:map.id};
  const dm = {...host,mapId:map.id};
  const before = await readRoom(host.code), originalNow = Date.now;
  let now = originalNow(); Date.now = () => now;
  const ping = {id:crypto.randomUUID(),mapId:map.id,x:.2,y:.8,color:"red"};
  try {
    await mapSignals({...player,ping});
    assert.equal((await mapSignals(dm)).pings[0].color,"red");
    assert.deepEqual(await readRoom(host.code),before,"signals do not alter room revisions, campaign data, drafts or ledger");
    await assert.rejects(mapSignals({...player,ping:{...ping,id:crypto.randomUUID()}}),/Wait/);
    await assert.rejects(mapSignals({...player,ping:{...ping,x:1.2}}));
    await assert.rejects(mapSignals({...player,ping:{...ping,color:"javascript"}}));
    await assert.rejects(mapSignals({...player,token:"forged"}),/not seated/);
    await assert.rejects(mapSignals({...player,mapId:"secret-map"}),/unavailable/);
    await mapSignals({...host,mapId:"secret-map",ping:{...ping,id:crypto.randomUUID(),mapId:"secret-map"}});
    assert.equal((await mapSignals(player)).pings.length,1,"secret map pings never cross the player map response");
    now += 5001;
    assert.deepEqual((await mapSignals(dm)).pings,[]);
    // Reads only filter expired pings; the minute cron (and the next insert) reclaims them (F6).
    const {expireMapPings} = await import("../../../cloudflare/map-ping-expiry.mjs");
    await expireMapPings((globalThis as any).__env__.DB, now);
    assert.equal(sql.prepare("SELECT count(*) AS n FROM campaign_map_pings WHERE code=?").get(host.code)!.n,0);
    await choosePace({...host,live:true});
    await mapSignals({...dm,ping:{...ping,id:crypto.randomUUID(),color:"blue"}});
    assert.equal((await mapSignals(player)).pings[0].color,"blue");
    await closeRoom({...host,keepOnline:true});
    await assert.rejects(mapSignals({...player,ping:{...ping,id:crypto.randomUUID()}}),/Resume play/);
    await choosePace({...host,live:false});
    sql.exec("CREATE TABLE IF NOT EXISTS library_members(user_id TEXT, code TEXT, seat_id TEXT, token TEXT)");
    await manageRoom({...host,action:"kick",seatId:guest.seatId});
    await assert.rejects(mapSignals(player),/not seated/);
    await closeRoom(host);
    await assert.rejects(mapSignals(dm),/unavailable/);
  } finally {Date.now = originalNow; const last=await readRoom(host.code); if(last) await deleteRoom(host.code,last.revision);}
});

test("shared map tiles and travel placement preserve privacy, reject forged moves and commit once", async () => {
  const { choosePace } = await import("./cloud.server.ts");
  const table = emptyCloudTable(),
    grid = {
      columns: 10,
      rows: 10,
      feetPerTile: 5,
      diagonal: "equal" as const,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    };
  table.purses = [{ id: "tile-hero", name: "Tile hero", kind: "character", coins: emptyCoins() }];
  table.journal = {
    sessions: [],
    events: [],
    requests: [],
    world: {
      characterPositions: [],
      maps: [
        {
          id: "tiles",
          name: "Tiles",
          image: "data:image/png;base64,aA==",
          visible: true,
          locationId: null,
          type: "dungeon",
          grid,
          tokens: [],
          anchors: [],
          markers: [],
        },
      ],
      npcs: [],
      trades: [],
      timeHistory: [],
      conversations: [],
      blackMarketActive: false,
    },
  };
  const host = await openRoom({ name: "Tile DM", table }),
    guest = await joinRoom({ code: host.code, purseId: "tile-hero", name: "Tile player" }),
    auth = { code: host.code, token: guest.token };
  await choosePace({ ...host, live: true });
  const token = {
      id: "tile-pc",
      kind: "character",
      entityId: "tile-hero",
      label: "Tile hero",
      column: 1,
      row: 1,
      visibility: "party",
    },
    add = {
      id: "tile-add",
      kind: "map-token",
      mapId: "tiles",
      grid,
      tokenId: token.id,
      before: null,
      token,
    };
  await assert.rejects(
    submitCommands({ ...auth, batchId: "forged-tile", commands: [add] }),
    /Only the DM/,
  );
  await submitCommands({ ...host, batchId: "add-tile", commands: [add] });
  await submitCommands({ ...host, batchId: "retry-tile", commands: [add] });
  assert.equal((await roomState(host)).table.journal!.world!.maps[0].tokens!.length, 1);
  const move = { ...add, id: "tile-move", before: token, token: { ...token, column: 3 } };
  await submitCommands({ ...host, batchId: "move-tile", commands: [move] });
  await assert.rejects(
    submitCommands({ ...host, batchId: "stale-tile", commands: [{ ...move, id: "stale-move" }] }),
    /moved or changed/,
  );
  await submitCommands({
    ...host,
    batchId: "secret-tile",
    commands: [
      {
        ...add,
        id: "secret-token",
        tokenId: "secret",
        token: {
          id: "secret",
          kind: "other",
          label: "Secret map trap",
          column: 8,
          row: 8,
          visibility: "dm",
        },
      },
    ],
  });
  const position = {
      mapId: "tiles",
      x: 0.3,
      y: 0.2,
      environment: "Sea",
      description: "Near coast",
    },
    placement = {
      id: "free-party",
      kind: "party-map-position",
      before: null,
      beforeLocationId: null,
      position,
    };
  await assert.rejects(
    submitCommands({ ...auth, batchId: "forged-party", commands: [placement] }),
    /Only the DM/,
  );
  await submitCommands({ ...host, batchId: "free-party", commands: [placement] });
  await submitCommands({ ...host, batchId: "retry-party", commands: [placement] });
  const playerView = (await roomState(auth)).table;
  assert.deepEqual(playerView.journal!.world!.partyPosition, position);
  assert.deepEqual(
    playerView.journal!.world!.maps[0].tokens!.map((t) => t.id),
    ["tile-pc"],
  );
  assert.ok(!JSON.stringify(playerView).includes("Secret map trap"));
  const final = await roomState(host);
  assert.equal(final.table.journal!.events.filter((e) => e.id === "free-party-event").length, 1);
  await deleteRoom(host.code, final.revision);
});

test("initiative panel (map controls): a player reads only revealed order, round, turn and own HP, behind the HUD's gates", async () => {
  const { mapCombatOrder, choosePace } = await import("./cloud.server.ts");
  const { campaignMapSchema } = await import("./world-schema.ts");
  const { readJournal } = await import("./journal.ts");
  const battle = campaignMapSchema.parse({ id: "order-battle", name: "Order battle", image: "data:image/png;base64,YQ==", visible: true, locationId: null, anchors: [], markers: [],
    grid: { columns: 10, rows: 10, feetPerTile: 5, diagonal: "equal", x: 0, y: 0, width: 1, height: 1 },
    tokens: [{ id: "hero-token", label: "Hero", kind: "character", entityId: "order-hero", column: 0, row: 0, visibility: "party" },
      { id: "ally-token", label: "Ally", kind: "character", entityId: "order-ally", column: 1, row: 0, visibility: "party" },
      { id: "scout-token", label: "Known scout", kind: "creature", encounterId: "order-encounter", combatantId: "scout", column: 2, row: 0, visibility: "party" },
      { id: "dragon-token", label: "Secret dragon", kind: "creature", encounterId: "order-encounter", combatantId: "dragon", column: 3, row: 0, visibility: "dm" }],
  });
  const table = { ...emptyCloudTable(), purses: [{ id: "order-hero", name: "Hero", kind: "character" as const, coins: emptyCoins() }, { id: "order-ally", name: "Ally", kind: "character" as const, coins: emptyCoins() }], journal: readJournal({ world: { maps: [battle] } }) };
  const host = await openRoom({ name: "Order DM", table }), guest = await joinRoom({ code: host.code, purseId: "order-hero", name: "Order player" });
  await choosePace({ ...host, live: true });
  const binding = { id: "order-transition", encounterId: "order-encounter", encounterRevision: 0, mapId: battle.id, returnMapId: battle.id, returnCamera: { x: .5, y: .5, zoom: 1 }, mode: "theatre", phase: "active", scaleConfirmed: false, showPlayers: false };
  await submitCommands({ ...host, batchId: "order-start", commands: [{ id: "order-activate", kind: "map-combat-transition", before: null, binding, beforeSession: null }] });
  const body = { name: "Private fight", round: 2, activeId: "scout", notes: "Secret tactics",
    combatants: [{ id: "dragon", name: "Ancient dragon", initiative: 22, hp: 300, maxHp: 300, conditions: "Invisible" },
      { id: "order-hero", name: "Hero", initiative: 18, hp: 21, maxHp: 30, conditions: "Blessed" },
      { id: "scout", name: "Black Gull scout", initiative: 15, hp: 3, maxHp: 16, notes: "Flees" },
      { id: "order-ally", name: "Ally", initiative: 9, hp: 40, maxHp: 44 }] };
  sql.exec("CREATE TABLE IF NOT EXISTS user(id TEXT PRIMARY KEY)");
  sql.prepare("INSERT OR IGNORE INTO user(id) VALUES (?)").run("synthetic-owner");
  sql.prepare("INSERT INTO dm_encounters(id,user_id,code,body,status,revision,created_at,updated_at) VALUES (?,?,?,?,'active',1,1,1)").run("order-encounter", "synthetic-owner", host.code, JSON.stringify(body));
  const auth = { code: host.code, token: guest.token, mapId: battle.id };
  // Not shown to players yet: nothing.
  assert.equal(await mapCombatOrder(auth), null);
  await assert.rejects(mapCombatOrder({ ...auth, token: "not-a-seat" }), /not seated/);
  // The DM shows combat to players on this scene (as the transition does with showPlayers).
  const room = (await readRoom(host.code))!;
  const world = room.table.journal!.world!;
  world.combat = { ...world.combat!, showPlayers: true };
  world.tabletop = { ...world.tabletop!, presentation: { id: binding.id, mapId: battle.id, mode: "theatre" } };
  await updateRoom({ ...room, revision: room.revision + 1 }, room.revision);
  const order = await mapCombatOrder(auth);
  assert.deepEqual(order, {
    mapId: battle.id,
    status: "active",
    round: 2,
    entries: [
      { tokenId: "hero-token", label: "Hero", initiative: 18, active: false, own: true, hp: 21, maxHp: 30 },
      { tokenId: "scout-token", label: "Known scout", initiative: null, active: true, own: false },
      { tokenId: "ally-token", label: "Ally", initiative: null, active: false, own: false },
    ],
  });
  const text = JSON.stringify(order);
  for (const secret of ["dragon", "Ancient", "300", "Invisible", "Blessed", "Black Gull", "Flees", "Private", "Secret", "40", "44"])
    assert.ok(!text.includes(secret), `a player never reads "${secret}"`);
  assert.equal(await mapCombatOrder({ ...auth, mapId: "other-map" }), null);
  // Fog: a party-visible creature outside the seat's vision is never listed (nor its turn).
  const { mapTabletopSchema } = await import("./tabletop-schema.ts");
  const fogged = (await readRoom(host.code))!;
  const foggedMap = fogged.table.journal!.world!.maps.find((m) => m.id === battle.id)!;
  foggedMap.tabletop = mapTabletopSchema.parse({ fog: { enabled: true, base: "concealed", shapes: [] } });
  await updateRoom({ ...fogged, revision: fogged.revision + 1 }, fogged.revision);
  const foggedOrder = await mapCombatOrder(auth);
  assert.ok(foggedOrder, "still shown to players under fog");
  assert.ok(
    !foggedOrder!.entries.some((e) => e.tokenId === "scout-token"),
    "the fogged scout is not listed",
  );
  assert.ok(!JSON.stringify(foggedOrder).includes("scout"), "nothing names the fogged scout");
  assert.ok(foggedOrder!.entries.every((e) => !e.active), "the fogged scout's turn is not revealed");
  sql.prepare("UPDATE dm_encounters SET code=? WHERE id=?").run("FOREIGN", "order-encounter");
  assert.equal(await mapCombatOrder(auth), null);
  sql.prepare("UPDATE dm_encounters SET code=? WHERE id=?").run(host.code, "order-encounter");
  const later = (await readRoom(host.code))!;
  later.table.journal!.world!.tabletop!.presentation = null;
  await updateRoom({ ...later, revision: later.revision + 1 }, later.revision);
  assert.equal(await mapCombatOrder(auth), null);
});

test("connected combat presentation rechecks seats, campaign, fog and scene permission without leaking tracker data", async () => {
  const { mapCombatPresentation, choosePace } = await import("./cloud.server.ts");
  const { campaignMapSchema } = await import("./world-schema.ts");
  const { readJournal } = await import("./journal.ts");
  const { mapTabletopSchema } = await import("./tabletop-schema.ts");
  const battle = campaignMapSchema.parse({ id: "hud-battle", name: "Shared battle", image: "data:image/png;base64,YQ==", visible: true, locationId: null, anchors: [], markers: [],
    grid: { columns: 10, rows: 10, feetPerTile: 5, diagonal: "equal", x: 0, y: 0, width: 1, height: 1 },
    tokens: [{ id: "known-token", label: "Known scout", kind: "creature", encounterId: "hud-encounter", combatantId: "known", column: 1, row: 1, visibility: "party" },
      { id: "secret-token", label: "Secret dragon", kind: "creature", encounterId: "hud-encounter", combatantId: "secret", column: 2, row: 2, visibility: "dm" }],
  });
  const table = { ...emptyCloudTable(), purses: [{ id: "hud-hero", name: "Hero", kind: "character" as const, coins: emptyCoins() }], journal: readJournal({ world: { maps: [battle] } }) };
  const host = await openRoom({ name: "HUD DM", table }), guest = await joinRoom({ code: host.code, purseId: "hud-hero", name: "HUD player" });
  await choosePace({ ...host, live: true });
  const binding = { id: "hud-transition", encounterId: "hud-encounter", encounterRevision: 0, mapId: battle.id, returnMapId: battle.id, returnCamera: { x: .5, y: .5, zoom: 1 }, mode: "theatre", phase: "active", scaleConfirmed: false, showPlayers: true };
  const command = { id: "hud-activate", kind: "map-combat-transition", before: null, binding, beforeSession: null };
  await assert.rejects(submitCommands({ code: host.code, token: guest.token, batchId: "hud-forged", commands: [command] }), /Only the DM/);
  await submitCommands({ ...host, batchId: "hud-start", commands: [command] });
  await submitCommands({ ...host, batchId: "hud-retry", commands: [command] });
  const privateBody = { name: "Private encounter name", round: 3, activeId: "known", notes: "Secret tactics", combatants: [{ id: "known", hp: 27 }], loot: "Secret treasure" };
  sql.exec("CREATE TABLE IF NOT EXISTS user(id TEXT PRIMARY KEY)");
  sql.prepare("INSERT OR IGNORE INTO user(id) VALUES (?)").run("synthetic-owner");
  sql.prepare("INSERT INTO dm_encounters(id,user_id,code,body,status,revision,created_at,updated_at) VALUES (?,?,?,?,'active',1,1,1)").run("hud-encounter", "synthetic-owner", host.code, JSON.stringify(privateBody));
  const auth = { code: host.code, token: guest.token, mapId: battle.id };
  assert.deepEqual(await mapCombatPresentation(auth), { mapId: battle.id, status: "active", round: 3, activeTokenId: "known-token" });
  privateBody.activeId = "secret";
  sql.prepare("UPDATE dm_encounters SET body=? WHERE id=?").run(JSON.stringify(privateBody), "hud-encounter");
  assert.deepEqual(await mapCombatPresentation(auth), { mapId: battle.id, status: "active", round: 3 });
  privateBody.activeId = "known";
  sql.prepare("UPDATE dm_encounters SET body=? WHERE id=?").run(JSON.stringify(privateBody), "hud-encounter");
  const before = (await roomState(host)).table.journal!.world!.maps[0];
  await submitCommands({ ...host, batchId: "hud-fog", commands: [{ id: "hud-fog", kind: "map-save", mapId: battle.id, before, map: { ...before, tabletop: mapTabletopSchema.parse({ fog: { enabled: true, base: "concealed", shapes: [] } }) } }] });
  assert.deepEqual(await mapCombatPresentation(auth), { mapId: battle.id, status: "active", round: 3 });
  assert.equal(await mapCombatPresentation({ ...auth, mapId: "other-map" }), null);
  sql.prepare("UPDATE dm_encounters SET code=? WHERE id=?").run("FOREIGN", "hud-encounter");
  assert.equal(await mapCombatPresentation(auth), null);
  sql.prepare("UPDATE dm_encounters SET code=? WHERE id=?").run(host.code, "hud-encounter");
  const room = (await readRoom(host.code))!;
  const session = room.table.journal!.world!.tabletop!;
  session.presentation = null;
  await updateRoom({ ...room, revision: room.revision + 1 }, room.revision);
  assert.equal(await mapCombatPresentation(auth), null);
  await assert.rejects(mapCombatPresentation({ ...auth, token: "revoked-token" }), /not seated/);
  const saved = (await roomState(host)).table;
  assert.deepEqual(saved.ledger, []);
  assert.deepEqual(saved.holdings, []);
});

test("combat HUD and initiative polls read the room once, without map rasters (audit 2026-10-28 F8)", async () => {
  const { mapCombatOrder, mapCombatPresentation, choosePace } = await import("./cloud.server.ts");
  const { campaignMapSchema } = await import("./world-schema.ts");
  const { readJournal } = await import("./journal.ts");
  const art = "data:image/webp;base64," + "Q".repeat(20000);
  const battle = campaignMapSchema.parse({ id: "light-battle", name: "Light battle", image: art, visible: true, locationId: null, anchors: [], markers: [],
    grid: { columns: 10, rows: 10, feetPerTile: 5, diagonal: "equal", x: 0, y: 0, width: 1, height: 1 },
    tokens: [{ id: "light-hero-token", label: "Hero", kind: "character", entityId: "light-hero", column: 0, row: 0, visibility: "party" },
      { id: "light-scout-token", label: "Known scout", kind: "creature", encounterId: "light-encounter", combatantId: "scout", column: 2, row: 0, visibility: "party" },
      { id: "light-dragon-token", label: "Secret dragon", kind: "creature", encounterId: "light-encounter", combatantId: "dragon", column: 3, row: 0, visibility: "dm" }],
  });
  const table = { ...emptyCloudTable(), purses: [{ id: "light-hero", name: "Hero", kind: "character" as const, coins: emptyCoins() }], journal: readJournal({ world: { maps: [battle] } }) };
  const host = await openRoom({ name: "Light DM", table }), guest = await joinRoom({ code: host.code, purseId: "light-hero", name: "Light player" });
  await choosePace({ ...host, live: true });
  const binding = { id: "light-transition", encounterId: "light-encounter", encounterRevision: 0, mapId: battle.id, returnMapId: battle.id, returnCamera: { x: .5, y: .5, zoom: 1 }, mode: "theatre", phase: "active", scaleConfirmed: false, showPlayers: true };
  await submitCommands({ ...host, batchId: "light-start", commands: [{ id: "light-activate", kind: "map-combat-transition", before: null, binding, beforeSession: null }] });
  sql.exec("CREATE TABLE IF NOT EXISTS user(id TEXT PRIMARY KEY)");
  sql.prepare("INSERT OR IGNORE INTO user(id) VALUES (?)").run("synthetic-owner");
  const body = { name: "Private fight", round: 4, activeId: "scout", combatants: [{ id: "dragon", initiative: 22, hp: 300 }, { id: "light-hero", initiative: 18, hp: 21, maxHp: 30 }, { id: "scout", initiative: 15, hp: 3 }] };
  sql.prepare("INSERT INTO dm_encounters(id,user_id,code,body,status,revision,created_at,updated_at) VALUES (?,?,?,?,'active',1,1,1)").run("light-encounter", "synthetic-owner", host.code, JSON.stringify(body));
  const stored = sql.prepare("SELECT body FROM campaign_rooms WHERE code=?").get(host.code) as { body: string };
  assert.ok(!stored.body.includes(art), "the map raster is stored beside the room row");
  const env = (globalThis as any).__env__, prepare = env.DB.prepare;
  const queries: string[] = [];
  env.DB.prepare = (query: string) => (queries.push(query), prepare.call(env.DB, query));
  try {
    for (const [seat, read, expected] of [
      [guest, mapCombatPresentation, { mapId: battle.id, status: "active", round: 4, activeTokenId: "light-scout-token" }],
      [host, mapCombatPresentation, { mapId: battle.id, status: "active", round: 4, activeTokenId: "light-scout-token" }],
      [guest, mapCombatOrder, { mapId: battle.id, status: "active", round: 4, entries: [
        { tokenId: "light-hero-token", label: "Hero", initiative: 18, active: false, own: true, hp: 21, maxHp: 30 },
        { tokenId: "light-scout-token", label: "Known scout", initiative: null, active: true, own: false }] }],
    ] as const) {
      queries.length = 0;
      assert.deepEqual(await (read as typeof mapCombatOrder)({ code: host.code, token: seat.token, mapId: battle.id }), expected);
      // A sectioned room (suites run with the sectioning threshold forced to 0) keeps the combat
      // binding in a section, so its encounter is read in a second, version-guarded statement.
      const reads = stored.body.startsWith('{"$sections":') ? 2 : 1;
      assert.equal(queries.filter((q) => /FROM campaign_rooms/.test(q)).length, reads, queries.join("\n"));
      assert.equal(queries.filter((q) => /dm_encounters/.test(q)).length, reads, "the encounter is read in the same statement");
      // Besides it, only the shared character-sheet lookup that every room read makes.
      assert.equal(queries.filter((q) => !/FROM play_characters/.test(q)).length, reads, queries.join("\n"));
      assert.ok(!queries.some((q) => /campaign_room_images|campaign_room_reports/.test(q)), "no rasters or reports");
    }
  } finally {
    env.DB.prepare = prepare;
  }
});

test("market location and other journal artwork is stored beside the room row; shared portraits stay inline", async () => {
  const { readJournal } = await import("./journal.ts");
  const { encodeRoomImages } = await import("../../../cloudflare/room-images.mjs");
  const art = (letter: string) => "data:image/webp;base64," + letter.repeat(90000);
  const portrait = art("P");
  const locations = Array.from({ length: 24 }, (_, i) => ({
    id: `loc-${i}`,
    name: `Place ${i}`,
    kind: "region",
    parentId: null,
    description: "",
    image: art(String.fromCharCode(97 + i)),
  }));
  const table = {
    ...emptyCloudTable(),
    purses: [
      { id: "art-hero", name: "Hero", kind: "character" as const, coins: emptyCoins(), portrait },
    ],
    journal: readJournal({ market: { locations, currentLocationId: null } }),
  };
  // An NPC record that mirrors the purse portrait keeps the inline copy SQL reads rely on.
  (table.journal as any).market.locations[0].image = portrait;
  const before = JSON.stringify(table);
  assert.ok(before.length > 1_800_000, "the old inline form is over the room budget");
  const encoded = await encodeRoomImages({
    table,
    drafts: {
      dm: [
        {
          kind: "patch",
          changes: [
            { store: "journal", id: 'journal:["market"]', before: null, after: { locations } },
          ],
        },
      ],
    },
  });
  assert.ok(encoded.body.length < 300_000, `encoded body is ${encoded.body.length} characters`);
  assert.equal(encoded.assets.length, 24); // 23 table images plus the draft-only original of loc-0
  const raw = JSON.parse(encoded.body);
  assert.equal(raw.table.purses[0].portrait, portrait);
  assert.equal(raw.table.journal.market.locations[0].image, portrait);
  assert.match(
    raw.table.journal.market.locations[1].image,
    /^\/art\/room-image-[a-f0-9]{64}\.webp$/,
  );
  assert.match(raw.drafts.dm[0].changes[0].after.locations[2].image, /^\/art\/room-image-/);
  let restored = encoded.body;
  for (const asset of encoded.assets) restored = restored.split(asset.reference).join(asset.image);
  assert.deepEqual(JSON.parse(restored).table, JSON.parse(before));
  // Through D1: the room opens under the budget and every image hydrates exactly.
  const host = await openRoom({ name: "Artwork DM", table });
  assert.ok(
    (sql.prepare("SELECT body FROM campaign_rooms WHERE code=?").get(host.code) as { body: string })
      .body.length < 300_000,
  );
  const read = await readRoom(host.code);
  assert.deepEqual(read!.table.journal!.market!.locations, table.journal.market!.locations);
  await deleteRoom(host.code, read!.revision);
});
