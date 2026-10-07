import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { blankPurse, readQuireFile, restore, snapshot } from "./economy.ts";
import { quireDb, request } from "./db.ts";
import { readJournal, readArchivedSnapshot } from "./journal.ts";
import { emptyCloudTable, readCloudTable } from "./cloud.ts";
import { projectRecord } from "./session-records.ts";
import { toggleHandout, loadHandouts } from "./handouts.ts";
import type { QuireFile } from "./economy.ts";

const copy = (): QuireFile => ({ kind: "quire", version: 2, exportedAt: 1,
  books: [], articles: [], purses: [{ ...blankPurse("character"), id: "original", coins: {cp:0,sp:0,ep:0,gp:73,pp:0} }],
  holdings: [], shops: [], stock: [], ledger: [] });
const unchanged = async () => assert.equal((await snapshot()).purses[0]?.coins.gp, 73);

for (const field of ["books", "articles", "catalog", "lexicon"] as const)
  test(`malformed ${field} cannot clear a campaign during rejected restore`, async () => {
    await restore(copy());
    await assert.rejects(restore({ ...copy(), purses: [], [field]: [{}] } as QuireFile), /invalid or missing data/);
    await unchanged();
  });

test("a synchronous write failure aborts already queued replacement writes", async () => {
  await restore(copy());
  const db = await quireDb();
  const prototype = Object.getPrototypeOf(db.transaction("meta").objectStore("meta"));
  const put = prototype.put;
  prototype.put = function(value: { id?: string }, ...args: unknown[]) {
    if (value.id === "seeded") throw new DOMException("Synthetic write interruption", "DataError");
    return put.call(this, value, ...args);
  };
  try { await assert.rejects(restore({ ...copy(), purses: [] }), /Synthetic write interruption/); }
  finally { prototype.put = put; }
  await unchanged();
});

test("restore rejects invalid archived snapshots before replacing any data", async () => {
  await restore(copy());
  for (const snapshot of ["not JSON", "{}", JSON.stringify({ ...emptyCloudTable(), purses: [{}] }),
    JSON.stringify({ ...emptyCloudTable(), notes: [null] })]) {
    await assert.rejects(restore({ ...copy(), purses: [], journal: { sessions: [], events: [], requests: [],
      reports: [{ id:"broken", name:"Broken", at:1, snapshot }] } }), /invalid campaign snapshot/);
    await unchanged();
  }
  const nested = { ...emptyCloudTable(), journal: { reports: [
    {id:"nested",name:"Nested",at:1,snapshot:"invalid nested JSON"} ] } };
  assert.throws(() => readArchivedSnapshot(JSON.stringify(nested)));

});

test("unreadable archives are individually diagnosed without leaking raw contents", () => {
  const t = emptyCloudTable();
  t.journal = { sessions:[], requests:[], events:[], reports:[
    { id:"good", name:"Good", at:1, snapshot:JSON.stringify(emptyCloudTable()) },
    { id:"bad", name:"Bad", at:2, snapshot:"private secret invalid JSON" },
  ] };
  const projected = projectRecord(t, { id:"dm", role:"dm", purseIds:[] });
  assert.equal(projected.journal!.reports!.length,2);
  assert.ok(projected.journal!.reports![0]!.snapshot);
  assert.match(projected.journal!.reports![1]!.error!, /cannot be read/);
  assert.deepEqual(JSON.parse(projected.journal!.reports![1]!.snapshot), emptyCloudTable());
  assert.ok(readCloudTable(projected), "Projected error records must remain hydratable");
  assert.equal(t.journal.reports![1]!.snapshot,"private secret invalid JSON");
});

test("projected diagnostics cannot become complete archives through backups or nesting", async () => {
  await restore(copy());
  const table=emptyCloudTable();
  table.journal={sessions:[],requests:[],events:[],reports:[
    {id:"broken",name:"Broken",at:1,snapshot:"original unreadable history"},
  ]};
  const projected=projectRecord(table,{id:"dm",role:"dm",purseIds:[]});
  for (const error of [projected.journal!.reports![0]!.error!, ""]) {
    const journal={...projected.journal!,reports:[{...projected.journal!.reports![0]!,error}]};
    assert.ok(readJournal(journal),"Runtime diagnostics remain hydratable");
    await assert.rejects(restore({...copy(),purses:[],journal}),/diagnostic placeholder/);
    await unchanged();
    assert.throws(()=>readArchivedSnapshot(JSON.stringify({...emptyCloudTable(),journal})),/diagnostic placeholder/);
  }
  assert.equal(table.journal.reports![0]!.snapshot,"original unreadable history");
});

test("live backup assets reject missing references but retain deleted-account history", async () => {
  const base = copy();
  assert.throws(() => readQuireFile({ ...base, holdings:[{id:"h",purseId:"missing",name:"Rope",kind:"item",quantity:1,unitCopper:1,notes:""}] }), /holding owner/);
  assert.throws(() => readQuireFile({ ...base, stock:[{id:"s",shopId:"missing",name:"Rope",copper:1,quantity:1,notes:""}] }), /stock shop/);
  assert.throws(() => readQuireFile({ ...base, articles:[{id:"a",bookId:"missing",title:"A",text:"Text",pageStart:1,pageEnd:1,favorite:false}] }), /article book/);
  const ledger = [{id:"old",purseId:"removed",shopId:"removed",summary:"History",copper:1,at:1}];
  const loans = [{id:"old-loan",purseId:"removed",purseName:"Removed",copper:1,note:"History",at:1,status:"pending" as const}];
  const file = readQuireFile({ ...base, ledger, loans });
  assert.match(file.recoveryDiagnostics![0]!, /removed account/);
  await restore(file);
  assert.deepEqual((await snapshot()).ledger, ledger);
  assert.deepEqual((await snapshot()).loans, loans);
});

test("supplemental recovery history and older version-one backups survive round trips", async () => {
  const campaignRecovery={version:1,characterRolls:[{total:19}],imports:[{id:"private-history"}]};
  await restore({...copy(),version:1,campaignRecovery});
  const exported=await snapshot();
  assert.deepEqual(exported.campaignRecovery,campaignRecovery);
  readJournal(exported.journal);
});

test("handout sharing and backup round trips retain all content at the old boundary", async () => {
  for (const size of [7999,8000,8001,8525]) {
    const text="x".repeat(size)+"TAIL INSTRUCTION";
    const file={...copy(),books:[{id:"book",title:"Book",fileName:"book.pdf",pageCount:1,articleCount:1,importedAt:1}],
      articles:[{id:"a",bookId:"book",title:"Long handout",text,pageStart:1,pageEnd:1,favorite:false}]};
    await restore(file);
    assert.equal(await toggleHandout("a"),true);
    assert.equal((await loadHandouts())[0]!.text,text);
    const exported=await snapshot();
    await restore(exported);
    assert.equal((await loadHandouts())[0]!.text,text);
    const db=await quireDb();
    assert.equal((await request<{handouts:{text:string}[]}>(db.transaction("meta").objectStore("meta").get("handouts"))).handouts[0]!.text,text);
  }
});

test("existing damaged device archives retain raw bytes through views, payments and session transitions", async () => {
  const { economySnapshot, postCopper, executeFinanceCommand }=await import("./economy.ts");
  const { loadJournal }=await import("./journal.ts");
  await restore(copy());
  const db=await quireDb();
  const tx=db.transaction("meta","readwrite");
  tx.objectStore("meta").put({id:"journal",value:{sessions:[{id:"live",name:"Existing",startedAt:1}],requests:[],events:[],
    reports:[{id:"old",name:"Unreadable old report",at:1,snapshot:"unchanged original damaged bytes"}]}});
  await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
  assert.equal((await loadJournal()).reports![0]!.snapshot,"unchanged original damaged bytes");
  assert.equal((await economySnapshot()).journal!.reports![0]!.snapshot,"unchanged original damaged bytes");
  await postCopper("original",100,"Actual payment");
  await executeFinanceCommand({kind:"session",end:true,name:"Existing"});
  const after=await snapshot();
  assert.equal(after.purses[0]!.coins.gp,74);
  assert.equal(after.journal!.reports![0]!.snapshot,"unchanged original damaged bytes");
  assert.equal(after.journal!.reports!.length,2);
  assert.equal(JSON.parse(after.journal!.reports![1]!.snapshot).ledger.length,1);
  assert.throws(()=>readQuireFile(after),/invalid campaign snapshot/,"New imports still validate every raw archived snapshot");
});
