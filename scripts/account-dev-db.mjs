/** Local-only D1 interface. Production always uses the actual D1 binding. */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
export function localAccountDb(filename = ":memory:") {
  const sqlite = new DatabaseSync(filename);
  // Browser fixtures and the dev server open this same local file in separate processes.
  // Wait for short writes to finish instead of failing immediately with SQLITE_BUSY.
  sqlite.exec("PRAGMA busy_timeout=5000");
  sqlite.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS account_dev_migrations (name TEXT PRIMARY KEY)",
  );
  for (const name of readdirSync(new URL("../cloudflare/migrations/", import.meta.url))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (sqlite.prepare("SELECT name FROM account_dev_migrations WHERE name=?").get(name)) continue;
    sqlite.exec(readFileSync(new URL("../cloudflare/migrations/" + name, import.meta.url), "utf8"));
    sqlite.prepare("INSERT INTO account_dev_migrations VALUES (?)").run(name);
  }
  function prepare(sql) {
    let params = [];
    return {
      bind(...args) {
        params = args;
        return this;
      },
      async first() {
        return sqlite.prepare(sql).get(...params) ?? null;
      },
      async all() {
        const results = sqlite.prepare(sql).all(...params);
        return {
          results,
          success: true,
          meta: {
            changes: Number(sqlite.prepare("SELECT changes() AS n").get().n),
            last_row_id: 0,
          },
        };
      },
      async raw() {
        return sqlite
          .prepare(sql)
          .all(...params)
          .map((row) => Object.values(row));
      },
      async run() {
        const result = sqlite.prepare(sql).run(...params);
        return {
          success: true,
          results: [],
          meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
        };
      },
    };
  }
  return {
    prepare,
    exec: (sql) => sqlite.exec(sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => sqlite.close(),
  };
}
