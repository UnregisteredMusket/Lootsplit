import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { emptyCloudTable, readCloudTable } from "../src/lib/quire/cloud.ts";
import { snapshot } from "../src/lib/quire/economy.ts";

test("room state with an unreadable archive hydrates without altering stored archive bytes", async () => {
  const { localAccountDb }=await import("./account-dev-db.mjs");
  const { roomState }=await import("../src/lib/quire/cloud.server.ts");
  const { applyCloudTable }=await import("../src/lib/quire/economy.ts");
  const db=localAccountDb();
  const table=emptyCloudTable();
  table.journal={sessions:[],requests:[],events:[],reports:[
    {id:"good",name:"Good",at:1,snapshot:JSON.stringify(emptyCloudTable())},
    {id:"broken",name:"Broken",at:2,snapshot:"corrupted private raw history"},
  ]};
  const room={code:"REPORT",revision:1,live:true,turn:0,table,
    seats:[{id:"dm",token:"dm-token",name:"DM",role:"dm",purseIds:[]}],seen:{gifts:[],sales:[]}};
  try {
    await db.prepare("INSERT INTO campaign_rooms VALUES (?,1,?)").bind(room.code,JSON.stringify(room)).run();
    Object.assign(globalThis,{__env__:{DB:db}});
    const view=await roomState({code:room.code,token:"dm-token"});
    const readable=readCloudTable(view.table);
    assert.ok(readable);
    await applyCloudTable(readable);
    const hydrated=await snapshot();
    assert.equal(hydrated.journal.reports.length,2);
    assert.match(hydrated.journal.reports[1].error,/cannot be read/);
    const stored=JSON.parse((await db.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind(room.code).first()).body);
    assert.equal(stored.table.journal.reports[1].snapshot,"corrupted private raw history");
  } finally {delete globalThis.__env__;db.close();}
});

test("damaged stored archives do not block shared messages, money, journal edits or session closure", async () => {
  const {localAccountDb}=await import("./account-dev-db.mjs");
  const {submitCommands,roomState,closeRoom,openRoom}=await import("../src/lib/quire/cloud.server.ts");
  const {readCloudTableForImport}=await import("../src/lib/quire/cloud.ts");
  const db=localAccountDb();
  const table=emptyCloudTable();
  table.purses=[{id:"one",name:"One",kind:"party",coins:{cp:500,sp:0,ep:0,gp:0,pp:0}},
    {id:"two",name:"Two",kind:"party",coins:{cp:0,sp:0,ep:0,gp:0,pp:0}}];
  table.journal={sessions:[{id:"session",name:"Existing session",startedAt:1}],requests:[],events:[],reports:[
    {id:"broken",name:"Broken",at:2,snapshot:"corrupted private raw history"},
  ]};
  const room={code:"BROKEN",revision:1,live:true,turn:0,table,
    seats:[{id:"dm",token:"dm-token",name:"DM",role:"dm",purseIds:[]}],seen:{gifts:[],sales:[]}};
  const read=async()=>JSON.parse((await db.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind(room.code).first()).body);
  const send=commands=>submitCommands({code:room.code,token:"dm-token",batchId:crypto.randomUUID(),commands});
  try {
    await db.prepare("INSERT INTO campaign_rooms VALUES (?,1,?)").bind(room.code,JSON.stringify(room)).run();
    Object.assign(globalThis,{__env__:{DB:db}});
    assert.equal(readCloudTableForImport(table),null,"An untrusted new room cannot import damaged archive data");
    await assert.rejects(openRoom({name:"Import",table}));
    await send([{id:"message",kind:"message",to:"party",purseId:"",text:"Still playing"}]);
    await send([{id:"transfer",kind:"give",fromId:"one",toId:"two",copper:100,holdingId:null,quantity:0}]);
    let current=await read();
    assert.equal(current.table.purses[0].coins.cp,400);
    assert.equal(current.table.purses[1].coins.gp,1);
    assert.equal(current.table.notes[0].text,"Still playing");
    const view=await roomState({code:room.code,token:"dm-token"});
    assert.ok(readCloudTable(view.table),"Projected diagnostics must remain usable at runtime");
    assert.equal(readCloudTableForImport(view.table),null,"A projected diagnostic cannot replace complete history in a new room");
    await assert.rejects(openRoom({name:"Projected import",table:view.table}),/invalid saved data/);
    const before=view.table.journal,after=structuredClone(before);
    after.downtimePrompt={enabled:true,days:3};
    await send([{id:"journal",kind:"patch",changes:[{store:"journal",id:"journal",before,after}]}]);
    current=await read();
    assert.equal(current.table.journal.reports[0].snapshot,"corrupted private raw history");
    assert.equal(current.table.journal.reports[0].error,undefined,"Projected placeholders must not overwrite original records");
    assert.equal(current.table.journal.downtimePrompt.days,3);
    const changed=await roomState({code:room.code,token:"dm-token"});
    const invalid=structuredClone(changed.table.journal);
    invalid.reports.push({id:"injected",name:"Invalid new report",at:3,snapshot:"new invalid archive"});
    await assert.rejects(send([{id:"invalid",kind:"patch",changes:[{store:"journal",id:"journal",before:changed.table.journal,after:invalid}]}]));
    assert.equal((await read()).table.journal.reports.length,1);
    const placeholder=structuredClone(changed.table.journal);
    placeholder.reports.push({...view.table.journal.reports[0],id:"injected-placeholder"});
    await assert.rejects(send([{id:"placeholder",kind:"patch",changes:[{store:"journal",id:"journal",before:changed.table.journal,after:placeholder}]}]),/diagnostic placeholder/);
    assert.equal((await read()).table.journal.reports.length,1);
    await closeRoom({code:room.code,token:"dm-token",keepOnline:true});
    current=await read();
    assert.equal(current.viewOnly,true);
    assert.equal(current.table.journal.reports[0].snapshot,"corrupted private raw history");
    assert.equal(current.table.journal.reports.length,2);
    const archived=JSON.parse(current.table.journal.reports[1].snapshot);
    assert.equal(archived.notes[0].text,"Still playing");
    assert.equal(archived.ledger.length,2);
    assert.equal(current.table.notes.length,0);
  }finally{delete globalThis.__env__;db.close();}
});
