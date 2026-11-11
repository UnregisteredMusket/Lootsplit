// Audit A7 and old apps: Android 1.19 and older (protocol 31) quote smith commissions with
// floating-point rounding (90 cp × 1.1 = 100 cp). The room accepts an order reviewed at that price
// and charges exactly what the player saw; a current app is quoted and charged the exact price.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { smithFixture, smithDesign } from "./test-fixtures/blacksmith.ts";
import { smithQuote } from "./blacksmith.ts";
import { projectRecord } from "./session-records.ts";
import { toCopper } from "./money.ts";
import { CURRENT_TABLETOP_PROTOCOL, QUEST_RENOWN_PROTOCOL } from "./tabletop-protocol.ts";
import type { CloudTable } from "./cloud.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of [
  "0001_campaign_rooms.sql", "0024_campaign_room_receipts.sql", "0026_campaign_room_sections.sql",
  "0003_accounts.sql", "0007_character_play.sql", "0008_encounters.sql", "0012_campaign_room_images.sql",
  "0013_campaign_resource_documents.sql", "0019_campaign_room_reports.sql", "0029_campaign_room_report_parts.sql",
  "0030_campaign_room_archive_keys.sql", "0032_campaign_room_receipt_ids.sql",
])
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

function forge(): CloudTable {
  const t = smithFixture();
  const d = smithDesign(t);
  d.engraving = "";
  const p = t.journal!.blacksmith!.profiles[0];
  // Labour comes to 90 cp, × 1.1: exactly 99 cp, 100 cp with floating-point rounding.
  p.priceMultiplier = 0;
  const free = smithQuote(t, "forge", "hero", d).terms.costCopper;
  p.priceMultiplier = 1;
  p.items[0].laborCopper -= smithQuote(t, "forge", "hero", d).terms.costCopper - free - 90;
  p.priceMultiplier = 1.1;
  return t;
}

test("a protocol 31 app's smith order at the old rounded price is accepted and charged as shown", async () => {
  const t = forge();
  const d = smithDesign(t);
  d.engraving = "";
  const dm = await openRoom({ name: "Forge DM", table: t });
  const hero = await joinRoom({ code: dm.code, purseId: "hero", name: "Hero" });
  await choosePace({ ...dm, live: true });
  const seen = projectRecord((await roomState(dm)).table, { id: hero.seatId, role: "player", purseIds: ["hero"] });
  const exact = smithQuote(seen, "forge", "hero", d);
  const old = smithQuote(seen, "forge", "hero", d, { legacyRounding: true });
  assert.equal(old.terms.costCopper - exact.terms.costCopper, 1, "the two roundings differ here");
  const wallet = async () => toCopper((await roomState(dm)).table.purses.find((p) => p.id === "hero")!.coins);
  const start = await wallet();
  await submitCommands({
    code: dm.code, token: hero.token, batchId: "old-order", tabletopProtocol: QUEST_RENOWN_PROTOCOL,
    commands: [{ id: "old-order", kind: "smith-order", shopId: "forge", purseId: "hero", design: d, before: old.before }],
  });
  assert.equal(start - (await wallet()), old.terms.costCopper, "charged what the old app showed");
  // A current app is quoted and charged the exact price.
  const now = await wallet();
  const next = smithQuote(projectRecord((await roomState(dm)).table, { id: hero.seatId, role: "player", purseIds: ["hero"] }), "forge", "hero", d);
  await submitCommands({
    code: dm.code, token: hero.token, batchId: "new-order", tabletopProtocol: CURRENT_TABLETOP_PROTOCOL,
    commands: [{ id: "new-order", kind: "smith-order", shopId: "forge", purseId: "hero", design: d, before: next.before }],
  });
  assert.equal(now - (await wallet()), next.terms.costCopper);
  assert.equal(next.terms.costCopper, exact.terms.costCopper);
});
