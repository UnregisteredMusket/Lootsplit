// Fixed synthetic input; no network, account credentials or production data.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { emptyCloudTable } from "../src/lib/quire/cloud.ts";
import { readJournal } from "../src/lib/quire/journal.ts";
import { emptyCoins } from "../src/lib/quire/money.ts";
import { createRoom } from "../src/lib/quire/room-store.server.ts";
import * as service from "../src/lib/quire/cloud.server.ts";

const sql = new DatabaseSync(":memory:");
for (const f of readdirSync("cloudflare/migrations").filter(f => f.endsWith(".sql")).sort())
  sql.exec(readFileSync(`cloudflare/migrations/${f}`, "utf8"));
const db = {
  prepare(query) {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async all() { return { results: sql.prepare(query).all(...values) }; },
      async first() { return sql.prepare(query).get(...values) || null; },
      async run() { return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } }; },
    };
  },
  async batch(statements) {
    sql.exec("BEGIN");
    try { const result=[];for(const s of statements)result.push(await s.run());sql.exec("COMMIT");return result; }
    catch(e) { sql.exec("ROLLBACK");throw e; }
  },
};
globalThis.__env__ = { DB: db };
const maps = Array.from({length:6},(_,i)=>({
  id:`benchmark-map-${i}`,name:`Synthetic map ${i}`,
  image:"data:image/png;base64,"+String.fromCharCode(65+i).repeat(180000),
  locationId:null,visible:true,anchors:[],markers:[],
}));
const table = { ...emptyCloudTable(), journal:readJournal({ world:{maps} }) };
table.purses=Array.from({length:40},(_,i)=>({id:`hero-${i}`,name:`Synthetic hero ${i}`,kind:"character",coins:emptyCoins()}));
table.ledger=Array.from({length:2000},(_,i)=>({id:`ledger-${i}`,at:1000+i,purseId:`hero-${i%40}`,shopId:null,summary:"Synthetic bookkeeping entry",copper:0,transactionType:"payment"}));
const seat={id:"benchmark-seat",token:"synthetic-benchmark-only",role:"dm",name:"Benchmark DM",purseIds:[]};
await createRoom({code:"SYNTHETIC",revision:1,turn:0,live:true,seats:[seat],table,seen:{gifts:[],sales:[]}});
const auth={code:"SYNTHETIC",token:seat.token}, full=await service.roomState(auth);
const variants={ full:()=>service.roomState(auth) };
if(service.pollRoom) variants.unchanged=()=>service.pollRoom({...auth,knownRevision:full.revision,knownSeatId:seat.id});
const results=[];
for(const [name,read]of Object.entries(variants)) {
  for(let i=0;i<5;i++)JSON.stringify(await read());
  const times=[];let bytes=0;
  for(let i=0;i<30;i++) {
    const start=performance.now();const result=await read();const data=JSON.stringify(result);times.push(performance.now()-start);bytes=Buffer.byteLength(data);
    if(name==="unchanged")assert.equal(result.unchanged,true);
    else assert.equal(result.table.journal.world.maps.length,6);
  }
  times.sort((a,b)=>a-b);
  results.push({name,iterations:times.length,meanMs:times.reduce((a,b)=>a+b,0)/times.length,medianMs:times[15],p95Ms:times[28],responseBytes:bytes});
}
const output={scope:"synthetic-room-sync/node22/sqlite-memory/warm/v1/40characters-6maps-2000ledger",node:process.versions.node,at:new Date().toISOString(),results};
mkdirSync("test-results/report-followup",{recursive:true});
const label=process.env.BENCHMARK_LABEL||"current";
assert.match(label,/^[a-z0-9-]+$/);
writeFileSync(`test-results/report-followup/sync-${label}.json`,JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify(output,null,2));
sql.close();
