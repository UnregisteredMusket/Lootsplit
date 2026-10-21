import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { validateWebsiteChangelog } from "./website-changelog.mjs";
import { appVersion, releasedVersionDecision } from "./android-release-skip.mjs";
// --skip-released-unchanged: a push that did not change APP_VERSION (for example a
// workflow-only edit) may finish successfully without publishing when that version is
// already released. Manual runs and version changes keep the hard "already released" failure.
const skipReleasedUnchanged = process.argv.includes("--skip-released-unchanged");
const version = appVersion(readFileSync("src/lib/quire/version.ts", "utf8"));
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
validateWebsiteChangelog(
  JSON.parse(readFileSync("src/lib/website/changelog.json", "utf8")),
  version,
);
const versionCommit = execFileSync(
  "git",
  ["log", "-1", "--format=%H", "--", "src/lib/quire/version.ts"],
  { encoding: "utf8" },
).trim();
const previousSource = execFileSync("git", ["show", `${versionCommit}^:android/app/build.gradle`], {
  encoding: "utf8",
});
const previousCode = Number(previousSource.match(/versionCode (\d+)/)?.[1]);
if (code <= previousCode)
  throw Error("Increase Android versionCode for a newly distributed update.");
const repo = process.env.GITHUB_REPOSITORY;
if (!repo) throw Error("Release validation requires GitHub Actions context.");
const releases = JSON.parse(
  execFileSync("gh", ["api", `repos/${repo}/releases?per_page=100`], { encoding: "utf8" }),
);
if (releases.some((r) => r.tag_name === `android-v${version}`)) {
  const decision = releasedVersionDecision({
    optIn: skipReleasedUnchanged,
    eventName: process.env.GITHUB_EVENT_NAME,
    before: pushBefore(),
    previousVersion: versionAt(pushBefore()),
    version,
  });
  if (decision.skip) {
    console.log(
      `::notice::Android ${version} is already released as android-v${version} and this ${decision.reason}; skipping signing and publication.`,
    );
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "skip=true\n");
    process.exit(0);
  }
  console.log(`Released-version skip not allowed: ${decision.reason}.`);
  throw Error(
    "This version already has a release. Increase both versions; do not overwrite released APKs.",
  );
}
for (const release of releases.filter((r) => /^android-v/.test(r.tag_name))) {
  const previous = execFileSync("git", ["show", `${release.tag_name}:android/app/build.gradle`], {
    encoding: "utf8",
  });
  const oldCode = Number(previous.match(/versionCode (\d+)/)?.[1]);
  if (code <= oldCode)
    throw Error("Android versionCode must increase beyond every published release.");
}
console.log(`Validated Android ${version}, version code ${code}`);

function pushBefore() {
  if (!process.env.GITHUB_EVENT_PATH) return undefined;
  try {
    return JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).before;
  } catch {
    return undefined;
  }
}

function versionAt(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit || "") || /^0+$/.test(commit)) return undefined;
  try {
    return appVersion(
      execFileSync("git", ["show", `${commit}:src/lib/quire/version.ts`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return undefined;
  }
}
