import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { d1Database } from "../standby/database.mjs";
import { localAccountDb } from "./account-dev-db.mjs";

/** Identical permission invariants can also run on the actual standby adapter. */
export async function authorizationDatabase() {
  if (process.env.AUTHORIZATION_TEST_DATABASE !== "libsql") return localAccountDb();
  const client = createClient({ url: ":memory:" });
  const migrations = new URL("../cloudflare/migrations/", import.meta.url);
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await client.executeMultiple(readFileSync(new URL(name, migrations), "utf8"));
  return d1Database(client);
}
