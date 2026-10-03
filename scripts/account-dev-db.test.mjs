import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { localAccountDb } from "./account-dev-db.mjs";

test("local browser fixtures wait for another process's short database write", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lootsplit-db-lock-"));
  const filename = join(dir, "test.sqlite");
  const db = localAccountDb(filename);
  db.exec("CREATE TABLE contention_probe (id INTEGER PRIMARY KEY, value INTEGER); INSERT INTO contention_probe VALUES (1, 0)");
  const worker = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(workerData);
    db.exec("BEGIN IMMEDIATE; UPDATE contention_probe SET value=1 WHERE id=1");
    parentPort.postMessage("locked");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    db.exec("COMMIT"); db.close();
  `, { eval: true, workerData: filename });
  try {
    await once(worker, "message");
    await db.prepare("UPDATE contention_probe SET value=value+1 WHERE id=1").run();
    assert.equal((await db.prepare("SELECT value FROM contention_probe WHERE id=1").first()).value, 2);
  } finally {
    await worker.terminate();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
