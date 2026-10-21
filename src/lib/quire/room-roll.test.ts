import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// Durable D1 path for server character rolls (audit 2026-10-21): rooms whose stored body differs
// from the hydrated room (map images, resource packs, never-written drafts) must still accept rolls.
const sql = new DatabaseSync(":memory:");
sql.exec("CREATE TABLE IF NOT EXISTS user(id TEXT PRIMARY KEY)");
for (const name of [
  "0001_campaign_rooms.sql",
  "0007_character_play.sql",
  "0012_campaign_room_images.sql",
  "0013_campaign_resource_documents.sql",
])
  sql.exec(readFileSync(new URL(`../../../cloudflare/migrations/${name}`, import.meta.url), "utf8"));
(globalThis as { __env__?: unknown }).__env__ = {
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
      let values: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          values = args;
          return this;
        },
        async all() {
          return {
            results: query.includes("FROM play_characters")
              ? []
              : sql.prepare(query).all(...(values as never[])),
          };
        },
        async first() {
          return sql.prepare(query).get(...(values as never[])) ?? null;
        },
        async run() {
          const r = sql.prepare(query).run(...(values as never[]));
          return { meta: { changes: Number(r.changes) } };
        },
      };
    },
  },
};
const { openRoom, joinRoom, characterRoll } = await import("./cloud.server.ts");
const { tradeFixture } = await import("./test-fixtures/trade-economy.ts");
const { readJournal } = await import("./journal.ts");

test("server rolls are recorded in rooms with map images and before any other write", async () => {
  const table = tradeFixture();
  (table.journal as { world?: unknown }).world = readJournal({
    world: {
      maps: [
        {
          id: "map",
          name: "Map",
          image: "data:image/png;base64," + "A".repeat(20000),
          locationId: null,
          visible: true,
          anchors: [],
          markers: [],
        },
      ],
    },
  }).world;
  const host = await openRoom({ name: "DM", table });
  const player = await joinRoom({ code: host.code, purseId: "a", name: "A" });
  const roll = await characterRoll({
    code: host.code,
    token: player.token,
    purseId: "a",
    requestKey: "roll-with-map-image-1",
    revision: 0,
    kind: "custom",
    formula: "1d20",
    label: "Check",
  });
  assert.ok(roll.total >= 1 && roll.total <= 20);
  const saved = sql.prepare("SELECT COUNT(*) AS n FROM play_rolls WHERE code=?").get(host.code) as {
    n: number;
  };
  assert.equal(saved.n, 1);
});
