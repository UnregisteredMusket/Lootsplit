// Audit G10 (backup has its own queue; backups and releases wait for each other, never forever)
// and G13 (a backup validates against the live commit's migrations, not the checkout's).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  BACKUP_EXPORT_STEP,
  BACKUP_JOB,
  exportingBackups,
  runningReleases,
  waitWhileBusy,
} from "./production-lane.mjs";
import { liveSource, migrationIdentityAt } from "./standby-backup.mjs";
import { migrationIdentity } from "./standby-artifact.mjs";

const workflow = (file) => readFileSync(`.github/workflows/${file}`, "utf8");

test("the backup has its own concurrency group, so it can never cancel a pending deploy", () => {
  const group = (text) => /concurrency:\n\s+group: (\S+)\n\s+cancel-in-progress: false/.exec(text)?.[1];
  assert.equal(group(workflow("website-release.yml")), "lootsplit-production");
  assert.equal(group(workflow("standby-backup.yml")), "lootsplit-backup");
});

test("the backup waits for releases before exporting; a release waits for a running export first", () => {
  const backup = workflow("standby-backup.yml");
  const wait = backup.indexOf("node scripts/production-lane.mjs wait-for-release");
  const exportStep = backup.indexOf(`- name: ${BACKUP_EXPORT_STEP}\n`);
  assert.ok(wait > 0 && exportStep > wait, "wait step comes right before the export step");
  assert.match(backup, new RegExp(`\\n  ${BACKUP_JOB}:\\n`));
  assert.match(backup, /\n {2}actions: read\n/);
  const release = workflow("website-release.yml");
  const waitExport = release.indexOf("node scripts/production-lane.mjs wait-for-backup-export");
  assert.ok(waitExport > 0);
  assert.ok(waitExport < release.indexOf("node scripts/release-current.mjs"));
  assert.ok(waitExport < release.indexOf("production-migrations.mjs"));
});

const api = (routes) => async (path) => {
  for (const [pattern, value] of routes) if (path.includes(pattern)) return value;
  throw Error(`unexpected ${path}`);
};

test("only an in-progress release blocks a backup; only a running export step blocks a release", async () => {
  assert.deepEqual(
    (
      await runningReleases(
        api([["website-release.yml/runs?status=in_progress", { workflow_runs: [{ id: 1, status: "in_progress" }] }]]),
      )
    ).map((r) => r.id),
    [1],
  );
  const backups = { workflow_runs: [{ id: 5, status: "in_progress", run_attempt: 1 }] };
  const jobs = (status) => ({
    jobs: [{ name: BACKUP_JOB, steps: [{ name: "Wait for a running website release", status: "completed" }, { name: BACKUP_EXPORT_STEP, status }] }],
  });
  const exporting = (status) =>
    exportingBackups(api([["standby-backup.yml/runs", backups], ["/runs/5/attempts/1/jobs", jobs(status)]]));
  assert.deepEqual((await exporting("in_progress")).map((r) => r.id), [5]);
  // A backup still waiting for releases (its export step queued) does not block the release.
  assert.deepEqual(await exporting("queued"), []);
  assert.deepEqual(await exporting("completed"), []);
  await assert.rejects(runningReleases(api([["runs", {}]])), /Unreadable/);
});

test("waits are bounded and never proceed on unreadable data", async () => {
  let clock = 0;
  const timing = { now: () => clock, pause: async (ms) => void (clock += ms), log: () => {} };
  let calls = 0;
  const done = await waitWhileBusy({ ...timing, timeoutMs: 60000, message: "x", busy: async () => (++calls < 3 ? [{ id: 9 }] : []) });
  assert.equal(done.waitedMs, 40000);
  await assert.rejects(waitWhileBusy({ ...timing, timeoutMs: 30000, message: "still busy", busy: async () => [{ id: 9 }] }), /still busy \(still running: 9\)/);
  await assert.rejects(waitWhileBusy({ ...timing, timeoutMs: 30000, message: "x", busy: async () => { throw Error("GitHub down"); } }), /GitHub down/);
});

// G13: a snapshot of a database at the live commit's migrations, taken while main already holds a
// newer, undeployed migration, used to fail because it was compared with the checkout.
const sha = (c) => c.repeat(40);
const dump = (names) => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT)");
  for (const name of names) db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
  const rows = db.prepare("SELECT name FROM d1_migrations ORDER BY id").all();
  db.close();
  return "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT);\n" + rows.map((r, i) => `INSERT INTO d1_migrations VALUES (${i + 1}, '${r.name}');`).join("\n");
};

test("a backup validates against the live commit's migrations, not a newer checkout (audit G13)", () => {
  const checkout = migrationIdentity().migrations;
  const live = checkout.slice(0, -1); // main has one migration the live commit does not
  const identities = { [sha("a")]: { migrations: live, migrationsHash: "live" }, [sha("b")]: { migrations: checkout, migrationsHash: "main" } };
  const at = (commit) => identities[commit];
  const sql = dump(live);
  assert.deepEqual(liveSource(sql, [sha("a"), sha("a")], at), { commit: sha("a"), expected: identities[sha("a")] });
  // A release finished during the export: the snapshot matches the commit live before or after.
  assert.equal(liveSource(dump(checkout), [sha("a"), sha("b")], at).commit, sha("b"));
  // Migrations applied but the new Worker not live yet: matches no live commit, nothing is stored.
  assert.throws(() => liveSource(dump(checkout), [sha("a"), sha("a")], at), /match no live commit/);
});

test("the live commit's migrations are read from git with the checkout's hash format", () => {
  const head = "c".repeat(40);
  const files = Object.fromEntries(migrationIdentity().migrations.map((n) => [n, readFileSync(`cloudflare/migrations/${n}`, "utf8")]));
  const calls = [];
  const git = (args) => {
    calls.push(args[0]);
    if (args[0] === "cat-file") throw Error("missing in shallow clone");
    if (args[0] === "fetch") return "";
    if (args[0] === "ls-tree") return Object.keys(files).reverse().map((n) => `cloudflare/migrations/${n}`).join("\n") + "\ncloudflare/migrations/README.md\n";
    if (args[0] === "show") return files[args[1].slice(args[1].lastIndexOf("/") + 1)];
    throw Error(args.join(" "));
  };
  assert.deepEqual(migrationIdentityAt(head, git), migrationIdentity());
  assert.deepEqual(calls.slice(0, 3), ["cat-file", "fetch", "ls-tree"]);
  assert.throws(() => migrationIdentityAt("main", git), /full commit SHA/);
});
