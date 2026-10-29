// Player token movement in shared rooms (map tokens PR 2): moves outside the room turn, the
// tracker turn read from the encounter store (fail closed), retried batches applied once, and an
// older client held to the same rules. Disposable in-memory D1; never a real campaign.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { canonicalJson } from "./canonical-json.ts";
import { readRoom, updateRoom } from "./room-store.server.ts";

const sql = new DatabaseSync(":memory:");
let beforeBatch: (() => void) | undefined;
for (const file of ["0001_campaign_rooms.sql", "0024_campaign_room_receipts.sql", "0026_campaign_room_sections.sql", "0029_campaign_room_report_parts.sql", "0003_accounts.sql", "0007_character_play.sql", "0008_encounters.sql"])
  sql.exec(readFileSync(new URL(`../../../cloudflare/migrations/${file}`, import.meta.url), "utf8"));
(globalThis as any).__env__ = {
  DB: {
    async batch(statements: { run: () => Promise<unknown> }[]) {
      // A racer: something that happens after the room was read and before it is written.
      const racer = beforeBatch;
      beforeBatch = undefined;
      racer?.();
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
// Encounter rows only need an owner id here; the account tables are not under test.
sql.exec("PRAGMA foreign_keys=OFF");

const grid = { columns: 10, rows: 10, feetPerTile: 5, diagonal: "equal" as const, x: 0, y: 0, width: 1, height: 1 };
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: ["mira", "torvald"].map((id) => ({ id, name: id, kind: "character" as const, coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } })),
    journal: readJournal({
      world: {
        maps: [
          {
            id: "keep",
            name: "Keep",
            image: "data:image/png;base64,YQ==",
            locationId: null,
            visible: true,
            anchors: [],
            markers: [],
            grid,
            tokens: [
              { id: "mira-token", kind: "character", entityId: "mira", label: "Mira", column: 1, row: 1, visibility: "party" },
              { id: "ogre", kind: "creature", label: "Ogre", encounterId: "fight", combatantId: "ogre", column: 6, row: 6, visibility: "party" },
            ],
          },
        ],
      },
    }),
  };
}
const moveCmd = (id: string, from: number, to: number) => ({
  id,
  kind: "map-token-move",
  mapId: "keep",
  grid: canonicalJson(grid),
  moves: [{ tokenId: "mira-token", before: { column: from, row: 1 }, after: { column: to, row: 1 } }],
  ignoreWalls: false,
});
const column = async (seat: { code: string; token: string }) =>
  (await roomState(seat)).table.journal!.world!.maps[0].tokens!.find((t) => t.id === "mira-token")!.column;

test("turn-based room: a player moves their own token outside the room turn; other actions still wait", async () => {
  const dm = await openRoom({ name: "Movement DM", table: campaign() });
  const player = await joinRoom({ code: dm.code, purseId: "mira", name: "Mira's player" });
  const seat = { code: dm.code, token: player.token };
  await submitCommands({ ...seat, tabletopProtocol: 15, batchId: "move-1", commands: [moveCmd("move-1", 1, 2)] });
  assert.equal(await column(seat), 2);
  // A retried batch (lost response) applies once.
  await submitCommands({ ...seat, tabletopProtocol: 15, batchId: "move-1", commands: [moveCmd("move-1", 1, 2)] });
  assert.equal(await column(seat), 2);
  // Anything else still needs the room turn.
  await assert.rejects(
    submitCommands({ ...seat, batchId: "note", commands: [{ id: "n1", kind: "map-tabletop", mapId: "keep", before: null, settings: {} }] }),
    /not your turn/,
  );
});

test("combat: the server reads the tracker turn and fails closed", async () => {
  const dm = await openRoom({ name: "Combat DM", table: campaign() });
  const player = await joinRoom({ code: dm.code, purseId: "mira", name: "Mira's player" });
  await choosePace({ ...dm, live: true });
  const seat = { code: dm.code, token: player.token };
  const binding = { id: "b", encounterId: "fight", encounterRevision: 0, mapId: "keep", returnMapId: "keep", returnCamera: { x: 0.5, y: 0.5, zoom: 1 }, mode: "theatre", phase: "active", scaleConfirmed: false, showPlayers: true };
  await submitCommands({ ...dm, batchId: "start", commands: [{ id: "start", kind: "map-combat-transition", before: null, binding, beforeSession: null }] });
  // No encounter row yet: the turn order can't be read, so the move is refused.
  await assert.rejects(submitCommands({ ...seat, batchId: "m0", commands: [moveCmd("m0", 1, 2)] }), /turn order is unavailable/);
  sql.prepare("INSERT INTO dm_encounters(id,user_id,code,body,status,revision,created_at,updated_at) VALUES (?,?,?,?,'active',1,1,1)").run("fight", "synthetic-owner", dm.code, JSON.stringify({ activeId: "ogre", round: 2 }));
  await assert.rejects(submitCommands({ ...seat, batchId: "m1", commands: [moveCmd("m1", 1, 2)] }), /Not your turn — Ogre is acting/);
  // An older client is held to the same rule.
  await assert.rejects(submitCommands({ ...seat, tabletopProtocol: 10, batchId: "m1-old", commands: [moveCmd("m1-old", 1, 2)] }), /Not your turn/);
  sql.prepare("UPDATE dm_encounters SET body=? WHERE id=?").run(JSON.stringify({ activeId: "mira", round: 2 }), "fight");
  await submitCommands({ ...seat, batchId: "m2", commands: [moveCmd("m2", 1, 3)] });
  assert.equal(await column(seat), 3);
  // The DM moves anything at any time.
  sql.prepare("UPDATE dm_encounters SET body=? WHERE id=?").run(JSON.stringify({ activeId: "ogre", round: 3 }), "fight");
  await submitCommands({ ...dm, batchId: "dm-move", commands: [moveCmd("dm-move", 3, 4)] });
  assert.equal(await column(seat), 4);
  // The encounter concluded: free movement again.
  sql.prepare("UPDATE dm_encounters SET status='concluded' WHERE id=?").run("fight");
  await submitCommands({ ...seat, batchId: "m3", commands: [moveCmd("m3", 4, 5)] });
  assert.equal(await column(seat), 5);
  // Combat ends on the map (the binding is cleared): free movement without a read.
  const room = (await readRoom(dm.code))!;
  delete room.table.journal!.world!.combat;
  await updateRoom({ ...room, revision: room.revision + 1 }, room.revision);
  sql.prepare("DELETE FROM dm_encounters WHERE id=?").run("fight");
  await submitCommands({ ...seat, batchId: "m4", commands: [moveCmd("m4", 5, 6)] });
  assert.equal(await column(seat), 6);
});

// Privacy review 2026-10-29 (finding A4b): the turn is read outside the room's revision check, so
// the room write also requires that turn; a turn that advances in between refuses the move.
test("combat: a turn that advances between the read and the write refuses the move", async () => {
  const dm = await openRoom({ name: "Race DM", table: campaign() });
  const player = await joinRoom({ code: dm.code, purseId: "mira", name: "Mira's player" });
  await choosePace({ ...dm, live: true });
  const seat = { code: dm.code, token: player.token };
  const binding = { id: "b", encounterId: "race", encounterRevision: 0, mapId: "keep", returnMapId: "keep", returnCamera: { x: 0.5, y: 0.5, zoom: 1 }, mode: "theatre", phase: "active", scaleConfirmed: false, showPlayers: true };
  await submitCommands({ ...dm, batchId: "start", commands: [{ id: "start", kind: "map-combat-transition", before: null, binding, beforeSession: null }] });
  sql.prepare("INSERT INTO dm_encounters(id,user_id,code,body,status,revision,created_at,updated_at) VALUES (?,?,?,?,'active',1,1,1)").run("race", "synthetic-owner", dm.code, JSON.stringify({ activeId: "mira", round: 1 }));
  // Mira's turn when the move is read; the DM advances to the Ogre before the room is written.
  beforeBatch = () => sql.prepare("UPDATE dm_encounters SET body=? WHERE id=?").run(JSON.stringify({ activeId: "ogre", round: 1 }), "race");
  await assert.rejects(submitCommands({ ...seat, batchId: "race-1", commands: [moveCmd("race-1", 1, 2)] }), /Not your turn/);
  assert.equal(await column(seat), 1);
  // Without a race the move on her turn lands.
  sql.prepare("UPDATE dm_encounters SET body=? WHERE id=?").run(JSON.stringify({ activeId: "mira", round: 2 }), "race");
  await submitCommands({ ...seat, batchId: "race-2", commands: [moveCmd("race-2", 1, 2)] });
  assert.equal(await column(seat), 2);
});
