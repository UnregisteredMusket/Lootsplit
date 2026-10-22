// Applies the verified artifact's pending D1 migrations to production before the Worker deploys.
// Only additive SQL is accepted (see assertAdditiveSql); anything else stops the release before
// any database write, and the currently deployed Worker keeps serving. Runs only from the main
// release job inside the `lootsplit-production` concurrency group.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyArtifact } from "./release-artifact.mjs";
import { assertCurrentMain, assertMigrations, cfRequest } from "./production-preflight.mjs";

export const PRODUCTION_DATABASE_ID = "0a200e96-ae2e-47b5-9869-c1f4d316148f";
const MIGRATION_NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

/**
 * Pending migrations, in order. Fails closed when the ledger holds entries the artifact lacks,
 * when a name is malformed or reused, or when a pending migration sorts before an applied one.
 */
export function pendingMigrations(artifactNames, appliedNames) {
  const artifact = [...artifactNames].sort();
  const applied = [...appliedNames].sort();
  for (const name of artifact) assert.match(name, MIGRATION_NAME, `Unexpected migration file name: ${name}`);
  const numbers = artifact.map((name) => name.slice(0, 4));
  assert.equal(new Set(numbers).size, numbers.length, "Two migrations share a number");
  const known = new Set(artifact);
  const extra = applied.filter((name) => !known.has(name));
  assert.deepEqual(extra, [], `Production has migrations this release does not contain: ${extra.join(", ")}`);
  const done = new Set(applied);
  const pending = artifact.filter((name) => !done.has(name));
  const last = applied.at(-1);
  if (last) for (const name of pending)
    assert.ok(name > last, `Pending migration ${name} sorts before applied ${last}; renumber it after ${last}`);
  return pending;
}

/** Masks comments and literals so keyword checks see only SQL structure. */
export function sqlStructure(sql) {
  let out = "";
  for (let i = 0; i < sql.length;) {
    const c = sql[i], next = sql[i + 1];
    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
      out += " ";
    } else if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      assert.ok(end >= 0, "Unterminated /* comment");
      i = end + 2;
      out += " ";
    } else if (c === "'") {
      let j = i + 1;
      for (; ; j++) {
        assert.ok(j < sql.length, "Unterminated string literal");
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") j++;
          else break;
        }
      }
      out += "''";
      i = j + 1;
    } else if (c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1, name = "";
      for (; ; j++) {
        assert.ok(j < sql.length, "Unterminated quoted identifier");
        if (sql[j] === close) {
          if (close !== "]" && sql[j + 1] === close) { name += close; j++; }
          else break;
        } else name += sql[j];
      }
      // Hex-encode quoted names: an identifier called "delete" cannot look like a keyword.
      out += "q_" + Buffer.from(name.toLowerCase(), "utf8").toString("hex");
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const IDENT = String.raw`(?:q_[0-9a-f]+|[a-z_][a-z0-9_$]*)`;
const ALLOWED = [
  { kind: "table", pattern: new RegExp(String.raw`^create table (if not exists )?(${IDENT}) ?\(`) },
  { kind: "index", pattern: new RegExp(String.raw`^create (?:unique )?index (?:if not exists )?${IDENT} on ${IDENT} ?\(`) },
  { kind: "column", pattern: new RegExp(String.raw`^alter table ${IDENT} add (?:column )?${IDENT} `) },
  { kind: "insert", pattern: new RegExp(String.raw`^insert (?:or ignore )?into (${IDENT}) ?(?:\([^()]*\) ?)?values ?\(`) },
];
// Foreign-key actions describe the new table's own rows; they are the only allowed use of these words.
const FOREIGN_KEY_ACTION = /\bon (?:delete|update) (?:cascade|set null|set default|restrict|no action)\b/g;
const DENIED = /\b(drop|delete|update|rename|replace|truncate|attach|detach|pragma|vacuum|reindex|trigger|view|select|with|as|begin|commit|rollback)\b/;
const bareName = (identifier) => identifier.startsWith("q_")
  ? Buffer.from(identifier.slice(2), "hex").toString("utf8")
  : identifier;

/**
 * Conservative additive-only check. Every statement must be CREATE TABLE, CREATE [UNIQUE] INDEX,
 * ALTER TABLE … ADD COLUMN, or INSERT … VALUES into a table created (without IF NOT EXISTS)
 * earlier in the same file.
 * Anything else (drops, renames, data changes, triggers, views, selects, pragmas, transactions)
 * is rejected and needs an owner-reviewed release change instead.
 */
export function assertAdditiveSql(name, sql) {
  const structure = sqlStructure(sql).toLowerCase().replace(/\s+/g, " ");
  const created = new Set();
  const statements = structure.split(";").map((s) => s.trim()).filter(Boolean);
  for (const statement of statements) {
    const shape = ALLOWED.map((rule) => ({ rule, match: rule.pattern.exec(statement) })).find((x) => x.match);
    assert.ok(shape, `${name}: not an additive statement: ${statement.slice(0, 80)}`);
    const denied = statement.replace(FOREIGN_KEY_ACTION, " ").match(DENIED);
    assert.ok(!denied, `${name}: "${denied?.[1].toUpperCase()}" is not allowed in an automatic migration: ${statement.slice(0, 80)}`);
    // IF NOT EXISTS may be a no-op on an existing table, so only a plain CREATE TABLE
    // (which fails if the name exists) makes a table "new" for INSERT purposes.
    if (shape.rule.kind === "table" && !shape.match[1]) created.add(bareName(shape.match[2]));
    if (shape.rule.kind === "insert")
      assert.ok(created.has(bareName(shape.match[1])), `${name}: INSERT is only allowed into a table this migration creates`);
  }
  return statements.length;
}

const ledger = async () => {
  const rows = await cfRequest(`d1/database/${PRODUCTION_DATABASE_ID}/query`, { sql: "SELECT name FROM d1_migrations ORDER BY name" });
  return rows[0].results.map((row) => row.name);
};

if (process.argv[1]?.endsWith("/production-migrations.mjs")) {
  const releaseSha = process.env.RELEASE_SHA || process.env.GITHUB_SHA;
  const root = "dist/website-release";
  assert.equal(process.env.GITHUB_REPOSITORY, "UnregisteredMusket/Lootsplit");
  assert.equal(process.env.GITHUB_REF, "refs/heads/main", "Migrations are applied only by the main release");
  for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "GH_TOKEN"])
    assert.ok(process.env[key], `Missing GitHub Actions secret: ${key}`);
  const response = await fetch("https://api.github.com/repos/UnregisteredMusket/Lootsplit/git/ref/heads/main", {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30000),
  });
  assert.ok(response.ok, "Unable to verify current main");
  assertCurrentMain(releaseSha, (await response.json()).object.sha);
  const manifest = verifyArtifact(root, releaseSha);
  const config = readFileSync(join(root, "wrangler.toml"), "utf8");
  assert.match(config, /^name = "lootsplit"/);
  assert.ok(config.includes(`database_id = "${PRODUCTION_DATABASE_ID}"`) && config.includes('migrations_dir = "migrations"'),
    "Release config must target the production database and the artifact's migrations");
  const expected = Object.keys(manifest.files).filter((n) => n.startsWith("migrations/")).map((n) => n.slice(11));
  const before = await ledger();
  const pending = pendingMigrations(expected, before);
  const record = { commit: manifest.commit, before, pending, applied: [], checkedAt: new Date().toISOString() };
  mkdirSync("test-results", { recursive: true });
  const save = () => writeFileSync("test-results/production-migrations.json", JSON.stringify(record, null, 2) + "\n");
  if (!pending.length) {
    save();
    console.log(`No pending migrations for ${manifest.commit}; no database writes performed.`);
  } else {
    for (const name of pending) assertAdditiveSql(name, readFileSync(join(root, "migrations", name), "utf8"));
    try {
      // Time Travel restore point (D1 keeps one automatically; this records where it was).
      record.bookmark = (await cfRequest(`d1/database/${PRODUCTION_DATABASE_ID}/time_travel/bookmark`)).bookmark ?? null;
    } catch (error) {
      record.bookmark = null;
      record.bookmarkError = error.message;
    }
    save();
    console.log(`Applying ${pending.length} additive migration(s): ${pending.join(", ")} (Time Travel bookmark ${record.bookmark ?? "unavailable"})`);
    const token = process.env.CLOUDFLARE_D1_MIGRATION_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
    try {
      execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "migrations", "apply", "lootsplit", "--remote", "--config", join(root, "wrangler.toml")], {
        stdio: "inherit",
        timeout: 240000,
        env: { ...process.env, CI: "true", CLOUDFLARE_API_TOKEN: token },
      });
    } finally {
      // Read back whatever happened, success or not, so a partial apply is visible.
      record.after = await ledger();
      record.applied = record.after.filter((name) => !before.includes(name));
      save();
    }
    assertMigrations(expected, record.after);
    console.log(`Applied and read back ${record.applied.join(", ")}; production ledger matches the release.`);
  }
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Database migrations: ${pending.length ? `applied ${record.applied.join(", ")}` : "none pending"}\n\n`);
}
