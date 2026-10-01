import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { listSaves, rememberSave } from "./saves.ts";
import type { QuireFile } from "./economy.ts";

test("pre-join backups persist independent copies without replacing earlier campaigns", async () => {
  const file: QuireFile = {
    kind: "quire",
    version: 2,
    exportedAt: 1,
    books: [],
    articles: [],
    purses: [],
    holdings: [],
    shops: [],
    stock: [],
    ledger: [],
  };
  const first = await rememberSave({ name: "Before joining room ABC12", campaignId: "main", file });
  file.exportedAt = 2;
  await rememberSave({ name: "Before joining room DEF34", campaignId: "main", file });
  await rememberSave({ name: "Other campaign", campaignId: "other", file });
  const saves = await listSaves("main");
  assert.equal(saves.length, 2);
  const original = saves.find((save) => save.id === first.id)?.file;
  assert.ok(original?.kind === "quire");
  assert.equal(original.exportedAt, 1);
  assert.equal((await listSaves("other")).length, 1);
});
