import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createRoom, readRoom, updateRoom, deleteRoom } from "./room-store.server.ts";
import { emptyCloudTable } from "./cloud.ts";
import { openRoom, joinRoom, roomState, previewRoom } from "./cloud.server.ts";
import { emptyCoins } from "./money.ts";
const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(new URL("../../../drizzle/0000_mysterious_lord_tyger.sql", import.meta.url),"utf8"));
(globalThis as any).__env__ = { DB: { prepare(query:string) { let values: any[]=[]; return {bind(...args:any[]){values=args;return this;},async first(){return sql.prepare(query).get(...values)??null;},async run(){const r=sql.prepare(query).run(...values);return {meta:{changes:Number(r.changes)}};}}; } } };
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
