import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createRoom, readRoom, updateRoom, deleteRoom } from "./room-store.server.ts";
import { emptyCloudTable } from "./cloud.ts";
import { openRoom, joinRoom, roomState, previewRoom, submitCommands } from "./cloud.server.ts";
import { emptyCoins } from "./money.ts";
import { pushSettings, setPushSubscription, validPushEndpoint, pushAuthorization } from "./push.server.ts";
import { jwtVerify, importJWK } from "jose";
const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(new URL("../../../drizzle/0000_mysterious_lord_tyger.sql", import.meta.url),"utf8"));
sql.exec(readFileSync(new URL("../../../cloudflare/migrations/0002_web_push.sql", import.meta.url),"utf8"));
(globalThis as any).__env__ = { DB: { prepare(query:string) { let values: any[]=[]; return {bind(...args:any[]){values=args;return this;},async all(){return {results:sql.prepare(query).all(...values)};},async first(){return sql.prepare(query).get(...values)??null;},async run(){const r=sql.prepare(query).run(...values);return {meta:{changes:Number(r.changes)}};}}; } } };
test("durable shared rooms reject stale writes and survive independent reads",async()=>{
 const room={code:"CAS01",revision:1,turn:0,live:false,seats:[],table:emptyCloudTable(),seen:{gifts:[],sales:[]}};
 await createRoom(room); assert.equal((await readRoom("CAS01"))?.revision,1);
 await updateRoom({...room,revision:2},1);
 await assert.rejects(updateRoom({...room,revision:2},1),/table changed/);
 await assert.rejects(deleteRoom(room.code,1),/table changed/);
 await deleteRoom(room.code,2);assert.equal(await readRoom(room.code),null);
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
test("player responses exclude other private messages, loans, and NPC join choices",async()=>{
 const table={...emptyCloudTable(),purses:[{id:"pc",name:"PC",kind:"character" as const,coins:emptyCoins()},{id:"npc",name:"NPC",kind:"character" as const,control:"npc" as const,coins:emptyCoins()}],notes:[{id:"public",at:1,from:"dm" as const,to:"party" as const,purseId:"",text:"Party note"},{id:"private",at:1,from:"dm" as const,to:"dm" as const,purseId:"npc",text:"Secret"}]};
 const opened=await openRoom({name:"DM",table});
 assert.deepEqual((await previewRoom(opened.code)).characters.map(p=>p.id),["pc"]);
 const joined=await joinRoom({code:opened.code,purseId:"pc",name:"PC"});
 const view=await roomState({code:opened.code,token:joined.token});
 assert.deepEqual(view.table.notes.map(n=>n.id),["public"]);
 await assert.rejects(roomState({code:opened.code,token:"invalid"}),/not seated/);
});

test("private chat is isolated, idempotent, and independent of turns", async () => {
  const opened=await openRoom({name:"DM",table:{...emptyCloudTable(),purses:["a","b","c"].map(id=>({id,name:id,kind:"character",coins:emptyCoins()}))}});
  const a=await joinRoom({code:opened.code,purseId:"a",name:"A"});
  const b=await joinRoom({code:opened.code,purseId:"b",name:"B"});
  const c=await joinRoom({code:opened.code,purseId:"c",name:"C"});
  const message={kind:"message",id:"private-chat",to:"player",purseId:"a",recipientId:"b",text:"Only A and B"};
  const result=await submitCommands({code:opened.code,token:a.token,batchId:"first",commands:[message]});
  assert.equal(result.turn,0);
  assert.equal(result.table.notes.length,1);
  await submitCommands({code:opened.code,token:a.token,batchId:"retry",commands:[message]});
  assert.equal((await roomState({code:opened.code,token:b.token})).table.notes.length,1);
  assert.equal((await roomState({code:opened.code,token:c.token})).table.notes.length,0);
  assert.equal((await roomState({code:opened.code,token:opened.token})).table.notes.length,0);
  await assert.rejects(submitCommands({code:opened.code,token:c.token,batchId:"forge",commands:[{...message,id:"forged"}]}),/permission/);
  await assert.rejects(submitCommands({code:opened.code,token:a.token,batchId:"bad-target",commands:[{...message,id:"bad",recipientId:"missing"}]}),/another player/);
});

test("push subscriptions require membership and preserve stable signing keys", async () => {
  const opened=await openRoom({name:"DM",table:{...emptyCloudTable(),purses:[{id:"push-player",name:"Player",kind:"character",coins:emptyCoins()}]}});
  const player=await joinRoom({code:opened.code,purseId:"push-player",name:"Player"});
  const endpoint="https://fcm.googleapis.com/fcm/send/test-subscription";
  const config=await pushSettings(opened);
  assert.equal(config.publicKey,(await pushSettings(opened)).publicKey);
  assert.equal("privateKey" in config,false);
  await assert.rejects(setPushSubscription({...opened,token:"invalid",endpoint,enabled:true}),/Join a room/);
  await assert.rejects(setPushSubscription({...opened,endpoint:"https://localhost/private",enabled:true}),/not supported/);
  await setPushSubscription({...player,code:opened.code,endpoint,enabled:true});
  assert.equal((await pushSettings({...player,code:opened.code,endpoint})).subscribed,true);
  assert.equal((await pushSettings({...opened,endpoint})).subscribed,false);
  const row=sql.prepare("SELECT body FROM push_config WHERE id='vapid'").get() as {body:string};
  const keys=JSON.parse(row.body);
  const header=await pushAuthorization(endpoint,keys);
  const jwt=header.slice("vapid t=".length).split(", k=")[0]!;
  const jwk={...keys.privateKey};delete jwk.d;jwk.key_ops=["verify"];
  const verified=await jwtVerify(jwt,await importJWK(jwk,"ES256"),{audience:"https://fcm.googleapis.com"});
  assert.equal(verified.payload.sub,"https://lootsplit.oliverstorie2017.workers.dev");
  const originalFetch=globalThis.fetch;let sends=0;
  globalThis.fetch=async (url,init)=>{sends++;assert.equal(url,endpoint);assert.equal(init?.body,undefined);assert.equal(init?.redirect,"error");return new Response(null,{status:201});};
  try {
    const cmd={kind:"message",id:"push-note",to:"party",purseId:"",text:"Do not expose this text"};
    await submitCommands({...opened,batchId:"push-send",commands:[cmd]});
    await submitCommands({...opened,batchId:"push-retry",commands:[cmd]});
    assert.equal(sends,1);
  } finally {globalThis.fetch=originalFetch;}
  await setPushSubscription({...player,code:opened.code,endpoint,enabled:false});
  assert.equal((await pushSettings({...player,code:opened.code,endpoint})).subscribed,false);
  assert.equal(validPushEndpoint("https://fcm.googleapis.com.evil.example/test"),false);
  assert.equal(validPushEndpoint("https://user@fcm.googleapis.com/test"),false);
});

test("lost acknowledgement can retry after an independent room read without double spending", async () => {
  const table = { ...emptyCloudTable(), purses: [{ id: "recover", name: "Recover", kind: "character" as const, coins: { ...emptyCoins(), gp: 5 } }], shops: [{ id: "recovery-shop", name: "Shop", keeper: "", place: "", notes: "", sellRate: 1, buyRate: .5, wealth: "modest" as const, category: "general" as const, priceScale: 1 }], stock: [{ id: "recovery-item", shopId: "recovery-shop", name: "Item", copper: 10, quantity: 3, notes: "", baseCopper: 10, rarity: "common" as const }] };
  const opened = await openRoom({ name: "Recovery test", table });
  const { choosePace } = await import("./cloud.server.ts");
  await choosePace({ ...opened, live: true });
  const player = await joinRoom({ code: opened.code, purseId: "recover", name: "Player" });
  const savedRequest = JSON.stringify({ code: opened.code, token: player.token, batchId: "persisted-batch", commands: [{ id: "persisted-buy", kind: "buy", purseId: "recover", stockId: "recovery-item", quantity: 1 }] });
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
  const table = { ...emptyCloudTable(), purses: [{ id: "pc", name: "PC", kind: "character" as const, coins: emptyCoins() }], journal: { sessions: [], requests: [], events: [{ id: "price", at: 1, kind: "prices" as const, summary: "Price changed", change: { entity: "stock" as const, before: { copper: 10 }, after: { copper: 20 } } }] } };
  const dm = await openRoom({ name: "DM", table });
  const pc = await joinRoom({ code: dm.code, purseId: "pc", name: "PC" });
  assert.equal((await roomState({ code: dm.code, token: pc.token })).table.journal?.events[0]?.change, undefined);
  assert.equal((await roomState(dm)).table.journal?.events[0]?.change?.after?.copper, 20);
});
