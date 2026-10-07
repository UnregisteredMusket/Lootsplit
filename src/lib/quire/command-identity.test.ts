import test from "node:test";
import assert from "node:assert/strict";
import { commandSchema, applyCommand, same } from "./commands.ts";
import { commandIdentity, sameCommand } from "./command-identity.ts";
import { emptyCloudTable } from "./cloud.ts";
import { fromCopper } from "./money.ts";

test("id-last client portrait equals the real id-first Zod server echo", () => {
  const client = { kind: "portrait", purseId: "hero", portrait: "data:image/png;base64,QUFB", id: "photo" };
  const echoed = commandSchema.parse(client);
  assert.notDeepEqual(Object.keys(client), Object.keys(echoed), "Exercise the actual protocol key-order boundary");
  assert.equal(sameCommand(client, echoed), true);
  assert.equal(sameCommand(client, { ...client, portrait: "data:image/png;base64,QkJC" }), false);
});
test("semantic comparison preserves real schema normalization without weakening content differences", () => {
  const client = { kind: "journal-note", title: "  Note title  ", text: "Exact note text", visibility: "party", purseId: "", id: "note", ignored: "stripped" };
  const echoed = commandSchema.parse(client);
  assert.deepEqual(echoed.kind === "journal-note" ? echoed.reportIds : null, []);
  assert.equal(sameCommand(client, echoed), true);
  assert.equal(sameCommand(client, { ...echoed, text: "Changed note text" }), false);
});
test("nested patch keys are canonical while ordered array changes remain conflicts", () => {
  const a = { id: "patch", kind: "patch", changes: [{ store: "purses", id: "hero", before: { id: "hero", coins: { gp: 1, cp: 2 }, tags: ["a", "b"] }, after: null }] };
  const b = { kind: "patch", changes: [{ after: null, before: { tags: ["a", "b"], coins: { cp: 2, gp: 1 }, id: "hero" }, id: "hero", store: "purses" }], id: "patch" };
  assert.equal(commandIdentity(a), commandIdentity(b));
  assert.equal(sameCommand(a, { ...b, changes: [{ ...b.changes[0], before: { ...b.changes[0]!.before, tags: ["b", "a"] } }] }), false);
  assert.equal(same(null, {}), false);
});
test("DM patch applies equivalent reordered authoritative rows and still rejects real stale values", () => {
  const current = { id: "hero", name: "Hero", kind: "character" as const, coins: fromCopper(1000), sheetRevision: 0 };
  const before = { sheetRevision: 0, coins: { ...Object.fromEntries(Object.entries(current.coins).reverse()) }, kind: "character", name: "Hero", id: "hero" };
  const after = { ...before, name: "Renamed Hero" };
  const table = { ...emptyCloudTable(), purses: [current] };
  const dm = { id: "dm", name: "DM", token: "dm", role: "dm" as const, purseIds: [] };
  const command = commandSchema.parse({ id: "rename", kind: "patch", changes: [{ store: "purses", id: "hero", before, after }] });
  assert.equal(applyCommand(table, dm, command).purses[0]?.name, "Renamed Hero");
  assert.throws(() => applyCommand({ ...table, purses: [{ ...current, name: "Newer edit" }] }, dm, command), /Conflict/);
});
