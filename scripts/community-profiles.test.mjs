import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localAccountDb } from "./account-dev-db.mjs";
import { assertAdditiveSql } from "./production-migrations.mjs";
import {
  communityDirectory,
  communityFields,
  communityPortrait,
  communityProfile,
  communityReports,
  moderateCommunityProfile,
  normalizeHandle,
  ownCommunityProfile,
  reportCommunityProfile,
  saveCommunityProfile,
  REPORTS_PER_DAY,
} from "../cloudflare/community.mjs";
import { saveProfile } from "../cloudflare/members.mjs";

async function setup() {
  const db = localAccountDb();
  for (const [id, name] of [
    ["u-dm", "Mira"],
    ["u-pl", "Bram"],
    ["u-viewer", "Viewer"],
    ["u-staff", "Mod"],
  ])
    await db
      .prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)",
      )
      .bind(id, name, `${id}@example.test`)
      .run();
  await db.prepare("INSERT INTO site_roles(user_id,role,granted_at) VALUES ('u-staff','moderator',0)").run();
  return db;
}
const base = (over = {}) => ({
  visibility: "public",
  handle: "kobold_dm",
  play_role: "dm",
  games: ["D&D 5e", "Pathfinder 2e"],
  time_zone: "America/New_York",
  play_times: "Fridays, evenings",
  discord: "kobold_dm",
  lfg: "players",
  lfg_note: "Two seats open for a weekly 5e game.",
  revision: 0,
  ...over,
});
const url = (q = "") => new URL("https://lootsplitter.com/api/account/community/directory" + q);

test("the migration is additive and every existing profile starts hidden", async () => {
  const sql = readFileSync(new URL("../cloudflare/migrations/0021_community_profiles.sql", import.meta.url), "utf8");
  assert.ok(assertAdditiveSql("0021_community_profiles.sql", sql) > 0);
  const db = await setup();
  await db.prepare("INSERT INTO member_profiles(user_id,introduction) VALUES ('u-pl','Old intro')").run();
  assert.equal((await ownCommunityProfile(db, "u-pl")).visibility, "off");
  assert.equal((await communityDirectory(db, null, url())).total, 0);
  assert.equal((await communityDirectory(db, "u-viewer", url())).total, 0);
});

test("handles and fields are validated", () => {
  assert.equal(normalizeHandle(" Kobold_DM "), "kobold_dm");
  for (const bad of ["ab", "-abc", "abc-", "a b c", "admin", "x".repeat(31)])
    assert.throws(() => normalizeHandle(bad), undefined, bad);
  assert.throws(() => communityFields(base({ handle: "" })), /Choose a handle/);
  assert.doesNotThrow(() => communityFields(base({ visibility: "off", handle: "" })));
  assert.throws(() => communityFields(base({ time_zone: "Mars/Olympus" })), /time zone/);
  assert.throws(() => communityFields(base({ games: Array(9).fill("x") })), /up to 8/);
  assert.throws(() => communityFields(base({ discord: "has space" })), /Discord/);
  assert.throws(() => communityFields(base({ play_role: "god" })), /Dungeon Master/);
  assert.deepEqual(JSON.parse(communityFields(base({ games: ["5e", "5E", " ", "OSR"] })).games), ["5e", "OSR"]);
});

test("visibility: public for everyone, members for signed-in members, off for nobody but the owner", async () => {
  const db = await setup();
  await saveCommunityProfile(db, "u-dm", base());
  await saveCommunityProfile(db, "u-pl", base({ handle: "bram", visibility: "members", play_role: "player", lfg: "group" }));
  assert.deepEqual((await communityDirectory(db, null, url())).profiles.map((p) => p.handle), ["kobold_dm"]);
  assert.deepEqual(
    (await communityDirectory(db, "u-viewer", url())).profiles.map((p) => p.handle).sort(),
    ["bram", "kobold_dm"],
  );
  await assert.rejects(communityProfile(db, null, "bram"), (e) => e.status === 404);
  assert.equal((await communityProfile(db, "u-viewer", "bram")).profile.name, "Bram");
  const own = await ownCommunityProfile(db, "u-pl");
  await saveCommunityProfile(db, "u-pl", { ...own, visibility: "off" });
  await assert.rejects(communityProfile(db, "u-viewer", "bram"), (e) => e.status === 404);
  assert.equal((await communityProfile(db, "u-pl", "bram")).self, true, "owners preview their own profile");
});

test("public profiles never carry an email address", async () => {
  const db = await setup();
  await saveProfile(db, "u-dm", {
    name: "Mira",
    introduction: "DM of the Wayfarers",
    portrait: "",
    contact_email: "private@example.test",
    share_contact: true,
    email_opt_in: false,
    revision: 0,
  });
  const own = await ownCommunityProfile(db, "u-dm");
  await saveCommunityProfile(db, "u-dm", base({ revision: own.revision }));
  const text = JSON.stringify([await communityProfile(db, null, "kobold_dm"), await communityDirectory(db, null, url())]);
  assert.doesNotMatch(text, /@example\.test/);
  assert.match(text, /DM of the Wayfarers/);
});

test("handles are unique and saves use the profile revision", async () => {
  const db = await setup();
  await saveCommunityProfile(db, "u-dm", base());
  await assert.rejects(saveCommunityProfile(db, "u-pl", base()), (e) => e.status === 409 && /taken/.test(e.message));
  await assert.rejects(saveCommunityProfile(db, "u-dm", base({ revision: 0 })), (e) => e.status === 409 && /changed/.test(e.message));
});

test("filters: role (both counts for either), looking for, game, time zone and name", async () => {
  const db = await setup();
  await saveCommunityProfile(db, "u-dm", base());
  await saveCommunityProfile(db, "u-pl", base({ handle: "bram", play_role: "both", lfg: "group", games: ["OSR"], time_zone: "Europe/London" }));
  const handles = async (q) => (await communityDirectory(db, null, url(q))).profiles.map((p) => p.handle).sort();
  assert.deepEqual(await handles("?role=player"), ["bram"]);
  assert.deepEqual(await handles("?role=dm"), ["bram", "kobold_dm"]);
  assert.deepEqual(await handles("?lfg=players"), ["kobold_dm"]);
  assert.deepEqual(await handles("?game=osr"), ["bram"]);
  assert.deepEqual(await handles("?tz=Europe/London"), ["bram"]);
  assert.deepEqual(await handles("?q=mir"), ["kobold_dm"]);
  assert.deepEqual(await handles("?q=%25"), [], "LIKE wildcards are escaped");
  await assert.rejects(communityDirectory(db, null, url("?role=god")));
});

test("banned members and staff-hidden profiles disappear; reports reach staff", async () => {
  const db = await setup();
  await saveCommunityProfile(db, "u-dm", base());
  await reportCommunityProfile(db, "u-viewer", { handle: "kobold_dm", reason: "Spam links in the note" });
  await assert.rejects(reportCommunityProfile(db, "u-dm", { handle: "kobold_dm", reason: "self" }), /own profile/);
  await assert.rejects(communityReports(db, "u-viewer"), (e) => e.status === 403);
  const { reports } = await communityReports(db, "u-staff");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].handle, "kobold_dm");
  // The moderation guard needs a live staff session.
  await db.prepare("INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES ('s1','u-staff','t1',?,?,?)")
    .bind(new Date(Date.now() + 3600000).toISOString(), new Date().toISOString(), new Date().toISOString()).run();
  await moderateCommunityProfile(db, "u-staff", { handle: "kobold_dm", action: "hide", reason: "spam" }, "s1");
  assert.equal((await communityDirectory(db, null, url())).total, 0);
  assert.equal((await communityReports(db, "u-staff")).reports.length, 0);
  assert.equal((await ownCommunityProfile(db, "u-dm")).hidden_by_staff, true);
  const audit = await db.prepare("SELECT action FROM moderation_audit WHERE target_id='u-dm'").first();
  assert.equal(audit.action, "community-hide");
  await assert.rejects(
    moderateCommunityProfile(db, "u-staff", { handle: "kobold_dm", action: "show", reason: "" }, "s1"),
    /reason/,
  );
  await moderateCommunityProfile(db, "u-staff", { handle: "kobold_dm", action: "show", reason: "Reviewed" }, "s1");
  assert.equal((await communityDirectory(db, null, url())).total, 1);
  await db.prepare("UPDATE member_access SET status='banned',ban_until=NULL WHERE user_id='u-dm'").run();
  assert.equal((await communityDirectory(db, null, url())).total, 0);
  await assert.rejects(communityProfile(db, null, "kobold_dm"), (e) => e.status === 404);
});

test("reports are limited per reporter per day", async () => {
  const db = await setup();
  await saveCommunityProfile(db, "u-dm", base());
  for (let i = 0; i < REPORTS_PER_DAY; i++)
    await reportCommunityProfile(db, "u-viewer", { handle: "kobold_dm", reason: `report ${i}` });
  await assert.rejects(
    reportCommunityProfile(db, "u-viewer", { handle: "kobold_dm", reason: "one more" }),
    (e) => e.status === 429,
  );
});

test("portraits are served only for visible profiles, as image bytes", async () => {
  const db = await setup();
  const png = "data:image/png;base64,iVBORw0KGgo=";
  await saveProfile(db, "u-pl", {
    name: "Bram", introduction: "", portrait: png, contact_email: "", share_contact: false, email_opt_in: false, revision: 0,
  });
  const own = await ownCommunityProfile(db, "u-pl");
  await saveCommunityProfile(db, "u-pl", base({ handle: "bram", visibility: "members", revision: own.revision }));
  await assert.rejects(communityPortrait(db, null, "bram"), (e) => e.status === 404);
  const response = await communityPortrait(db, "u-viewer", "bram");
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal((await response.arrayBuffer()).byteLength, 8);
  assert.match((await communityProfile(db, "u-viewer", "bram")).profile.portrait, /^\/api\/account\/community\/portrait\/bram\?v=\d+$/);
});

test("moderators cannot moderate themselves, the owner or other staff (same rule as account moderation)", async () => {
  const db = await setup();
  await db.prepare("INSERT INTO site_roles(user_id,role,granted_at) VALUES ('u-dm','owner',0)").run();
  await saveCommunityProfile(db, "u-dm", base({ handle: "the_owner" }));
  await saveCommunityProfile(db, "u-staff", base({ handle: "the_mod" }));
  await saveCommunityProfile(db, "u-pl", base({ handle: "bram" }));
  await db.prepare("INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES ('s1','u-staff','t1',?,?,?)")
    .bind(new Date(Date.now() + 3600000).toISOString(), new Date().toISOString(), new Date().toISOString()).run();
  for (const handle of ["the_owner", "the_mod"])
    await assert.rejects(
      moderateCommunityProfile(db, "u-staff", { handle, action: "hide", reason: "x" }, "s1"),
      (e) => e.status === 403,
      handle,
    );
  await moderateCommunityProfile(db, "u-staff", { handle: "bram", action: "hide", reason: "spam" }, "s1");
  assert.deepEqual((await communityDirectory(db, null, url())).profiles.map((p) => p.handle).sort(), ["the_mod", "the_owner"]);
});

test("a fractional or junk offset is treated as a whole number", async () => {
  const db = await setup();
  await saveCommunityProfile(db, "u-dm", base());
  assert.equal((await communityDirectory(db, null, url("?offset=1.5"))).offset, 1);
  assert.equal((await communityDirectory(db, null, url("?offset=abc"))).offset, 0);
});
