import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = "dist/website-release";
export function fileHashes(directory, prefix = "") {
  return Object.fromEntries(readdirSync(join(directory, prefix), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const name = prefix + entry.name;
      assert.ok(!entry.isSymbolicLink(), `Symlinks are not release files: ${name}`);
      if (entry.isDirectory()) return Object.entries(fileHashes(directory, name + "/"));
      if (name === "manifest.json") return [];
      return [[name, createHash("sha256").update(readFileSync(join(directory, name))).digest("hex")]];
    }));
}
export function verifyArtifact(directory, expectedSha) {
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  assert.equal(manifest.commit, expectedSha, "Artifact is from a different commit");
  assert.deepEqual(fileHashes(directory), manifest.files, "Verified release files changed");
  return manifest;
}

if (process.argv[1]?.endsWith("/release-artifact.mjs")) {
  const mode = process.argv[2];
  const commit = process.env.RELEASE_SHA || process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.match(commit, /^[a-f0-9]{40}$/);
  if (mode === "prepare") {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    // Vite has already built once. Wrangler produces the final uploadable bundle once.
    execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "deploy", "--dry-run", "--outdir", `${root}/worker`], { stdio: "inherit" });
    cpSync("dist/client", `${root}/assets`, { recursive: true });
    cpSync("cloudflare/migrations", `${root}/migrations`, { recursive: true });
    const config = readFileSync("wrangler.toml", "utf8")
      .replace('main = "cloudflare/worker.mjs"', 'main = "worker/worker.js"\nno_bundle = true\nkeep_vars = true')
      .replace('directory = "./dist/client"', 'directory = "./assets"')
      .replace('migrations_dir = "cloudflare/migrations"', 'migrations_dir = "migrations"');
    assert.ok(config.includes('no_bundle = true'));
    writeFileSync(`${root}/wrangler.toml`, config);
    writeFileSync(`${root}/assets/assets/release-identity.json`, JSON.stringify({ commit, runId: process.env.GITHUB_RUN_ID || "local" }) + "\n");
    writeFileSync(`${root}/manifest.json`, JSON.stringify({ commit, files: fileHashes(root) }, null, 2) + "\n");
  } else if (mode !== "verify") throw new Error("Use prepare or verify");
  const manifest = verifyArtifact(root, commit);
  console.log(`Verified ${Object.keys(manifest.files).length} release files for ${commit}`);
}
