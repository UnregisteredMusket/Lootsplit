import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { applyCommand, commandSchema } from "./commands.ts";
import { emptyCloudTable, readCloudTable, readCloudTableForImport } from "./cloud.ts";
import {
  readJournal,
  readValidatedJournal,
  readArchivedSnapshot,
  preserveJournalMetadata,
} from "./journal.ts";
import { projectRecord, archiveSession } from "./session-records.ts";
import { readQuireFile, restore, snapshot } from "./economy.ts";
const dm = { id: "dm", name: "DM", role: "dm" as const, token: "dm", purseIds: [] };
const provenance = {
  kind: "encounter-loot" as const,
  encounterId: "encounter-1",
  receiptId: "receipt-1",
  sessionId: "session-1",
};
const base = () => ({
  ...emptyCloudTable(),
  journal: readJournal({ sessions: [{ id: "session-1", name: "First", startedAt: 1 }] }),
});
const note = (id: string) =>
  commandSchema.parse({
    id,
    kind: "journal-note",
    title: "Loot awarded",
    text: "3 item units awarded. Receipt receipt-1.",
    visibility: "party",
    purseId: "",
    reportIds: [],
    provenance,
  });

test("two submissions and replay create one receipt-linked journal entry without moving assets", () => {
  const first = applyCommand(base(), dm, note("click-1"));
  const repeated = applyCommand(first, dm, note("click-2"));
  assert.equal(repeated.journal!.entries!.length, 1);
  assert.equal(repeated.journal!.entries![0].id, "encounter-loot:receipt-1");
  assert.deepEqual(repeated.ledger, []);
  assert.deepEqual(repeated.holdings, []);
  assert.deepEqual(repeated.journal!.entries![0].provenance, provenance);
  assert.throws(
    () =>
      applyCommand(
        first,
        dm,
        commandSchema.parse({
          ...note("other"),
          provenance: { ...provenance, encounterId: "other" },
        }),
      ),
    /another encounter/,
  );
});

test("loot provenance requires DM, party visibility, no private attachments and an existing selected session", () => {
  const player = { ...dm, role: "player" as const };
  assert.throws(
    () => applyCommand(base(), player, note("player")),
    /DM|Dungeon|control|character/i,
  );
  for (const patch of [
    { visibility: "dm" },
    { purseId: "private" },
    { provenance: { ...provenance, sessionId: "missing" } },
  ])
    assert.throws(
      () => applyCommand(base(), dm, commandSchema.parse({ ...note("bad"), ...patch })),
      /party|existing campaign session/,
    );
  assert.equal(
    commandSchema.safeParse({
      ...note("unknown"),
      provenance: { ...provenance, recipientNames: ["private"] },
    }).success,
    false,
  );
  const ordinary = commandSchema.parse({
    id: "old-client",
    kind: "journal-note",
    title: "Old note",
    text: "Original",
    visibility: "party",
    purseId: "",
  });
  assert.equal(applyCommand(base(), dm, ordinary).journal!.entries![0].provenance, undefined);
});

test("older client patches cannot erase or replace a confirmed entry's provenance", () => {
  const journal = applyCommand(base(), dm, note("first")).journal!;
  const old = structuredClone(journal);
  delete old.entries![0].provenance;
  assert.deepEqual(preserveJournalMetadata(old, journal).entries![0].provenance, provenance);
  const changed = structuredClone(journal);
  changed.entries![0].provenance = { ...provenance, receiptId: "forged" };
  assert.deepEqual(preserveJournalMetadata(changed, journal).entries![0].provenance, provenance);
});

test("recognized provenance survives validation, archival, player projection and backup restore/export", async () => {
  const table = applyCommand(base(), dm, note("first"));
  assert.deepEqual(readValidatedJournal(table.journal).entries![0].provenance, provenance);
  assert.deepEqual(readCloudTableForImport(table)!.journal!.entries![0].provenance, provenance);
  assert.deepEqual(readCloudTable(table)!.journal!.entries![0].provenance, provenance);
  const record = archiveSession(table, "archive", "First", 3);
  assert.deepEqual(
    readArchivedSnapshot(record.snapshot).journal!.entries![0].provenance,
    provenance,
  );
  const player = projectRecord(table, { role: "player", purseIds: [], id: "guest" });
  assert.deepEqual(player.journal!.entries![0].provenance, provenance);
  assert.equal(JSON.stringify(player).includes("recipientNames"), false);
  const file = readQuireFile({
    kind: "quire",
    version: 2,
    exportedAt: 4,
    books: [],
    articles: [],
    ...table,
  });
  await restore(file);
  const exported = await snapshot();
  assert.deepEqual(exported.journal!.entries![0].provenance, provenance);
  assert.deepEqual(
    readArchivedSnapshot(exported.journal!.reports![0].snapshot).journal!.entries![0].provenance,
    provenance,
  );
  const legacy = readQuireFile({
    kind: "quire",
    version: 1,
    exportedAt: 1,
    books: [],
    articles: [],
    ...emptyCloudTable(),
  });
  assert.equal(legacy.version, 1);
});
