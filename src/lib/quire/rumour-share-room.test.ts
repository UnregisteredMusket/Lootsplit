// Audit I2: in a shared room, a bought rumour's "Share in party chat" wrote only to the device's
// chat (a no-op pusher in rooms), said "Shared", and nobody received it. It now sends the
// authoritative `message` command, so a second seat receives it once per command ID.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { fromCopper } from "./money.ts";
import { rumourNote, shareRumour } from "./rumour-share.ts";
import type { CommandRequest } from "./commands.ts";


// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of ["0001_campaign_rooms.sql", "0024_campaign_room_receipts.sql", "0026_campaign_room_sections.sql", "0029_campaign_room_report_parts.sql", "0030_campaign_room_archive_keys.sql", "0003_accounts.sql", "0008_encounters.sql"])
  sql.exec(readFileSync(new URL(`../../../cloudflare/migrations/${file}`, import.meta.url), "utf8"));
(globalThis as any).__env__ = {
  DB: {
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(query: string) {
      let values: any[] = [];
      return {
        bind(...args: any[]) {
          values = args;
          return this;
        },
        async all() {
          if (query.includes("FROM play_characters")) return { results: [] };
          return { results: sql.prepare(query).all(...values) };
        },
        async first() {
          return sql.prepare(query).get(...values) ?? null;
        },
        async run() {
          return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } };
        },
      };
    },
  },
};

function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "kael", name: "Kael", kind: "character", coins: fromCopper(1000) },
      { id: "bryn", name: "Bryn", kind: "character", coins: fromCopper(1000) },
    ],
    journal: readJournal({}),
  };
}

test("a shared room: Share in party chat reaches another seat once, and never only this device", async () => {
  const dm = await openRoom({ name: "Rumour DM", table: campaign() });
  const kael = await joinRoom({ code: dm.code, purseId: "kael", name: "Kael" });
  const bryn = await joinRoom({ code: dm.code, purseId: "bryn", name: "Bryn" });
  await choosePace({ ...dm, live: true });
  const kaelSeat = { code: dm.code, token: kael.token };
  let deviceNotes = 0;
  const send = {
    queueCommand: async (command: CommandRequest) => {
      await submitCommands({ ...kaelSeat, batchId: "share-" + command.id, commands: [command as never] });
      return { status: "committed" as const };
    },
    postNotes: async () => {
      deviceNotes++;
    },
  };
  const input = { joined: true, role: "player", purseId: "kael", npcName: "Old Gerta", text: "Lanterns burn in the old mill.", commandId: "rumour-1" };
  assert.deepEqual(await shareRumour(input, send), { status: "committed" });
  // A retry with the same command ID (a lost response) adds nothing.
  await shareRumour(input, send);
  assert.equal(deviceNotes, 0, "nothing written only to this device");
  const seen = (await roomState({ code: dm.code, token: bryn.token })).table.notes;
  const shared = seen.filter((n) => n.text === rumourNote("Old Gerta", "Lanterns burn in the old mill."));
  assert.equal(shared.length, 1);
  assert.deepEqual({ from: shared[0]!.from, to: shared[0]!.to, purseId: shared[0]!.purseId }, { from: "player", to: "party", purseId: "kael" });
  // Offline (not joined): the device's own chat, as before.
  await shareRumour({ ...input, joined: false, commandId: "rumour-2" }, send);
  assert.equal(deviceNotes, 1);
  // The chat's 500-character limit.
  assert.equal(rumourNote("N", "x".repeat(600)).length, 500);
});
