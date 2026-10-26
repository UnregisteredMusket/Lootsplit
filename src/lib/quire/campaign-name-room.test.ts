// Shared campaign names (plan P2, Q17): the DM's name travels with the room view, the join
// lookup and the account library; only the DM seat can set it; device defaults never travel.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, nameRoom, previewRoom } from "./cloud.server.ts";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import { readRoomResponse } from "./room-response.ts";
import {
  campaignDisplayName,
  campaignTabTitle,
  membershipDisplayName,
  roomCampaignName,
} from "./campaign-name.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of ["0001_campaign_rooms.sql", "0003_accounts.sql", "0008_encounters.sql"])
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

const coins = { cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 };
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "mira", name: "Mira", kind: "character", coins },
      { id: "kael", name: "Kael", kind: "character", coins },
    ],
  };
}

test("room names are cleaned and device defaults never travel", () => {
  assert.equal(roomCampaignName("  The   Wayfarers \n"), "The Wayfarers");
  assert.equal(roomCampaignName("Party overview"), undefined);
  assert.equal(roomCampaignName("campaign"), undefined);
  assert.equal(roomCampaignName(""), undefined);
  assert.equal(roomCampaignName(42), undefined);
  assert.equal(roomCampaignName("x".repeat(90))?.length, 60);
});

test("display names: shared rooms show the DM's name or the code fallback", () => {
  const base = { joined: true, code: "ABCD12" } as const;
  assert.equal(campaignDisplayName({ ...base, role: "player", deviceName: "Party overview", roomName: "The Wayfarers" }), "The Wayfarers");
  assert.equal(campaignDisplayName({ ...base, role: "player", deviceName: "Party overview" }), "Shared campaign · ABCD12");
  // A guest's own device campaign name never labels someone else's room.
  assert.equal(campaignDisplayName({ ...base, role: "player", deviceName: "My Friday table" }), "Shared campaign · ABCD12");
  assert.equal(campaignDisplayName({ ...base, role: "player", deviceName: "x", libraryName: "Tuesday game" }), "Tuesday game");
  assert.equal(campaignDisplayName({ ...base, role: "dm", deviceName: "The Wayfarers" }), "The Wayfarers");
  assert.equal(campaignDisplayName({ ...base, role: "dm", deviceName: "Party overview" }), "Shared campaign · ABCD12");
  // Device campaigns keep their own names, including the old default.
  assert.equal(campaignDisplayName({ joined: false, role: "dm", deviceName: "Party overview" }), "Party overview");
  assert.equal(campaignTabTitle("The Wayfarers", "Mira"), "Mira · The Wayfarers");
  assert.equal(membershipDisplayName({ name: "Campaign", campaignName: "The Wayfarers" }), "The Wayfarers");
  assert.equal(membershipDisplayName({ name: "Tuesday game", campaignName: "The Wayfarers" }), "Tuesday game");
  assert.equal(membershipDisplayName({ name: "Party overview" }), "Unnamed campaign");
  // The fallback text is never treated as a real name (a device copy may have been saved with it).
  assert.equal(roomCampaignName("Shared campaign · ABCD12"), undefined);
  assert.equal(campaignDisplayName({ ...base, role: "dm", deviceName: "Shared campaign · OLD1" }), "Shared campaign · ABCD12");
});

test("the DM's campaign name reaches players; only the DM can change it", async () => {
  const dm = await openRoom({ name: "DM", table: campaign(), campaignName: "The Wayfarers" });
  assert.equal((await previewRoom(dm.code)).campaignName, "The Wayfarers");
  const mira = await joinRoom({ code: dm.code, purseId: "mira", name: "Ann" });
  const seen = await roomState({ code: dm.code, token: mira.token });
  assert.equal(seen.campaignName, "The Wayfarers");
  assert.equal(readRoomResponse(seen).remote.campaignName, "The Wayfarers");
  await assert.rejects(
    nameRoom({ code: dm.code, token: mira.token, campaignName: "Mira's game" }),
    /Only the DM can name the campaign/,
  );
  const before = (await roomState({ code: dm.code, token: dm.token })).revision;
  // An unchanged name writes nothing.
  assert.equal((await nameRoom({ code: dm.code, token: dm.token, campaignName: "The Wayfarers" })).revision, before);
  const renamed = await nameRoom({ code: dm.code, token: dm.token, campaignName: "The Lost Road" });
  assert.equal(renamed.revision, before + 1);
  assert.equal((await roomState({ code: dm.code, token: mira.token })).campaignName, "The Lost Road");
  // A device default clears the name: players then see "Shared campaign · CODE".
  await nameRoom({ code: dm.code, token: dm.token, campaignName: "Party overview" });
  assert.equal((await roomState({ code: dm.code, token: mira.token })).campaignName, undefined);
});

test("rooms opened without a name (older clients) stay readable and unnamed", async () => {
  const dm = await openRoom({ name: "DM", table: campaign() });
  const view = await roomState({ code: dm.code, token: dm.token });
  assert.equal("campaignName" in view, false);
  assert.equal((await previewRoom(dm.code)).campaignName, undefined);
  assert.throws(() => readRoomResponse({ ...view, campaignName: 7 }));
});

test("the join lookup refuses banned accounts and test rooms, and hides the name from kicked ones", async () => {
  const { readRoom, updateRoom } = await import("./room-store.server.ts");
  const dm = await openRoom({ name: "DM", table: campaign(), campaignName: "The Wayfarers" });
  // The restrictions manageRoom's Kick and Ban record for these accounts.
  const before = (await readRoom(dm.code))!;
  await updateRoom(
    { ...before, blockedUsers: { "user-ann": "banned", "user-ben": "kicked" }, revision: before.revision + 1 },
    before.revision,
  );
  await assert.rejects(previewRoom(dm.code, undefined, "user-ann"), /banned/);
  const kicked = await previewRoom(dm.code, undefined, "user-ben");
  assert.equal(kicked.campaignName, undefined);
  assert.equal((await previewRoom(dm.code, undefined, "someone-else")).campaignName, "The Wayfarers");
  const room = (await readRoom(dm.code))!;
  await updateRoom({ ...room, testMode: true, revision: room.revision + 1 }, room.revision);
  await assert.rejects(previewRoom(dm.code), /Test rooms are private/);
});
