import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { localAccountDb } from "./account-dev-db.mjs";
import { createClient } from "@libsql/client";
import { d1Database } from "../standby/database.mjs";
import { createRoom, readRoom } from "../src/lib/quire/room-store.server.ts";
import { emptyCloudTable } from "../src/lib/quire/cloud.ts";
import { fromCopper, toCopper } from "../src/lib/quire/money.ts";
import { commandSchema } from "../src/lib/quire/commands.ts";
import {
  joinRoom,
  roomState,
  submitCommands,
  manageRoom,
  closeRoom,
} from "../src/lib/quire/cloud.server.ts";

const give = (id, copper) => ({
  id,
  kind: "give",
  fromId: "hero",
  toId: "other",
  copper,
  holdingId: null,
  quantity: 0,
});
for (const adapter of ["development", "standby"]) {
  test(`${adapter}: same-seat drafts, delayed receipts and concurrent linked writes preserve all accepted actions`, async () => {
    const db =
      adapter === "development"
        ? localAccountDb()
        : d1Database(createClient({ url: "file::memory:" }));
    if (adapter === "standby")
      for (const name of readdirSync(new URL("../cloudflare/migrations/", import.meta.url))
        .filter((n) => n.endsWith(".sql"))
        .sort())
        await db.exec(
          readFileSync(new URL("../cloudflare/migrations/" + name, import.meta.url), "utf8"),
        );
    globalThis.__env__ = { DB: db };
    try {
      await db
        .prepare(
          "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES ('owner','Synthetic DM','sync@example.test',0,0,0)",
        )
        .run();
      let index = 0;
      const fixture = async () => {
        const code = "SYNC" + ++index;
        const dm = { code, token: "dm-" + index };
        await createRoom({
          code,
          revision: 1,
          turn: 0,
          live: false,
          ownerId: "owner",
          seats: [
            {
              id: "dm",
              token: dm.token,
              role: "dm",
              name: "Synthetic DM",
              userId: "owner",
              purseIds: [],
            },
          ],
          seen: { gifts: [], sales: [] },
          table: {
            ...emptyCloudTable(),
            purses: ["hero", "other"].map((id) => ({
              id,
              kind: "character",
              name: id,
              coins: fromCopper(id === "hero" ? 1000 : 0),
            })),
          },
        });
        const joined = await joinRoom({ code, purseId: "hero", name: "Synthetic player" });
        const player = { code, token: joined.token };
        await manageRoom({ ...dm, action: "start", seatId: joined.seatId });
        return { dm, player, seatId: joined.seatId };
      };
      const f = await fixture(),
        a = give("device-a", 100),
        b = give("device-b", 200);
      await Promise.all([
        submitCommands({ ...f.player, batchId: "batch-a", commands: [a], stage: true }),
        submitCommands({ ...f.player, batchId: "batch-b", commands: [b], stage: true }),
      ]);
      let remote = await roomState(f.player);
      assert.deepEqual(new Set(JSON.parse(remote.draft).map((c) => c.id)), new Set([a.id, b.id]));
      assert.equal(toCopper(remote.table.purses[1].coins), 0, "Staging does not spend money");
      await assert.rejects(
        submitCommands({
          ...f.player,
          batchId: "batch-a",
          commands: [a],
          endTurn: true,
        }),
        /complete turn/,
      );
      assert.equal(
        toCopper((await roomState(f.player)).table.purses[1].coins),
        0,
        "A partial end-turn rejection commits nothing",
      );
      remote = await submitCommands({ ...f.player, batchId: "batch-a", commands: [a] });
      assert.deepEqual(
        JSON.parse(remote.draft).map((c) => c.id),
        [b.id],
        "Submitting A preserves device B's unsubmitted action",
      );
      assert.deepEqual(remote.acknowledged, [a.id]);
      assert.equal(toCopper(remote.table.purses[1].coins), 100);
      remote = await submitCommands({
        ...f.player,
        batchId: "resumed-a",
        commands: [a],
        stage: true,
      });
      assert.deepEqual(
        JSON.parse(remote.draft).map((c) => c.id),
        [b.id],
        "An acknowledged delayed action is never restored as pending",
      );
      remote = await submitCommands({
        ...f.player,
        batchId: "batch-b",
        commands: [b],
        endTurn: true,
      });
      assert.equal(JSON.parse(remote.draft).length, 0);
      assert.equal(toCopper(remote.table.purses[1].coins), 300);
      assert.equal(remote.table.ledger.length, 4);
      await closeRoom({ ...f.dm, keepOnline: true });
      assert.equal(
        (await roomState(f.player)).viewOnly,
        true,
        "Real receipts do not block ending a session",
      );

      const conflict = await fixture(),
        action = give("immutable", 100);
      await submitCommands({
        ...conflict.player,
        batchId: "first",
        commands: [action],
        stage: true,
      });
      const before = await readRoom(conflict.dm.code);
      await assert.rejects(
        submitCommands({
          ...conflict.player,
          batchId: "different",
          commands: [{ ...action, copper: 200 }],
          stage: true,
        }),
        /different changes/,
      );
      assert.deepEqual(await readRoom(conflict.dm.code), before);
      await submitCommands({ ...conflict.player, batchId: "first", commands: [action] });
      for (const batchId of ["first", "different"])
        await assert.rejects(
          submitCommands({ ...conflict.player, batchId, commands: [{ ...action, copper: 200 }] }),
          /conflicting changes/,
        );
      await assert.rejects(
        submitCommands({
          ...conflict.player,
          batchId: "first",
          commands: [give("new-action", 200)],
        }),
        /batch ID/,
      );
      assert.equal(toCopper((await roomState(conflict.player)).table.purses[1].coins), 100);

      const overspend = await fixture();
      await submitCommands({
        ...overspend.player,
        batchId: "one",
        commands: [give("one", 700)],
        stage: true,
      });
      await assert.rejects(
        submitCommands({
          ...overspend.player,
          batchId: "two",
          commands: [give("two", 700)],
          stage: true,
        }),
        /Insufficient funds/,
      );
      assert.deepEqual(
        JSON.parse((await roomState(overspend.player)).draft).map((c) => c.id),
        ["one"],
      );

      const notes = await fixture();
      await Promise.all(
        ["first", "second"].map((id) =>
          submitCommands({
            ...notes.dm,
            batchId: id,
            commands: [{ id, kind: "message", to: "party", purseId: "", text: "Synthetic " + id }],
          }),
        ),
      );
      assert.equal(
        (await roomState(notes.dm)).table.notes.length,
        2,
        "Concurrent account-aware batches both commit",
      );
    } finally {
      delete globalThis.__env__;
      db.close();
    }
  });
}

test("local D1 batches cannot interleave and rollback affects only the failing request", async () => {
  const db = localAccountDb();
  try {
    db.exec("CREATE TABLE sync_batch(id TEXT PRIMARY KEY)");
    const outcomes = await Promise.allSettled([
      db.batch([
        db.prepare("INSERT INTO sync_batch VALUES('failed')"),
        db.prepare("INSERT INTO sync_batch VALUES('failed')"),
      ]),
      db.batch([
        db.prepare("INSERT INTO sync_batch VALUES('one')"),
        db.prepare("INSERT INTO sync_batch VALUES('two')"),
      ]),
    ]);
    assert.deepEqual(
      outcomes.map((r) => r.status),
      ["rejected", "fulfilled"],
    );
    assert.deepEqual(
      (await db.prepare("SELECT id FROM sync_batch ORDER BY id").all()).results.map((r) => r.id),
      ["one", "two"],
    );
  } finally {
    db.close();
  }
});

test("canonical nested command receipts accept reordered Zod echoes, preserve legacy hashes, and reject changed actions", async () => {
  const db = localAccountDb();
  globalThis.__env__ = { DB: db };
  try {
    const dm = { code: "CANONICAL", token: "dm" };
    await createRoom({ code: dm.code, revision: 1, turn: 0, live: true,
      seats: [{ id: "dm", token: "dm", role: "dm", name: "Synthetic DM", purseIds: [] }],
      table: { ...emptyCloudTable(), purses: [{ id: "hero", kind: "character", name: "Hero", coins: fromCopper(1000) }] }, seen: { gifts: [], sales: [] } });
    const before = (await roomState(dm)).table.purses[0];
    const command = { kind: "patch", changes: [{ store: "purses", id: "hero", before, after: { ...before, name: "Renamed" } }], id: "canonical-patch" };
    const reordered = value => !value || typeof value !== "object" ? value : Array.isArray(value)
      ? value.map(reordered) : Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reordered(item)]));
    const echoed = commandSchema.parse(reordered(command));
    await submitCommands({ ...dm, batchId: "saved", commands: [command], stage: true });
    await submitCommands({ ...dm, batchId: "saved", commands: [echoed], stage: true });
    await submitCommands({ ...dm, batchId: "saved", commands: [echoed] });
    await submitCommands({ ...dm, batchId: "saved", commands: [command] });
    let saved = await readRoom(dm.code);
    assert.match(saved.commandHashes["dm:canonical-patch"], /^v2:/);
    assert.match(saved.batchHashes["dm:saved"], /^v2:/);
    assert.equal(saved.table.purses[0].name, "Renamed");
    const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
    const legacy = commandSchema.parse(command);
    saved.commandHashes["dm:canonical-patch"] = await digest(JSON.stringify(legacy));
    saved.batchHashes["dm:saved"] = await digest(JSON.stringify([legacy]));
    await db.prepare("UPDATE campaign_rooms SET body=? WHERE code=?").bind(JSON.stringify(saved), dm.code).run();
    await submitCommands({ ...dm, batchId: "saved", commands: [command] });
    saved = await readRoom(dm.code);
    assert.equal(saved.table.purses[0].name, "Renamed", "Legacy receipt retry remains idempotent");
    const changed = { ...command, changes: [{ ...command.changes[0], after: { ...before, name: "Different action" } }] };
    await assert.rejects(submitCommands({ ...dm, batchId: "saved", commands: [changed] }), /conflicting changes/);
  } finally { delete globalThis.__env__; db.close(); }
});

test("forgetting a membership cannot detach account identity from campaign bans, kicks or departures", async () => {
  const db = localAccountDb();
  globalThis.__env__ = { DB: db };
  try {
    for (const id of ["owner", "player"])
      await db
        .prepare(
          "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)",
        )
        .bind(id, id, id + "@example.test")
        .run();
    for (const action of ["kick", "ban", "leave", "release"]) {
      const code = "FORGET" + action.toUpperCase();
      const dm = { code, token: "dm-" + action };
      await createRoom({
        code,
        revision: 1,
        turn: 0,
        live: true,
        ownerId: "owner",
        seats: [
          {
            id: "dm",
            token: dm.token,
            role: "dm",
            name: "Synthetic DM",
            userId: "owner",
            purseIds: [],
          },
        ],
        seen: { gifts: [], sales: [] },
        table: {
          ...emptyCloudTable(),
          purses: ["hero", "other"].map((id) => ({
            id,
            kind: "character",
            name: id,
            coins: fromCopper(0),
          })),
        },
      });
      const player = await joinRoom({
        code,
        purseId: "hero",
        userId: "player",
        name: "Synthetic player",
      });
      assert.equal(player.userId, "player");
      assert.equal(
        (await roomState({ code, token: player.token })).userId,
        "player",
        "Own-seat projection retains canonical account identity",
      );
      await db
        .prepare("DELETE FROM library_members WHERE code=? AND user_id='player'")
        .bind(code)
        .run();
      assert.equal(
        await db
          .prepare("SELECT user_id FROM library_members WHERE code=? AND user_id='player'")
          .bind(code)
          .first(),
        null,
      );
      await manageRoom({
        ...(action === "leave" ? { code, token: player.token } : dm),
        action,
        seatId: player.seatId,
      });
      const after = await readRoom(code);
      assert.equal(
        after.departed[0].userId,
        "player",
        "Canonical account identity survives Forget",
      );
      await assert.rejects(roomState({ code, token: player.token }), /not seated/);
      if (action === "kick" || action === "ban") {
        assert.equal(after.blockedUsers.player, action === "ban" ? "banned" : "kicked");
        await assert.rejects(
          joinRoom({
            code,
            purseId: "other",
            userId: "player",
            name: "Same account, other character",
          }),
          action === "ban" ? /banned/ : /fresh invitation/,
        );
        if (action === "kick") {
          await manageRoom({ ...dm, action: "invite", seatId: player.seatId });
          const invitation = (await readRoom(code)).invitations.hero;
          await assert.rejects(
            joinRoom({
              code,
              purseId: "other",
              userId: "player",
              name: "Wrong character",
              invitation,
            }),
            /fresh invitation/,
          );
          await joinRoom({
            code,
            purseId: "hero",
            userId: "player",
            name: "Invited player",
            invitation,
          });
        } else
          await assert.rejects(
            manageRoom({ ...dm, action: "invite", seatId: player.seatId }),
            /Banned/,
          );
      } else {
        const returned = await joinRoom({
          code,
          purseId: "hero",
          userId: "player",
          name: "Returned player",
        });
        if (action === "release")
          assert.equal(
            returned.seatId,
            player.seatId,
            "Dismissed account retains report identity on reassignment",
          );
      }
    }
  } finally {
    delete globalThis.__env__;
    db.close();
  }
});

test("file fallback serializes create/CAS/delete, replaces complete snapshots, and refuses another process's lock", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "lootsplit-file-store-"));
  try {
    const storeUrl = new URL("../src/lib/quire/room-store.server.ts", import.meta.url).href;
    const cloudUrl = new URL("../src/lib/quire/cloud.ts", import.meta.url).href;
    const body = `
      import assert from 'node:assert/strict';
      import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
      import { createRoom, readRoom, updateRoom, deleteRoom } from ${JSON.stringify(storeUrl)};
      import { emptyCloudTable } from ${JSON.stringify(cloudUrl)};
      const fixture=code=>({code,revision:1,turn:0,live:false,seats:[],table:emptyCloudTable(),seen:{gifts:[],sales:[]}});
      await Promise.all(Array.from({length:12},(_,i)=>createRoom(fixture('ROOM'+i))));
      assert.equal(JSON.parse(readFileSync('data/cloud-rooms.json','utf8')).length,12);
      const outcomes=await Promise.allSettled([updateRoom({...fixture('ROOM0'),revision:2,turn:1},1),updateRoom({...fixture('ROOM0'),revision:2,turn:2},1)]);
      assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
      assert.match(outcomes.find(o=>o.status==='rejected').reason.message,/table changed/);
      await assert.rejects(deleteRoom('ROOM0',1),/table changed/);
      const complete=readFileSync('data/cloud-rooms.json','utf8');
      writeFileSync('data/cloud-rooms.json.abandoned.tmp','[incomplete');
      assert.equal((await readRoom('ROOM0')).revision,2);
      writeFileSync('data/cloud-rooms.json.lock',JSON.stringify({pid:99999999}));
      await assert.rejects(createRoom(fixture('LOCKED')),/locked by another process/);
      assert.equal(readFileSync('data/cloud-rooms.json','utf8'),complete);
      unlinkSync('data/cloud-rooms.json.lock');
      await deleteRoom('ROOM0',2);
      assert.equal(await readRoom('ROOM0'),null);
      assert.equal(JSON.parse(readFileSync('data/cloud-rooms.json','utf8')).length,11);
    `;
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", body],
      { cwd: temporary, stdio: "pipe", env: { ...process.env, NODE_USE_ENV_PROXY: "0" } },
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
