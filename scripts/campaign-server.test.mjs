import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { handleCharacterPlay } from "../cloudflare/character-play.mjs";
import { blankSheet } from "../src/lib/characters/model.mjs";
import { characterSheet } from "../src/lib/characters/campaign-sheet.mjs";
import { emptyCloudTable } from "../src/lib/quire/cloud.ts";
import {
  openRoom,
  joinRoom,
  choosePace,
  roomState,
  submitCommands,
  characterRoll,
} from "../src/lib/quire/cloud.server.ts";
import { readRoom } from "../src/lib/quire/room-store.server.ts";
import { blankPurse } from "../src/lib/quire/economy.ts";
const db = localAccountDb();
globalThis.__env__ = { DB: db };
const pc = (id) => ({
  ...blankPurse("character"),
  id,
  name: id,
  coins: { cp: 0, sp: 0, ep: 0, gp: 7, pp: 0 },
});
async function setup() {
  const dm = await openRoom({
    name: "DM",
    table: { ...emptyCloudTable(), purses: [pc("hero"), pc("other")] },
  });
  const player = await joinRoom({ code: dm.code, purseId: "hero", name: "Player" });
  await choosePace({ ...dm, live: true });
  return { dm, player: { ...player, code: dm.code } };
}
test("authoritative character writes reject minted money/items and cross-seat writes, retain private sheets and deduplicate DM awards", async () => {
  const { dm, player } = await setup();
  const before = await roomState(dm),
    sheet = characterSheet(before.table.purses[0], []);
  const command = (patch, purseId = "hero") => ({
    kind: "character",
    id: crypto.randomUUID(),
    purseId,
    before: sheet,
    sheet: { ...sheet, ...patch },
  });
  for (const cmd of [
    command({ coins: { ...sheet.coins, gp: 999 } }),
    command({
      equipment: [{ name: "Counterfeit", quantity: 1, weight: 0, equipped: false, notes: "" }],
    }),
    command({ hp: 4 }, "other"),
    {
      id: crypto.randomUUID(),
      kind: "patch",
      changes: [
        {
          store: "purses",
          id: "hero",
          before: before.table.purses[0],
          after: { ...before.table.purses[0], coins: { ...sheet.coins, gp: 99 } },
        },
      ],
    },
  ]) {
    await assert.rejects(
      submitCommands({ ...player, batchId: crypto.randomUUID(), commands: [cmd] }),
    );
  }
  assert.deepEqual((await roomState(dm)).table, before.table);
  const playerView = await roomState(player);
  assert.equal(playerView.table.purses.find((p) => p.id === "other")?.sheet, undefined);
  const grant = command({
    coins: { ...sheet.coins, gp: 9 },
    equipment: [{ name: "Awarded sword", quantity: 1, weight: 2, equipped: false, notes: "" }],
  });
  const batch = { ...dm, batchId: crypto.randomUUID(), commands: [grant] };
  await submitCommands(batch);
  await submitCommands(batch);
  let saved = await roomState(dm);
  assert.equal(saved.table.purses[0].coins.gp, 9);
  assert.equal(saved.table.holdings.length, 1);
  const hp = command({ hp: 5 });
  await submitCommands({ ...player, batchId: crypto.randomUUID(), commands: [hp] });
  saved = await roomState(dm);
  assert.equal(saved.table.purses[0].coins.gp, 9);
  assert.equal(saved.table.purses[0].sheet?.hp, 5);
});
test("campaign rolls use the canonical stats, enforce manual policy and store one receipt in the existing campaign log", async () => {
  const { dm, player } = await setup();
  const roll = {
    ...player,
    purseId: "hero",
    requestKey: crypto.randomUUID(),
    revision: 0,
    kind: "ability",
    key: "str",
  };
  const a = await characterRoll(roll);
  assert.deepEqual(await characterRoll(roll), a);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM play_rolls WHERE code=?").bind(dm.code).first()).n,
    1,
  );
  assert.equal((await characterRoll({ ...player, purseId: "hero", log: true })).rolls.length, 1);
  await assert.rejects(
    characterRoll({ ...roll, purseId: "other", requestKey: crypto.randomUUID() }),
    /control/,
  );
  await assert.rejects(
    characterRoll({ ...roll, manual: true, total: 12, requestKey: crypto.randomUUID() }),
    /disabled/,
  );
  await db.prepare("INSERT INTO play_policies VALUES (?,1,0)").bind(dm.code).run();
  assert.equal(
    (await characterRoll({ ...roll, manual: true, total: 12, requestKey: crypto.randomUUID() }))
      .source,
    "manual",
  );
});
test("existing assigned account sheets migrate without minting; account API shares the same character and blocks forged grants", async () => {
  const { dm, player } = await setup();
  const user = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)",
    )
    .bind(user, "Player", `${user}@example.com`)
    .run();
  await db
    .prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)")
    .bind(user, dm.code, player.seatId, player.token, "Test")
    .run();
  const body = {
    ...blankSheet(),
    name: "Test",
    hp: 10,
    maxHp: 115,
    coins: { cp: 0, sp: 0, ep: 0, gp: 999, pp: 0 },
  };
  const profileId = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO play_characters(id,user_id,body,campaign_code,purse_id,updated_at) VALUES (?,?,?,?,?,0)",
    )
    .bind(profileId, user, JSON.stringify(body), dm.code, "hero")
    .run();
  const initial = await readRoom(dm.code);
  delete initial.table.purses[0].sheet;
  await db
    .prepare("UPDATE campaign_rooms SET body=? WHERE code=?")
    .bind(JSON.stringify(initial), dm.code)
    .run();
  const upgraded = await roomState(dm),
    p = upgraded.table.purses[0];
  assert.equal(p.sheet?.hp, 10);
  assert.equal(p.sheet?.maxHp, 115);
  assert.equal(p.name, "Test");
  assert.equal(p.coins.gp, 7);
  const call = (path, payload) =>
    handleCharacterPlay(db, user, "sheets/" + path, payload, new URL("http://localhost/"));
  const detail = await call("detail", { id: profileId });
  assert.equal(detail.body.coins.gp, 7);
  await assert.rejects(
    call("save", {
      id: profileId,
      revision: detail.revision,
      before: detail.body,
      sheet: { ...detail.body, coins: { ...detail.body.coins, gp: 999 } },
    }),
    /Only the DM/,
  );
  await call("save", {
    id: profileId,
    revision: detail.revision,
    before: detail.body,
    sheet: { ...detail.body, hp: 6 },
  });
  assert.equal((await roomState(dm)).table.purses[0].sheet?.hp, 6);
  assert.equal((await call("detail", { id: profileId })).body.hp, 6);
  assert.equal((await call("detail", { id: `campaign:${dm.code}:hero` })).body.hp, 6);
  await assert.rejects(call("detail", { id: `campaign:${dm.code}:other` }), /not found/);
});
