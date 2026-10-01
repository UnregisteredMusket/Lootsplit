import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("wrangler binds shared rooms to D1 as DB and does not invent a database id", () => {
  const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../cloudflare/worker.mjs", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../cloudflare/migrations/0001_campaign_rooms.sql", import.meta.url), "utf8");
  assert.match(config, /binding = "DB"/);
  assert.match(config, /binding = "ASSETS"/);
  assert.match(config, /migrations_dir = "cloudflare\/migrations"/);
  assert.match(config, /database_id = "<id from Cloudflare>"/);
  assert.doesNotMatch(config, /database_id = "[0-9a-f-]+"/i);
  assert.match(worker, /globalThis\.__env__ = env/);
  assert.match(worker, /dist\/server\/index\.mjs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS campaign_rooms/);
});
