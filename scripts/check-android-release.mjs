import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const version = readFileSync("src/lib/quire/version.ts", "utf8").match(
  /APP_VERSION = "([^"]+)"/,
)?.[1];
const gradle = readFileSync("android/app/build.gradle", "utf8");
const code = Number(gradle.match(/versionCode (\d+)/)?.[1]);
if (
  !version ||
  !/^\d+\.\d+\.\d+$/.test(version) ||
  !gradle.includes(`versionName "${version}"`) ||
  !Number.isSafeInteger(code) ||
  code < 1
)
  throw Error("Android and app release versions must match.");
const versionCommit = execFileSync("git", ["log", "-1", "--format=%H", "--", "src/lib/quire/version.ts"], { encoding: "utf8" }).trim();
const previousSource = execFileSync("git", ["show", `${versionCommit}^:android/app/build.gradle`], { encoding: "utf8" });
const previousCode = Number(previousSource.match(/versionCode (\d+)/)?.[1]);
if (code <= previousCode) throw Error("Increase Android versionCode for a newly distributed update.");
const repo = process.env.GITHUB_REPOSITORY;
if (!repo) throw Error("Release validation requires GitHub Actions context.");
const releases = JSON.parse(
  execFileSync("gh", ["api", `repos/${repo}/releases?per_page=100`], { encoding: "utf8" }),
);
if (releases.some((r) => r.tag_name === `android-v${version}`))
  throw Error(
    "This version already has a release. Increase both versions; do not overwrite released APKs.",
  );
for (const release of releases.filter((r) => /^android-v/.test(r.tag_name))) {
  const previous = execFileSync("git", ["show", `${release.tag_name}:android/app/build.gradle`], {
    encoding: "utf8",
  });
  const oldCode = Number(previous.match(/versionCode (\d+)/)?.[1]);
  if (code <= oldCode)
    throw Error("Android versionCode must increase beyond every published release.");
}
console.log(`Validated Android ${version}, version code ${code}`);
