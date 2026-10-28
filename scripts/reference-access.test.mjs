import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { emptyCloudTable } from "../src/lib/quire/cloud.ts";
import { roomState, assertReferenceLookup } from "../src/lib/quire/cloud.server.ts";
import { readJournal } from "../src/lib/quire/journal.ts";
import { referencePolicy } from "../src/lib/quire/reference-access.ts";
import { handleEncounters } from "../cloudflare/encounters.mjs";
import { handleCharacterPlay } from "../cloudflare/character-play.mjs";
import { blankSheet } from "../src/lib/characters/model.mjs";

test("actual encounter lifecycle restricts lookup across unchanged room revisions without exposing enemies", async () => {
  const db = localAccountDb(),
    original = globalThis.__env__;
  globalThis.__env__ = { DB: db };
  const room = {
    code: "LOOKUP",
    revision: 1,
    live: true,
    turn: 0,
    drafts: {},
    seen: { gifts: [], sales: [] },
    seats: [
      { id: "dm", token: "dm-token", role: "dm", name: "DM", purseIds: [] },
      { id: "player", token: "player-token", role: "player", name: "Player", purseIds: ["hero"] },
    ],
    table: {
      ...emptyCloudTable(),
      purses: [
        {
          id: "hero",
          kind: "character",
          name: "Hero",
          coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
        },
      ],
    },
  };
  const input = { code: room.code, token: "player-token" };
  const call = (path, body) => handleEncounters(db, "dm", "encounters/" + path, body);
  try {
    await db
      .prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES ('dm','DM','lookup@example.test',0,0,0)",
      )
      .run();
    await db
      .prepare("INSERT INTO campaign_rooms (code,revision,body) VALUES (?,1,?)")
      .bind(room.code, JSON.stringify(room))
      .run();
    await db
      .prepare("INSERT INTO library_members VALUES ('dm',?,'dm','dm-token','Lookup',0,0)")
      .bind(room.code)
      .run();
    const first = crypto.randomUUID(),
      second = crypto.randomUUID(),
      personal = crypto.randomUUID();
    await call("create", { id: first, code: room.code });
    await call("create", { id: second, code: room.code });
    await call("create", { id: personal, code: "personal" });
    await call("start", { id: personal, revision: 0 });
    assert.equal((await roomState(input)).encounterActive, false);
    await assertReferenceLookup(input, "creatures");
    await call("start", { id: first, revision: 0 });
    const active = await roomState(input);
    assert.equal(active.encounterActive, true);
    assert.equal(
      active.revision,
      1,
      "Encounter metadata updates even when the room revision does not change",
    );
    assert.ok(!JSON.stringify(active).includes(first));
    await assert.rejects(assertReferenceLookup(input, "creatures"), /paused while an encounter/);
    await assertReferenceLookup({ ...input, token: "dm-token" }, "creatures");
    await assert.rejects(
      assertReferenceLookup({ ...input, token: "guessed" }, "spells"),
      /not seated/,
    );
    room.table.journal = readJournal({
      referenceAccess: { ...referencePolicy(), allowDuringEncounters: true, sections: ["spells"] },
    });
    await db
      .prepare("UPDATE campaign_rooms SET body=? WHERE code=?")
      .bind(JSON.stringify(room), room.code)
      .run();
    await assertReferenceLookup(input, "spells");
    await assert.rejects(assertReferenceLookup(input, "items"), /disabled by your DM/);
    await call("start", { id: second, revision: 0 });
    await call("conclude", { id: first, revision: 1 });
    assert.equal((await roomState(input)).encounterActive, true);
    await call("conclude", { id: second, revision: 1 });
    assert.equal((await roomState(input)).encounterActive, false);
    room.closed = true;
    await db
      .prepare("UPDATE campaign_rooms SET body=? WHERE code=?")
      .bind(JSON.stringify(room), room.code)
      .run();
    await assert.rejects(assertReferenceLookup(input, "spells"), /closed/);
  } finally {
    globalThis.__env__ = original;
    db.close();
  }
});

test("editing grants never let a player switch control to another campaign character", async () => {
  const db = localAccountDb(),
    room = {
      code: "SEATTEST",
      revision: 1,
      live: true,
      turn: 0,
      seats: [
        { id: "player", token: "token", role: "player", name: "Player", purseIds: ["hero"] },
        { id: "dm", token: "dm-token", role: "dm", name: "DM", purseIds: [] },
      ],
      table: {
        ...emptyCloudTable(),
        purses: ["hero", "other"].map((id) => ({
          id,
          kind: "character",
          name: id,
          editingAllowed: true,
          sheet: { ...blankSheet(), name: id },
          coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
        })),
      },
    };
  const call = (user, path, body) =>
    handleCharacterPlay(db, user, "sheets/" + path, body, new URL("http://localhost/"));
  try {
    for (const user of ["player", "dm"]) {
      await db
        .prepare(
          "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)",
        )
        .bind(user, user, `${user}@seat.example.test`)
        .run();
      await db
        .prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)")
        .bind(user, room.code, user, user === "dm" ? "dm-token" : "token", "Seats")
        .run();
    }
    await db
      .prepare("INSERT INTO campaign_rooms (code,revision,body) VALUES (?,1,?)")
      .bind(room.code, JSON.stringify(room))
      .run();
    for (const editingAllowed of [false, true]) {
      room.table.purses[0].editingAllowed = editingAllowed;
      await db
        .prepare("UPDATE campaign_rooms SET body=? WHERE code=?")
        .bind(JSON.stringify(room), room.code)
        .run();
      assert.equal(
        (await call("player", "detail", { id: "campaign:SEATTEST:hero" })).campaign.editingAllowed,
        editingAllowed,
      );
      await assert.rejects(call("player", "detail", { id: "campaign:SEATTEST:other" }));
      await assert.rejects(
        call("player", "roll", {
          id: "campaign:SEATTEST:other",
          kind: "ability",
          key: "str",
          requestKey: crypto.randomUUID(),
          revision: 0,
        }),
      );
      await assert.rejects(
        call("player", "save", {
          id: "campaign:SEATTEST:other",
          before: room.table.purses[1].sheet,
          sheet: room.table.purses[1].sheet,
          revision: 0,
        }),
      );
    }
    assert.equal((await call("dm", "detail", { id: "campaign:SEATTEST:other" })).editable, true);
  } finally {
    db.close();
  }
});
