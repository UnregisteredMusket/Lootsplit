import assert from "node:assert/strict";
import test from "node:test";
import { sealPassword, passwordMatches, lockFile, unlockFile, readSeatLock } from "./lock.ts";
test("new passwords and encrypted backups use a stretched key and round-trip", async () => {
  const lock = await sealPassword("audit-password", true);
  assert.equal(lock.iterations, 210000);
  assert.equal(await passwordMatches("audit-password", lock), true);
  assert.equal(await passwordMatches("wrong-password", lock), false);
  const file = await lockFile({ test: "preserved" }, "audit-password", lock.salt);
  assert.deepEqual(await unlockFile(file, "audit-password"), { test: "preserved" });
  await assert.rejects(unlockFile(file, "wrong-password"), /password/);
  assert.equal(readSeatLock(lock)?.iterations, 210000);
});
test("legacy SHA-256 password hashes remain verifiable", async () => {
  const salt = "00112233445566778899aabbccddeeff";
  const hash = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}\nold-password`)),
  ).toString("hex");
  assert.equal(await passwordMatches("old-password", { salt, hash, protectSaves: false }), true);
});
