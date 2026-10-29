// Every shared-room read of campaign data and every room write goes through the storage API
// (cloudflare/room-storage.mjs and src/lib/quire/room-store.server.ts, built on it), so sectioned
// storage (owner plan 2026-10-28, step 2b) changes room storage in one place. This test fails if
// any other source file writes `campaign_rooms`, reads a room body directly in SQL, or touches the
// room sections table (`campaign_room_sections`, step 2b) at all.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const ROOTS = ["cloudflare", "src", "standby"];
const EXTENSIONS = /\.(mjs|js|ts|tsx)$/;
/** The storage API itself. */
const STORAGE = new Set(["cloudflare/room-storage.mjs", "src/lib/quire/room-store.server.ts"]);
/**
 * Known exceptions, each with its reason. Keep this list short.
 * - map-signals.server.ts: the light map-signal read (load audit F6) projects a few fields of an
 *   inline room in SQL instead of reading the whole campaign every second; for a sectioned room
 *   (its table is not in the row) it falls back to readStoredRoom.
 * - multiplayer-probe.mjs: deletes its own synthetic MONITOR-PROBE rooms by code (no body read),
 *   with their receipts and any sections.
 */
const EXCEPTIONS = new Map([
  ["src/lib/quire/map-signals.server.ts", new Set(["body-read"])],
  ["cloudflare/multiplayer-probe.mjs", new Set(["delete", "sections"])],
]);
/** Top-level fields that stay on the room row; json_extract on these may be used directly. */
const TOP_LEVEL =
  "seats|ownerId|closed|sessionId|revision|testMode|live|viewOnly|campaignName";

function files(dir) {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const relative = path.join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    if (statSync(path.join(root, relative)).isDirectory()) return files(relative);
    return EXTENSIONS.test(name) && !/\.test\.(mjs|ts|tsx|js)$/.test(name) ? [relative] : [];
  });
}

/** String and template literals in a source file (template `${}` parts included as text). */
function literals(source) {
  return source.match(/`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g) ?? [];
}

const KEYWORDS = new Set(["where", "on", "join", "left", "inner", "set", "values", "select", "group", "order", "limit", "and", "or"]);

/** Problems in one SQL literal, as short labels. */
/** The innermost parenthesized group of `sql` around `index` (the whole text at top level). */
function enclosing(sql, index) {
  let depth = 0,
    start = -1;
  for (let i = index; i >= 0; i--) {
    if (sql[i] === ")") depth++;
    else if (sql[i] === "(") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start < 0) return sql;
  depth = 0;
  for (let i = start; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")" && --depth === 0) return sql.slice(start, i + 1);
  }
  return sql.slice(start);
}

export function roomSqlProblems(sql) {
  const problems = /\bcampaign_room_sections\b/.test(sql) ? ["sections"] : [];
  if (!/\bcampaign_rooms\b/.test(sql)) return problems;
  if (/\b(UPDATE|INSERT\s+(OR\s+\w+\s+)?INTO|REPLACE\s+INTO)\s+campaign_rooms\b/i.test(sql))
    problems.push("write");
  if (/\bDELETE\s+FROM\s+campaign_rooms\b/i.test(sql)) problems.push("delete");
  const allowed = new RegExp(
    String.raw`json_extract\(\s*(?:\w+\.)?body\s*,\s*'\$\.(?:${TOP_LEVEL})'\s*\)|json_each\(\s*(?:\w+\.)?body\s*,\s*'\$\.seats'\s*\)`,
    "g",
  );
  let qualified = false,
    bare = false;
  // Each mention is checked within its own (sub)query: the innermost parenthesized group around
  // it, or the whole statement. Other tables' `body` columns elsewhere do not count.
  for (const match of sql.matchAll(/\bcampaign_rooms\b(?:\s+(?:AS\s+)?(\w+))?/gi)) {
    const scope = enclosing(sql, match.index).replace(allowed, "");
    const alias = match[1] && !KEYWORDS.has(match[1].toLowerCase()) ? match[1] : null;
    for (const name of ["campaign_rooms", ...(alias ? [alias] : [])])
      if (new RegExp(String.raw`\b${name}\.(body|\*)`).test(scope)) qualified = true;
    // An unqualified `body` (or SELECT *) only counts when the room row is unaliased here.
    if (!alias && /(^|[^.\w])body\b|SELECT\s+\*/i.test(scope)) bare = true;
  }
  if (qualified || bare) problems.push("body-read");
  return problems;
}

test("the room SQL detector catches direct writes and body reads", () => {
  assert.deepEqual(roomSqlProblems("UPDATE campaign_rooms SET body=? WHERE code=?"), ["write", "body-read"]);
  assert.deepEqual(roomSqlProblems("INSERT INTO campaign_rooms(code,revision,body) VALUES (?,?,?)"), ["write", "body-read"]);
  assert.deepEqual(roomSqlProblems("SELECT body FROM campaign_rooms WHERE code=?"), ["body-read"]);
  assert.deepEqual(roomSqlProblems("SELECT * FROM campaign_rooms WHERE code=?"), ["body-read"]);
  assert.deepEqual(roomSqlProblems("SELECT m.code,r.body FROM library_members m JOIN campaign_rooms r ON r.code=m.code"), ["body-read"]);
  assert.deepEqual(roomSqlProblems("EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND body=?)"), ["body-read"]);
  assert.deepEqual(roomSqlProblems("SELECT json_extract(body,'$.table.ledger') FROM campaign_rooms"), ["body-read"]);
  assert.deepEqual(roomSqlProblems("FROM campaign_rooms r LEFT JOIN json_each(r.body,'$.table.purses') p"), ["body-read"]);
  assert.deepEqual(roomSqlProblems("DELETE FROM campaign_rooms WHERE code=?"), ["delete"]);
  // Room sections belong to the storage module only, read or write.
  assert.deepEqual(roomSqlProblems("SELECT body FROM campaign_room_sections WHERE code=?"), ["sections"]);
  assert.deepEqual(roomSqlProblems("DELETE FROM campaign_room_sections WHERE code=?"), ["sections"]);
  assert.deepEqual(roomSqlProblems("SELECT 1 FROM campaign_rooms r JOIN campaign_room_sections s ON s.code=r.code"), ["sections"]);
  // Allowed: guards and counts without the body, top-level fields, other tables' bodies.
  assert.deepEqual(roomSqlProblems("EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND revision=?)"), []);
  assert.deepEqual(roomSqlProblems("(SELECT COUNT(*) FROM campaign_rooms WHERE json_extract(body,'$.ownerId')=? AND json_extract(body,'$.closed') IS NOT 1)"), []);
  assert.deepEqual(roomSqlProblems("EXISTS (SELECT 1 FROM campaign_rooms r,json_each(r.body,'$.seats') s WHERE r.code=?)"), []);
  assert.deepEqual(roomSqlProblems("SELECT json(body) FROM dm_encounters e JOIN campaign_rooms r ON r.code=e.code"), []);
  assert.deepEqual(roomSqlProblems("INSERT INTO play_rolls(body) SELECT ? WHERE EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND revision=?)"), []);
  assert.deepEqual(roomSqlProblems("(SELECT json(r.body) FROM dm_encounter_rolls r), (SELECT 1 FROM play_characters c JOIN campaign_rooms r ON r.code=c.campaign_code)"), []);
});

test("only the room storage API writes campaign_rooms or reads room bodies", () => {
  const found = [];
  for (const file of ROOTS.flatMap(files)) {
    if (STORAGE.has(file)) continue;
    const source = readFileSync(path.join(root, file), "utf8");
    for (const sql of literals(source))
      for (const problem of roomSqlProblems(sql)) {
        if (EXCEPTIONS.get(file)?.has(problem)) continue;
        found.push(`${file}: ${problem}: ${sql.replace(/\s+/g, " ").slice(0, 140)}`);
      }
  }
  assert.deepEqual(
    found,
    [],
    "Use cloudflare/room-storage.mjs (readStoredRoom, readRoomCore, readRoomTables, readRoomPaths, roomWriteStatements, roomVersionSql, roomSectionsDeletedStatement) instead of campaign_rooms or campaign_room_sections SQL.",
  );
});

test("each listed exception still exists, so the list cannot go stale", () => {
  for (const [file, problems] of EXCEPTIONS) {
    const source = readFileSync(path.join(root, file), "utf8");
    for (const problem of problems)
      assert.ok(
        literals(source).some((sql) => roomSqlProblems(sql).includes(problem)),
        `${file} no longer needs its ${problem} exception; remove it from the list.`,
      );
  }
});
