// Audit 2026-11-10 B4 (P0): a banned or kicked person must not walk back in with the invitation
// link they already had, signed out as another unclaimed character, nor link such a seat to the
// removed account afterwards. Owner decision (2026-11-11): kicking or banning rotates the
// invitation link; seated players keep playing undisturbed. Disposable in-memory database only.
import "../src/lib/quire/commands.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { linkAccountSeat } from "../cloudflare/accounts.mjs";
import { resumeCampaignMembership } from "../cloudflare/account-campaigns.mjs";
import {
  closeRoom,
  joinRoom,
  manageRoom,
  openRoom,
  pollRoom,
  previewRoom,
  roomState,
} from "../src/lib/quire/cloud.server.ts";
import { readRoomResponse, readUnchangedRoom } from "../src/lib/quire/room-response.ts";

const coins = { cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 };
const table = () => ({
  purses: ["mira", "kael", "ash", "tam"].map((id) => ({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    kind: "character",
    coins,
  })),
  holdings: [],
  ledger: [],
  shops: [],
  stock: [],
  listings: [],
  loans: [],
  sheets: [],
  notes: [],
});

async function withDb(run) {
  const DB = localAccountDb();
  globalThis.__env__ = { DB };
  try {
    for (const id of ["dm-user", "banned-user", "kicked-user", "seated-user"])
      await DB.prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)",
      )
        .bind(id, id, `${id}@example.com`)
        .run();
    await run(DB);
  } finally {
    delete globalThis.__env__;
    DB.close();
  }
}

/** The link a client builds: the code plus the view's session (cloud-table.tsx). */
const linkSession = (view) => view.sessionId;

for (const action of ["ban", "kick"]) {
  test(`after a ${action}, the old link no longer seats anyone and the removed account cannot link a seat`, async () => {
    await withDb(async (DB) => {
      const dm = await openRoom({ name: "DM", table: table(), userId: "dm-user" });
      const before = await roomState({ code: dm.code, token: dm.token, tabletopProtocol: 33 });
      const oldSession = linkSession(before);
      assert.ok(oldSession, "an account-opened room has an invitation session");
      const removed = action === "ban" ? "banned-user" : "kicked-user";
      const target = await joinRoom({
        code: dm.code,
        purseId: "mira",
        name: "Removed",
        userId: removed,
        sessionId: oldSession,
      });
      const seated = await joinRoom({
        code: dm.code,
        purseId: "ash",
        name: "Seated",
        userId: "seated-user",
        sessionId: oldSession,
      });
      const guest = await joinRoom({ code: dm.code, purseId: "tam", name: "Guest", sessionId: oldSession });
      const seatedBefore = await roomState({ code: dm.code, token: seated.token, tabletopProtocol: 33 });

      const dmView = await manageRoom({ code: dm.code, token: dm.token, action, seatId: target.seatId });

      // The removed person, signed out, with the link they already had: refused at the
      // lookup and at the join, so no other unclaimed character can be taken.
      await assert.rejects(previewRoom(dm.code, oldSession), /invitation has expired/);
      await assert.rejects(
        joinRoom({ code: dm.code, purseId: "kael", name: "Back again", sessionId: oldSession }),
        /invitation has expired/,
      );

      // The DM's view carries the new link at once, and it works for a new player.
      const newSession = linkSession(dmView);
      assert.ok(newSession && newSession !== oldSession, "kick and ban rotate the invitation link");
      // (The removed character is listed as before; joining it needs the DM's invitation.)
      assert.deepEqual(
        (await previewRoom(dm.code, newSession)).characters.map((c) => c.id),
        ["mira", "kael"],
      );

      // Even with the new link (passed on by someone), a guest seat taken by the removed
      // person cannot be linked to the removed account.
      const sneaky = await joinRoom({ code: dm.code, purseId: "kael", name: "Sneaky", sessionId: newSession });
      await assert.rejects(
        linkAccountSeat(DB, removed, { code: dm.code, token: sneaky.token, name: "Game" }),
        action === "ban" ? /banned/ : /fresh invitation/,
      );
      // A signed-in join by the banned account is refused as before.
      if (action === "ban")
        await assert.rejects(
          joinRoom({ code: dm.code, purseId: "kael", name: "x", userId: removed, sessionId: newSession }),
          /banned|already seated/,
        );

      // Seated players keep playing: same seat, same play session, nothing to re-join.
      const seatedAfter = await roomState({ code: dm.code, token: seated.token, tabletopProtocol: 33 });
      assert.equal(seatedAfter.seatId, seated.seatId);
      assert.equal(seatedAfter.playSession, seatedBefore.sessionId, "the play session is kept");
      assert.equal(seatedAfter.sessionId, newSession, "players can still share the current link");
      readRoomResponse(seatedAfter);
      const guestAfter = await roomState({ code: dm.code, token: guest.token, tabletopProtocol: 11 });
      assert.equal(guestAfter.seatId, guest.seatId);
      // The light poll (old and new apps) reports the same session as the full view.
      const light = await pollRoom({
        code: dm.code,
        token: guest.token,
        tabletopProtocol: 11,
        knownRevision: guestAfter.revision,
        knownSeatId: guest.seatId,
      });
      readUnchangedRoom(light, { ...guestAfter, sessionId: guestAfter.sessionId });
      // A seated account reopening the link it joined with gets its own seat back.
      const again = await joinRoom({
        code: dm.code,
        purseId: "ash",
        name: "Seated",
        userId: "seated-user",
        sessionId: oldSession,
      });
      assert.equal(again.seatId, seated.seatId);
      assert.ok(
        (await previewRoom(dm.code, oldSession, "seated-user")).characters.some((c) => c.id === "ash"),
      );
    });
  });
}

test("a kick in a guest-opened room creates an invitation session", async () => {
  await withDb(async () => {
    const dm = await openRoom({ name: "DM", table: table() });
    const before = await roomState({ code: dm.code, token: dm.token, tabletopProtocol: 33 });
    assert.equal(before.sessionId, undefined, "guest-opened rooms start without a session");
    const target = await joinRoom({ code: dm.code, purseId: "mira", name: "Removed" });
    const seated = await joinRoom({ code: dm.code, purseId: "ash", name: "Seated" });
    const dmView = await manageRoom({ code: dm.code, token: dm.token, action: "kick", seatId: target.seatId });
    await assert.rejects(previewRoom(dm.code), /invitation has expired/);
    await assert.rejects(
      joinRoom({ code: dm.code, purseId: "kael", name: "Back again" }),
      /invitation has expired/,
    );
    assert.ok(dmView.sessionId);
    assert.equal(dmView.playSession, "", "the room had no play session; it keeps none");
    await joinRoom({ code: dm.code, purseId: "kael", name: "New", sessionId: dmView.sessionId });
    const after = await roomState({ code: dm.code, token: seated.token, tabletopProtocol: 33 });
    assert.equal(after.seatId, seated.seatId);
  });
});

test("a signed-in kicked account rejoining with the DM's fresh invitation still works", async () => {
  await withDb(async (DB) => {
    const dm = await openRoom({ name: "DM", table: table(), userId: "dm-user" });
    const first = (await roomState({ code: dm.code, token: dm.token, tabletopProtocol: 33 })).sessionId;
    const target = await joinRoom({ code: dm.code, purseId: "mira", name: "K", userId: "kicked-user", sessionId: first });
    const kicked = await manageRoom({ code: dm.code, token: dm.token, action: "kick", seatId: target.seatId });
    const departed = kicked.departed.find((s) => s.id === target.seatId);
    const invited = await manageRoom({ code: dm.code, token: dm.token, action: "invite", seatId: departed.id });
    const invitation = invited.departed.find((s) => s.id === target.seatId).invitation;
    const back = await joinRoom({
      code: dm.code,
      purseId: "mira",
      name: "K",
      userId: "kicked-user",
      sessionId: invited.sessionId,
      invitation,
    });
    // Joined through the invitation: the restriction is lifted, so linking works again.
    await linkAccountSeat(DB, "kicked-user", { code: dm.code, token: back.token, name: "Game" });
  });
});

test("reopening a closed room invalidates a link rotated by a kick, as it does any older link", async () => {
  await withDb(async (DB) => {
    const dm = await openRoom({ name: "DM", table: table(), userId: "dm-user" });
    const first = (await roomState({ code: dm.code, token: dm.token, tabletopProtocol: 33 })).sessionId;
    const target = await joinRoom({ code: dm.code, purseId: "mira", name: "K", userId: "kicked-user", sessionId: first });
    await joinRoom({ code: dm.code, purseId: "ash", name: "Guest", sessionId: first });
    const rotated = (await manageRoom({ code: dm.code, token: dm.token, action: "kick", seatId: target.seatId })).sessionId;
    assert.notEqual(rotated, first);
    await closeRoom({ code: dm.code, token: dm.token });
    const { revision } = await DB.prepare("SELECT revision FROM campaign_rooms WHERE code=?").bind(dm.code).first();
    await resumeCampaignMembership(DB, "dm-user", { code: dm.code, reopen: true, revision }, 5);
    const reopened = await roomState({ code: dm.code, token: dm.token, tabletopProtocol: 33 });
    assert.ok(reopened.sessionId && reopened.sessionId !== rotated && reopened.sessionId !== first);
    for (const old of [first, rotated])
      await assert.rejects(
        joinRoom({ code: dm.code, purseId: "tam", name: "Old link", sessionId: old }),
        /invitation has expired/,
      );
    await assert.rejects(previewRoom(dm.code, rotated), /invitation has expired/);
    await joinRoom({ code: dm.code, purseId: "tam", name: "New link", sessionId: reopened.sessionId });
  });
});

test("a kicked person who rejoins signed out with the DM's fresh invitation can link that seat; nobody else's", async () => {
  await withDb(async (DB) => {
    const dm = await openRoom({ name: "DM", table: table(), userId: "dm-user" });
    const first = (await roomState({ code: dm.code, token: dm.token, tabletopProtocol: 33 })).sessionId;
    const target = await joinRoom({ code: dm.code, purseId: "mira", name: "K", userId: "kicked-user", sessionId: first });
    await manageRoom({ code: dm.code, token: dm.token, action: "kick", seatId: target.seatId });
    const invited = await manageRoom({ code: dm.code, token: dm.token, action: "invite", seatId: target.seatId });
    const invitation = invited.departed.find((s) => s.id === target.seatId).invitation;
    // Another character joined with the current link, signed out: not the re-invited seat.
    const other = await joinRoom({ code: dm.code, purseId: "kael", name: "Other", sessionId: invited.sessionId });
    await assert.rejects(
      linkAccountSeat(DB, "kicked-user", { code: dm.code, token: other.token, name: "Game" }),
      /fresh invitation/,
    );
    // The re-invited character, joined signed out with the DM's fresh invitation.
    const back = await joinRoom({ code: dm.code, purseId: "mira", name: "K", sessionId: invited.sessionId, invitation });
    await linkAccountSeat(DB, "kicked-user", { code: dm.code, token: back.token, name: "Game" });
    const state = await roomState({ code: dm.code, token: back.token, tabletopProtocol: 33 });
    assert.equal(state.userId, "kicked-user");
    const { body } = await DB.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind(dm.code).first();
    assert.equal(JSON.parse(body).blockedUsers?.["kicked-user"], undefined, "the kick restriction is lifted");
  });
});

test("a banned account cannot link even the seat of its former character", async () => {
  await withDb(async (DB) => {
    const dm = await openRoom({ name: "DM", table: table(), userId: "dm-user" });
    const first = (await roomState({ code: dm.code, token: dm.token, tabletopProtocol: 33 })).sessionId;
    const target = await joinRoom({ code: dm.code, purseId: "mira", name: "B", userId: "banned-user", sessionId: first });
    const banned = await manageRoom({ code: dm.code, token: dm.token, action: "ban", seatId: target.seatId });
    const guest = await joinRoom({ code: dm.code, purseId: "kael", name: "Guest", sessionId: banned.sessionId });
    await assert.rejects(
      linkAccountSeat(DB, "banned-user", { code: dm.code, token: guest.token, name: "Game" }),
      /banned/,
    );
  });
});
