import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { handleAccounts } from "../cloudflare/accounts.mjs";
import { readJournal } from "../src/lib/quire/journal.ts";
import { CURRENT_TABLETOP_PROTOCOL, ZONES_PROTOCOL } from "../src/lib/quire/tabletop-protocol.ts";

const origin = "http://localhost:8080";

// The server used to cap the client's tabletop protocol at 10, so the current website could not
// restore its own online backups once they held newer map data (zones, footprints, follow view…).
test("a current client restores a backup with current map data; an older client is refused", async () => {
  const DB = localAccountDb();
  const env = { DB, ACCOUNT_SECRET: "only-a-disposable-test-secret-12345678901234567890", ACCOUNT_ORIGIN: origin };
  let ip = 0;
  const call = async (path, body, cookie = "", protocol) => {
    const headers = { origin, "cf-connecting-ip": `192.0.2.${++ip}`, "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    if (protocol !== undefined) headers["x-lootsplit-tabletop"] = String(protocol);
    const response = await handleAccounts(
      new Request(origin + "/api/account/" + path, { method: "POST", headers, body: JSON.stringify(body) }),
      env,
    );
    const cookies = response.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ");
    return { response, data: await response.json(), cookie: cookies };
  };
  try {
    const dm = await call("auth/sign-up/email", {
      email: "backup-protocol@example.com",
      password: "a long unique test password",
      name: "Test DM",
    });
    assert.equal(dm.response.status, 200, JSON.stringify(dm.data));
    const journal = readJournal({});
    journal.world = { ...journal.world, npcs: [], maps: [], zones: [] };
    const payload = {
      kind: "quire",
      version: 2,
      purses: [],
      holdings: [],
      ledger: [],
      shops: [],
      stock: [],
      books: [],
      articles: [],
      journal,
    };
    const saved = await call("backup", { name: "Zoned campaign", payload }, dm.cookie);
    assert.equal(saved.response.status, 200, JSON.stringify(saved.data));
    const current = await call("read-backup", { id: saved.data.id }, dm.cookie, CURRENT_TABLETOP_PROTOCOL);
    assert.equal(current.response.status, 200, JSON.stringify(current.data));
    assert.deepEqual(current.data.payload.journal.world.zones, []);
    const older = await call("read-backup", { id: saved.data.id }, dm.cookie, ZONES_PROTOCOL - 1);
    assert.equal(older.response.status, 409);
  } finally {
    DB.close();
  }
});
