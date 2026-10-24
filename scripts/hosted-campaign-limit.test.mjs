import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localAccountDb } from "./account-dev-db.mjs";
import { handleAccounts } from "../cloudflare/accounts.mjs";
import {
  DEFAULT_HOSTED_CAMPAIGN_LIMIT,
  hostedCampaignLimit,
  hostedCampaignLimitMessage,
  hostedCampaignStatus,
} from "../cloudflare/hosted-campaigns.mjs";
import { BUILTIN_LOGS } from "../cloudflare/monitor-journal.mjs";
import { assertAdditiveSql } from "./production-migrations.mjs";
import { emptyCloudTable } from "../src/lib/quire/cloud.ts";
import { blankPurse } from "../src/lib/quire/economy.ts";
import { closeRoom, joinRoom, openRoom, roomState } from "../src/lib/quire/cloud.server.ts";

const origin = "http://localhost:8080";
const LIMIT_TEXT = /You can host up to 2 online campaigns\. End or delete one, or keep playing this one offline on your device\./;

function table() {
  const t = emptyCloudTable();
  t.purses = [
    { ...blankPurse("character"), id: "hero", name: "Hero" },
    { ...blankPurse("character"), id: "rogue", name: "Rogue" },
  ];
  return t;
}

async function setup(extraEnv = {}) {
  const DB = localAccountDb();
  const env = {
    DB,
    ACCOUNT_ORIGIN: origin,
    ACCOUNT_SECRET: "only-synthetic-hosted-campaign-limit-test-secret",
    ...extraEnv,
  };
  globalThis.__env__ = env;
  let ip = 0;
  async function call(path, body, cookie = "") {
    const response = await handleAccounts(
      new Request(`${origin}/api/account/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          cookie,
          "content-type": "application/json",
          "cf-connecting-ip": `192.0.2.${++ip % 250}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    );
    return { status: response.status, data: await response.json(), cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ") };
  }
  async function signup(name) {
    const r = await call("auth/sign-up/email", {
      email: `${name}@example.invalid`,
      name,
      password: "synthetic hosting limit password 2026",
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return { id: r.data.user.id, cookie: r.cookie };
  }
  const open = (user, name = "DM") => openRoom({ name, table: table(), userId: user.id });
  const library = async (user) => (await call("library", undefined, user.cookie)).data;
  const roomCount = async () =>
    (await DB.prepare("SELECT COUNT(*) AS n FROM campaign_rooms").first()).n;
  return { DB, env, call, signup, open, library, roomCount };
}

test("the limit is a config value with a default of 2 and the migration is additive", () => {
  assert.equal(DEFAULT_HOSTED_CAMPAIGN_LIMIT, 2);
  assert.equal(hostedCampaignLimit({}), 2);
  assert.equal(hostedCampaignLimit({ HOSTED_CAMPAIGN_LIMIT: "5" }), 5);
  assert.equal(hostedCampaignLimit({ HOSTED_CAMPAIGN_LIMIT: "nonsense" }), 2);
  assert.equal(hostedCampaignLimit({ HOSTED_CAMPAIGN_LIMIT: "-1" }), 2);
  assert.match(hostedCampaignLimitMessage(2), LIMIT_TEXT);
  const sql = readFileSync(
    new URL("../cloudflare/migrations/0022_hosted_campaign_index.sql", import.meta.url),
    "utf8",
  );
  assert.equal(assertAdditiveSql("0022_hosted_campaign_index.sql", sql), 1);
  assert.ok(BUILTIN_LOGS.some(([id, , mode]) => id === "campaign-limit" && mode === "event"));
  assert.match(
    readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8"),
    /^HOSTED_CAMPAIGN_LIMIT = "2"$/m,
  );
});

test("the live hosted count reads the partial owner index, not room bodies", async () => {
  const { DB } = await setup();
  const plan = await DB.prepare(
    "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM campaign_rooms WHERE json_extract(body,'$.ownerId')=? AND json_extract(body,'$.closed') IS NOT 1",
  )
    .bind("someone")
    .all();
  assert.match(JSON.stringify(plan.results), /campaign_rooms_live_owner/);
});

test("under the limit is allowed; at the limit opening a room is refused with a clear message and logged", async () => {
  const { DB, signup, open, library, roomCount } = await setup();
  const dm = await signup("limit-open-dm");
  await open(dm);
  assert.deepEqual((await library(dm)).hosting, { hosted: 1, limit: 2, exempt: false, atLimit: false });
  await open(dm);
  assert.deepEqual((await library(dm)).hosting, { hosted: 2, limit: 2, exempt: false, atLimit: true });
  const before = await roomCount();
  await assert.rejects(open(dm), (error) => {
    assert.match(error.message, LIMIT_TEXT);
    assert.equal(error.status, 409);
    return true;
  });
  assert.equal(await roomCount(), before, "nothing was created");
  const logs = await DB.prepare(
    "SELECT summary,body FROM owner_monitor_logs WHERE source='campaign-limit'",
  ).all();
  assert.equal(logs.results.length, 1);
  assert.doesNotMatch(JSON.stringify(logs.results), new RegExp(dm.id));
  assert.equal(JSON.parse(logs.results[0].body).path, "open");
});

test("concurrent opens cannot both pass the last slot", async () => {
  const { signup, open, library } = await setup();
  const dm = await signup("limit-race-dm");
  await open(dm);
  const results = await Promise.allSettled([open(dm), open(dm), open(dm)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const r of results.filter((r) => r.status === "rejected")) assert.match(r.reason.message, LIMIT_TEXT);
  assert.equal((await library(dm)).hosting.hosted, 2);
});

test("joining as a player is unaffected by the host limit and does not count", async () => {
  const { DB, signup, open, library } = await setup();
  const dm = await signup("limit-join-dm"),
    other = await signup("limit-join-other");
  await open(dm);
  await open(dm);
  const others = [await open(other), await open(other)];
  for (const room of others) {
    const { sessionId } = JSON.parse((await DB.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind(room.code).first()).body);
    const joined = await joinRoom({ code: room.code, purseId: "hero", name: "Player", userId: dm.id, sessionId });
    assert.ok(joined.token);
  }
  assert.equal((await library(dm)).hosting.hosted, 2);
  assert.equal((await library(other)).hosting.hosted, 2);
});

test("accounts already over the limit keep every room, but creating another is refused", async () => {
  const { DB, signup, open, library } = await setup();
  const dm = await signup("limit-over-dm");
  const codes = [];
  for (const code of ["OVER01", "OVER02", "OVER03"]) {
    const seat = { id: `${code}-dm`, token: `${code}-token`, name: "DM", role: "dm", userId: dm.id, purseIds: [] };
    const room = { code, ownerId: dm.id, revision: 1, turn: 0, live: true, seats: [seat], table: table(), seen: { gifts: [], sales: [] } };
    await DB.prepare("INSERT INTO campaign_rooms(code,revision,body) VALUES (?,1,?)").bind(code, JSON.stringify(room)).run();
    await DB.prepare(
      "INSERT INTO library_members(user_id,code,seat_id,token,name,archived,updated_at) VALUES (?,?,?,?,?,0,?)",
    ).bind(dm.id, code, seat.id, seat.token, code, Date.now()).run();
    codes.push([code, seat.token]);
  }
  const lib = await library(dm);
  assert.deepEqual(lib.hosting, { hosted: 3, limit: 2, exempt: false, atLimit: true });
  assert.equal(lib.members.filter((m) => m.role === "dm").length, 3);
  for (const [code, token] of codes) {
    const view = await roomState({ code, token });
    assert.equal(view.code, code, "every existing room stays readable and playable");
  }
  await assert.rejects(open(dm), LIMIT_TEXT);
});

test("the site owner is exempt (server-side site_roles check)", async () => {
  const { DB, signup, open, library } = await setup();
  const owner = await signup("limit-site-owner");
  await DB.prepare("INSERT INTO site_roles(user_id,role,granted_at) VALUES (?,'owner',?)").bind(owner.id, Date.now()).run();
  for (let i = 0; i < 4; i++) await open(owner);
  assert.deepEqual((await library(owner)).hosting, { hosted: 4, limit: 2, exempt: true, atLimit: false });
  // An admin or moderator is not the owner and stays limited.
  const admin = await signup("limit-site-admin");
  await DB.prepare("INSERT INTO site_roles(user_id,role,granted_at) VALUES (?,'admin',?)").bind(admin.id, Date.now()).run();
  await open(admin);
  await open(admin);
  await assert.rejects(open(admin), LIMIT_TEXT);
});

test("ending (closing) a room frees a slot; keeping it online to view still counts; reopening at the limit is refused", async () => {
  const { DB, call, signup, open, library } = await setup();
  const dm = await signup("limit-close-dm");
  const first = await open(dm);
  const second = await open(dm);
  await closeRoom({ code: second.code, token: second.token, keepOnline: true });
  assert.equal((await library(dm)).hosting.hosted, 2, "a room kept online to view is still live");
  await closeRoom({ code: first.code, token: first.token });
  assert.equal((await library(dm)).hosting.hosted, 1, "a closed room frees its slot");
  await open(dm);
  // Reopening the closed room would host a third live room.
  const member = (await library(dm)).members.find((m) => m.code === first.code);
  const before = await DB.prepare("SELECT body,revision FROM campaign_rooms WHERE code=?").bind(first.code).first();
  const refused = await call("resume", { code: first.code, reopen: true, revision: member.room_revision }, dm.cookie);
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, LIMIT_TEXT);
  assert.deepEqual(
    await DB.prepare("SELECT body,revision FROM campaign_rooms WHERE code=?").bind(first.code).first(),
    before,
    "the closed room is unchanged",
  );
  await closeRoom({ code: second.code, token: second.token });
  const reopened = await call("resume", { code: first.code, reopen: true, revision: member.room_revision }, dm.cookie);
  assert.equal(reopened.status, 200, JSON.stringify(reopened.data));
  assert.equal(reopened.data.reopened, true);
  assert.equal((await library(dm)).hosting.hosted, 2);
});

test("deleting frees a slot; restoring over the limit is refused and the backup is kept", async () => {
  const { DB, call, signup, open, library } = await setup();
  const dm = await signup("limit-delete-dm");
  const first = await open(dm);
  await open(dm);
  const deleted = await call("campaign", { action: "delete", code: first.code, confirm: first.code, revision: 1 }, dm.cookie);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
  assert.equal((await library(dm)).hosting.hosted, 1, "deletion frees a slot; its backup does not count");
  await open(dm);
  const backupBefore = await DB.prepare("SELECT * FROM library_backups WHERE id=?").bind(deleted.data.backupId).first();
  const rooms = (await DB.prepare("SELECT COUNT(*) AS n FROM campaign_rooms").first()).n;
  const refused = await call("restore-backup", { id: deleted.data.backupId, requestKey: crypto.randomUUID() }, dm.cookie);
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, LIMIT_TEXT);
  assert.deepEqual(await DB.prepare("SELECT * FROM library_backups WHERE id=?").bind(deleted.data.backupId).first(), backupBefore);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM campaign_recoveries").first()).n, 0);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM campaign_rooms").first()).n, rooms);
  assert.ok((await library(dm)).backups.some((b) => b.id === deleted.data.backupId));
  // Under the limit again, the same backup restores.
  const live = (await library(dm)).members.find((m) => m.role === "dm" && !m.closed);
  const row = await DB.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind(live.code).first();
  const token = JSON.parse(row.body).seats[0].token;
  await closeRoom({ code: live.code, token });
  const restored = await call("restore-backup", { id: deleted.data.backupId, requestKey: crypto.randomUUID() }, dm.cookie);
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.equal((await library(dm)).hosting.hosted, 2);
});

test("linking a guest-era DM seat makes the account its host and is refused at the limit", async () => {
  const { DB, call, signup, open, library } = await setup();
  const dm = await signup("limit-link-dm");
  for (const code of ["GUEST1", "GUEST2"]) {
    const room = { code, revision: 1, turn: 0, live: true, seats: [{ id: `${code}-dm`, token: `${code}-token`, name: "DM", role: "dm", purseIds: [] }], table: table(), seen: { gifts: [], sales: [] } };
    await DB.prepare("INSERT INTO campaign_rooms(code,revision,body) VALUES (?,1,?)").bind(code, JSON.stringify(room)).run();
  }
  await open(dm);
  const linked = await call("link", { code: "GUEST1", token: "GUEST1-token", name: "Old" }, dm.cookie);
  assert.equal(linked.status, 200, JSON.stringify(linked.data));
  assert.equal((await library(dm)).hosting.hosted, 2);
  const before = await DB.prepare("SELECT body FROM campaign_rooms WHERE code='GUEST2'").first();
  const refused = await call("link", { code: "GUEST2", token: "GUEST2-token", name: "Old" }, dm.cookie);
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, LIMIT_TEXT);
  assert.deepEqual(await DB.prepare("SELECT body FROM campaign_rooms WHERE code='GUEST2'").first(), before);
  // Re-linking a room the account already hosts is never refused.
  assert.equal((await call("link", { code: "GUEST1", token: "GUEST1-token", name: "Renamed" }, dm.cookie)).status, 200);
});

test("account backups and device campaigns are unaffected at the limit", async () => {
  const { signup, open, call, library, DB } = await setup();
  const dm = await signup("limit-offline-dm");
  await open(dm);
  await open(dm);
  const payload = { ...table(), kind: "quire", version: 2, books: [], articles: [] };
  const saved = await call("backup", { name: "Device copy", payload }, dm.cookie);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal((await library(dm)).hosting.hosted, 2, "backups do not count");
  // Monitor probe rooms (no owner) and other accounts' rooms never count for this account.
  const status = await hostedCampaignStatus(DB, dm.id, 2);
  assert.equal(status.hosted, 2);
});

test("the limit can be changed by configuration", async () => {
  const { signup, open, library } = await setup({ HOSTED_CAMPAIGN_LIMIT: "1" });
  const dm = await signup("limit-config-dm");
  await open(dm);
  await assert.rejects(open(dm), /You can host up to 1 online campaign\./);
  assert.equal((await library(dm)).hosting.limit, 1);
});
