import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand, applyCommandBatch, type Command } from "./commands.ts";
import { emptyCloudTable } from "./cloud.ts";
import { fromCopper, toCopper } from "./money.ts";
const seat = { id: "dm", token: "synthetic", role: "dm" as const, name: "DM", purseIds: [] };
test("batch working copies preserve per-command balance validation and atomic failure without modifying their source", () => {
  const table = { ...emptyCloudTable(), purses: ["a", "b"].map(id => ({ id, name:id, kind:"character" as const, coins:fromCopper(id === "a" ? 100 : 0) })) };
  const give = (id:string,copper:number):Command => ({ id,kind:"give",fromId:"a",toId:"b",copper,holdingId:null,quantity:0 });
  const before=structuredClone(table);
  assert.throws(()=>applyCommandBatch(table,seat,[give("first",60),give("overspend",60)]));
  assert.deepEqual(table,before);
  const result=applyCommandBatch(table,seat,[give("first",60),give("second",40)]);
  assert.equal(toCopper(result.purses[0].coins),0);assert.equal(toCopper(result.purses[1].coins),100);
  assert.equal(result.ledger.length,4);assert.deepEqual(table,before);
  assert.equal(applyCommand(table,seat,give("single",50)).ledger.length,2);
});
