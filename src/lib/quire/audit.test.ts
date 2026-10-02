import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { quireDb } from "./db.ts";
import { buyFromShop, buyListing, listPurses, listHoldings, listLedger, listStock, ensureEconomy, snapshot, restore, askLoan, decideLoan, savePurse } from "./economy.ts";
import { loadNotes, postNotes } from "./chat.ts";
import { saveHandouts, loadHandouts } from "./handouts.ts";
import { saveListings, loadLoans } from "./market.ts";
import { parsePrice, spendCoins, emptyCoins, toCopper } from "./money.ts";
import { claimSeat, endPlayerTurn, emptyCloudTable, type CloudRoom } from "./cloud.ts";
import type { BillFile } from "./table.ts";

test("invalid prices and quantities cannot poison coin balances", async () => {
  assert.equal(parsePrice("-10 gp"), null);
  assert.equal(spendCoins({ ...emptyCoins(), gp: 10 }, NaN), null);
  assert.equal(spendCoins({ ...emptyCoins(), gp: 10 }, Infinity), null);
  assert.equal(spendCoins({ ...emptyCoins(), gp: 10 }, 1.5), null);
  assert.equal(spendCoins({ ...emptyCoins(), gp: -1 }, 0), null);
  await assert.rejects(buyFromShop({stockId:"missing",purseId:"missing",quantity:NaN}), /valid quantity/);
  await assert.rejects(buyListing({listingId:"missing",purseId:"missing",quantity:Infinity}), /valid quantity/);
});

test("shop and market purchases commit coins, inventory, stock, and ledger", async () => {
  await ensureEconomy();
  const purse = (await listPurses()).find((item) => item.kind === "character")!;
  const stock = (await listStock()).find((item) => item.quantity !== null && item.copper === 2)!;
  purse.coins = { ...emptyCoins(), gp: 10 };
  await savePurse(purse);
  const before = toCopper(purse.coins);
  await buyFromShop({ stockId:stock.id, purseId:purse.id, quantity:2 });
  assert.equal(toCopper((await listPurses()).find((item) => item.id === purse.id)!.coins), before - 4);
  assert.equal((await listStock()).find((item) => item.id === stock.id)!.quantity, stock.quantity! - 2);
  assert.ok((await listHoldings()).some((item) => item.purseId === purse.id && item.name === stock.name && item.quantity === 2));
  assert.ok((await listLedger()).some((line) => line.copper === -4));
  await saveListings([{id:"test-property",name:"Test property",kind:"property",copper:20,quantity:1,notes:""}]);
  await buyListing({listingId:"test-property",purseId:purse.id,quantity:1});
  assert.ok((await listHoldings()).some((item) => item.name === "Test property" && item.kind === "property"));
});

test("backup restoration preserves chat and handouts and removes unrelated leftovers", async () => {
  await postNotes([{from:"dm",to:"party",purseId:"",text:"Backup test"}]);
  await saveHandouts([{id:"handout",title:"Map",text:"The harbor"}]);
  const copy = await snapshot();
  await saveHandouts([{id:"other",title:"Other",text:"Wrong campaign"}]);
  await savePurse({id:"leftover",name:"Leftover",kind:"party",coins:emptyCoins()});
  await restore(copy);
  assert.ok((await loadNotes()).some((note) => note.text === "Backup test"));
  assert.equal((await loadHandouts())[0]?.id, "handout");
  assert.equal((await listPurses()).some((purse) => purse.id === "leftover"), false);
});

test("a decided loan cannot credit coins twice", async () => {
  const purse = (await listPurses()).find((item) => item.kind === "character")!;
  const before = toCopper(purse.coins);
  await askLoan({purseId:purse.id,copper:100,note:"Provisions"});
  const loan = (await loadLoans()).find((item) => item.status === "pending")!;
  await Promise.all([decideLoan(loan.id,"approved"), decideLoan(loan.id,"approved")]);
  assert.equal(toCopper((await listPurses()).find((item) => item.id === purse.id)!.coins),before+100);
});

test("NPCs cannot be claimed and player bills cannot forge DM messages or loan decisions", () => {
  const room: CloudRoom = { code:"ABCDE",revision:1,turn:1,live:false,seats:[{id:"dm",token:"dm",name:"DM",role:"dm",purseIds:[]},{id:"pc",token:"pc",name:"PC",role:"player",purseIds:["pc"]}],seen:{gifts:[],sales:[]},table:{...emptyCloudTable(),purses:[{id:"npc",name:"NPC",kind:"character",control:"npc",coins:emptyCoins()},{id:"pc",name:"PC",kind:"character",coins:emptyCoins()}]} };
  assert.throws(() => claimSeat(room,"npc","Player"),/not at this table/);
  const bill: BillFile = {kind:"quire-bill",version:1,exportedAt:1,openedAt:1,purseIds:["pc"],shopIds:[],purses:[],holdings:[],stock:[],ledger:[],notes:[{id:"fake",at:1,from:"dm",to:"party",purseId:"pc",text:"Forged"}],loans:[{id:"loan",at:1,purseId:"pc",purseName:"PC",copper:100,note:"Food",status:"approved"},{id:"other",at:1,purseId:"npc",purseName:"NPC",copper:100,note:"Food",status:"pending"}]};
  const next = endPlayerTurn(room,"pc",bill,1);
  assert.equal(next.table.notes.length,0);
  assert.equal(next.table.loans.length,1);
  assert.equal(next.table.loans[0]?.status,"pending");
  assert.throws(() => endPlayerTurn(room,"pc",bill,0),/changed the table/);
});

test("concurrent purchases cannot oversell the last item or lose a debit", async () => {
  const db = await quireDb();
  const purse = (await listPurses()).find((item) => item.kind === "character")!;
  const stock = (await listStock())[0]!;
  await new Promise<void>((resolve,reject) => { const tx=db.transaction("stock","readwrite"); tx.objectStore("stock").put({...stock,quantity:1});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error); });
  const results = await Promise.allSettled([buyFromShop({stockId:stock.id,purseId:purse.id,quantity:1}),buyFromShop({stockId:stock.id,purseId:purse.id,quantity:1})]);
  assert.equal(results.filter((result)=>result.status==="fulfilled").length,1);
  assert.equal((await listStock()).find((item)=>item.id===stock.id)?.quantity,0);
});

test("a corrupted backup is rejected before the existing campaign is cleared", async () => {
  const file=await snapshot(); const before=(await listPurses()).length;
  const corrupted={...file,purses:file.purses.map((p,index)=>index===0?{...p,coins:{...p.coins,gp:-1}}:p)};
  await assert.rejects(restore(corrupted),/invalid or missing data/);
  assert.equal((await listPurses()).length,before);
});

test("simultaneous market buyers cannot purchase the same unique property", async () => {
  const purse=(await listPurses()).find(p=>p.kind==="character")!;
  await saveListings([{id:"unique",name:"Unique property",kind:"property",copper:10,quantity:1,notes:""}]);
  const results=await Promise.allSettled([buyListing({listingId:"unique",purseId:purse.id,quantity:1}),buyListing({listingId:"unique",purseId:purse.id,quantity:1})]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
});
