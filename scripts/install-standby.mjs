// Render installs the immutable GitHub-tested release. It never rebuilds Vite.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const sha = process.env.STANDBY_RELEASE_SHA;
assert.match(sha || "", /^[a-f0-9]{40}$/, "Set STANDBY_RELEASE_SHA to a published, verified main release");
const url = `https://github.com/UnregisteredMusket/Lootsplit/releases/download/standby-${sha}/standby-${sha}.tar.gz`;
const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
assert.ok(response.ok, `Verified release unavailable (${response.status})`);
mkdirSync("dist", { recursive: true });
const archive = "dist/standby-download.tar.gz";
writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
try {
  const names = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
  assert.ok(names.every((name) => name.startsWith("standby-release/") && !name.split("/").includes("..")), "Unexpected archive paths");
  const entries = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8" }).trim().split("\n");
  assert.ok(entries.every((entry) => ["d", "-"].includes(entry[0])), "Links are not allowed in a release");
  rmSync("dist/standby-release", { recursive: true, force: true });
  execFileSync("tar", ["-xzf", archive, "-C", "dist", "--no-same-owner", "--no-same-permissions"]);
  const root = "dist/standby-release", manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.commit, sha);
  function hashes(prefix = "") {
    return Object.fromEntries(readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
      const name = prefix + entry.name;
      assert.ok(!entry.isSymbolicLink());
      if (entry.isDirectory()) return Object.entries(hashes(name + "/"));
      return name === "manifest.json" ? [] : [[name, createHash("sha256").update(readFileSync(join(root, name))).digest("hex")]];
    }));
  }
  assert.deepEqual(hashes(), manifest.files, "Standby release checksum mismatch");
  console.log(`Installed verified standby ${sha}`);
} finally { rmSync(archive, { force: true }); }
