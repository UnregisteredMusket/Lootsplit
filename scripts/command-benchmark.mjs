// Reproducible synthetic benchmark: no production data, credentials or network.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { emptyCloudTable } from "../src/lib/quire/cloud.ts";
import { readJournal } from "../src/lib/quire/journal.ts";
import { emptyCoins } from "../src/lib/quire/money.ts";
import { applyCommand, applyCommandBatch } from "../src/lib/quire/commands.ts";
const table = { ...emptyCloudTable(), journal: readJournal({ world: { maps: Array.from({length:6},(_,i)=>({
  id:`map-${i}`,name:`Synthetic map ${i}`,image:"data:image/png;base64,"+"A".repeat(180000),
  locationId:null,visible:true,anchors:[],markers:[],
})) } }) };
table.purses = Array.from({length:40},(_,i)=>({id:`hero-${i}`,name:`Synthetic ${i}`,kind:"character",coins:emptyCoins()}));
const seat={id:"dm",token:"synthetic",name:"DM",role:"dm",purseIds:[]};
const commands=Array.from({length:20},(_,i)=>({id:`command-${i}`,kind:"portrait",purseId:`hero-${i}`,portrait:"/art/player.webp"}));
const previousClock=Date.now;Date.now=()=>1000;
const run={before:()=>commands.reduce((t,c)=>applyCommand(t,seat,c),table),after:()=>applyCommandBatch(table,seat,commands)};
assert.deepEqual(run.before(),run.after());
const results=[];
for(const [name,perform]of Object.entries(run)) {
  for(let i=0;i<3;i++)perform();
  const times=[];
  for(let i=0;i<20;i++){const start=performance.now();perform();times.push(performance.now()-start);}
  times.sort((a,b)=>a-b);
  results.push({name,iterations:20,meanMs:times.reduce((n,x)=>n+x,0)/20,medianMs:times[10],p95Ms:times[18]});
}
Date.now=previousClock;
mkdirSync("test-results/report-followup",{recursive:true});
const report={scope:"synthetic-command-batch/node22/warm/v1/40characters-6maps-20portraits",at:new Date().toISOString(),node:process.versions.node,results};
writeFileSync("test-results/report-followup/command-benchmark.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
