import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { handleAccounts } from "../cloudflare/accounts.mjs";
import { emptyCloudTable } from "../src/lib/quire/cloud.ts";
import { mapTabletopSchema } from "../src/lib/quire/tabletop-schema.ts";
import { mapMediaReference } from "../src/lib/quire/map-assets-schema.ts";
import { concealedMapImage } from "../src/lib/quire/tabletop.ts";

async function setup() {
  const DB = localAccountDb(),
    origin = "http://localhost:8080",
    env = {
      DB,
      ACCOUNT_ORIGIN: origin,
      ACCOUNT_SECRET: "synthetic-tabletop-assets-secret-123456789",
    };
  let ip = 0;
  const call = async (path, body, cookie = "", modern = true) => {
    const response = await handleAccounts(
      new Request(origin + "/api/account/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          cookie,
          "content-type": "application/json",
          "cf-connecting-ip": `192.0.2.${++ip}`,
          ...(modern ? { "x-lootsplit-tabletop": "1" } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    );
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    };
  };
  const signup = async (name) => {
    const result = await call("auth/sign-up/email", {
      name,
      email: name + "@example.invalid",
      password: "synthetic tabletop password 2026",
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return { ...result, id: result.data.user.id };
  };
  const dm = await signup("tabletop-dm"),
    other = await signup("tabletop-player");
  const bundle = async (purpose) => {
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    const manifest = {
      id: crypto.randomUUID(),
      mime: "image/png",
      purpose,
      bytes: bytes.length,
      width: 20,
      height: 10,
      sha256: Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex"),
      preview: "data:image/png;base64,iVBORw0KGgo=",
    };
    const parts = [{ index: 0, base64: Buffer.from(bytes).toString("base64") }];
    for (const request of [
      { action: "begin", manifest },
      { action: "parts", assetId: manifest.id, parts },
      { action: "complete", assetId: manifest.id },
    ])
      assert.equal((await call("map-assets", { request }, dm.cookie)).status, 200);
    return { manifest, parts };
  };
  return { DB, call, dm, other, bundle };
}
test("account map bytes survive backup references and require ownership; older readers preserve the complete source backup", async () => {
  const { DB, call, dm, other, bundle } = await setup();
  try {
    const asset = await bundle("original"),
      table = emptyCloudTable();
    table.journal = {
      sessions: [],
      requests: [],
      events: [],
      world: {
        maps: [
          {
            id: "map",
            name: "Map",
            locationId: null,
            image: asset.manifest.preview,
            visible: true,
            anchors: [],
            markers: [],
            tabletop: mapTabletopSchema.parse({ media: mapMediaReference(asset.manifest) }),
          },
        ],
      },
    };
    const payload = { ...table, kind: "quire", version: 2, books: [], articles: [] };
    const saved = await call("backup", { name: "Tabletop", payload }, dm.cookie);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const req = { request: { action: "manifest", mapId: "map", assetId: asset.manifest.id } };
    assert.equal((await call("map-assets", req, other.cookie)).status, 404);
    assert.equal((await call("map-assets", req)).status, 401);
    assert.equal(
      (await call("map-assets", req, dm.cookie)).data.manifest.sha256,
      asset.manifest.sha256,
    );
    assert.equal((await call("read-backup", { id: saved.data.id }, dm.cookie, false)).status, 409);
    assert.equal((await call("read-backup", { id: saved.data.id }, dm.cookie)).status, 200);
    payload.journal.world.maps[0].tabletop.media = {
      ...mapMediaReference(asset.manifest),
      id: crypto.randomUUID(),
    };
    assert.equal((await call("backup", { name: "Incomplete", payload }, dm.cookie)).status, 400);
    assert.equal((await call("read-backup", { id: saved.data.id }, dm.cookie)).status, 200);
  } finally {
    DB.close();
  }
});
test("historical player archives grant only their projected render, never originals or another report", async () => {
  const { DB, call, dm, other, bundle } = await setup();
  try {
    const original = await bundle("original"),
      render = await bundle("render"),
      table = emptyCloudTable();
    table.journal = {
      sessions: [],
      requests: [],
      events: [],
      world: {
        maps: [
          {
            id: "map",
            name: "Map",
            locationId: null,
            image: original.manifest.preview,
            visible: true,
            anchors: [],
            markers: [],
            tabletop: mapTabletopSchema.parse({
              media: mapMediaReference(original.manifest),
              fog: { enabled: true, base: "concealed" },
              frames: [
                {
                  id: crypto.randomUUID(),
                  audience: "party",
                  revision: 0,
                  media: mapMediaReference(render.manifest),
                },
              ],
            }),
          },
        ],
      },
    };
    const room = {
      code: "ARCHMAP",
      ownerId: dm.id,
      closed: true,
      revision: 1,
      seats: [{ id: "dm", token: "dm-token", role: "dm", purseIds: [] }],
      departed: [
        { id: "player", token: "player-token", role: "player", purseIds: [], status: "dismissed" },
      ],
      table: {
        ...table,
        journal: {
          ...table.journal,
          reports: [
            {
              id: "history",
              name: "History",
              at: 1,
              seatIds: ["dm", "player"],
              snapshot: JSON.stringify(table),
            },
          ],
        },
      },
    };
    await DB.prepare("INSERT INTO campaign_rooms(code,body,revision) VALUES (?,?,?)")
      .bind(room.code, JSON.stringify(room), 1)
      .run();
    await DB.prepare(
      "INSERT INTO library_members(user_id,code,seat_id,token,name,updated_at) VALUES (?,?,?,?,?,?)",
    )
      .bind(other.id, room.code, "player", "player-token", "Archive", 1)
      .run();
    const result = await call("records", undefined, other.cookie);
    assert.equal(result.status, 200);
    assert.equal(result.data.reports[0].snapshot.journal.world.maps[0].image, concealedMapImage);
    const request = (assetId) => ({
      record: { code: room.code, id: "history" },
      request: { action: "manifest", mapId: "map", assetId },
    });
    assert.equal((await call("map-assets", request(render.manifest.id), other.cookie)).status, 200);
    assert.equal(
      (await call("map-assets", request(original.manifest.id), other.cookie)).status,
      404,
    );
    const legacy = await call("records", undefined, other.cookie, false);
    assert.equal(legacy.data.reports[0].snapshot.journal.world.maps[0].tabletop, undefined);
    assert.equal(
      (
        await call(
          "map-assets",
          { ...request(render.manifest.id), record: { code: room.code, id: "wrong" } },
          other.cookie,
        )
      ).status,
      404,
    );
  } finally {
    DB.close();
  }
});
