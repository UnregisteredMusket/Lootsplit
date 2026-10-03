import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileHashes, verifyArtifact } from "./release-artifact.mjs";

export function migrationIdentity() {
  const migrations = readdirSync("cloudflare/migrations").filter((name) => name.endsWith(".sql")).sort();
  const migrationsHash = createHash("sha256").update(JSON.stringify(migrations.map((name) => [name, readFileSync(`cloudflare/migrations/${name}`, "utf8")]))).digest("hex");
  return { migrations, migrationsHash };
}
if (process.argv[1]?.endsWith("/standby-artifact.mjs")) {
  const root = "dist/standby-release";
  const commit = process.env.RELEASE_SHA || process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (process.argv[2] === "prepare") {
    verifyArtifact("dist/website-release", commit);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(`${root}/runtime`, { recursive: true });
    // Reuse precisely the Worker and client already under audit; no second app build.
    cpSync("dist/website-release/worker", `${root}/worker`, { recursive: true });
    cpSync("dist/website-release/assets", `${root}/assets`, { recursive: true });
    await build({ entryPoints: ["standby/server.mjs"], outfile: `${root}/runtime/server.mjs`, bundle: true, platform: "node", format: "esm", target: "node22", external: ["../worker/worker.js"], banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
    writeFileSync(`${root}/package.json`, '{"type":"module","private":true}\n');
    cpSync("standby/Dockerfile", `${root}/Dockerfile`);
    cpSync("standby/.dockerignore", `${root}/.dockerignore`);
    writeFileSync(`${root}/manifest.json`, JSON.stringify({ commit, ...migrationIdentity(), files: fileHashes(root) }, null, 2) + "\n");
  } else if (process.argv[2] !== "verify") throw new Error("Use prepare or verify");
  verifyArtifact(root, commit);
  console.log(`Verified portable standby for ${commit}`);
}
