import assert from "node:assert/strict";
import test from "node:test";
import { androidReleaseState, ghApi } from "./android-release-lookup.mjs";

const repo = "example/lootsplit";
const androidTags = ["android-v1.17.0", "android-v1.18.0", "android-v1.19.0"];

// A repository like production: one standby-<sha> prerelease per main commit, so page one of
// the release list (100 entries) holds only standby releases and every Android release is on
// a later page.
function githubWith({ tags = androidTags } = {}) {
  const standby = Array.from({ length: 100 }, (_, i) => ({
    tag_name: `standby-${String(i).padStart(40, "0")}`,
    prerelease: true,
  }));
  const later = tags.map((tag_name) => ({ tag_name, prerelease: false }));
  const paths = [];
  const api = (path, { paginate = false } = {}) => {
    paths.push(path);
    if (/\/releases\?per_page=100$/.test(path)) return paginate ? [standby, later] : standby;
    if (/\/releases\?per_page=100&page=2$/.test(path)) return later;
    const byTag = path.match(/\/releases\/tags\/(.+)$/);
    if (byTag) {
      if (tags.includes(byTag[1])) return { tag_name: byTag[1], prerelease: false };
      throw Object.assign(Error("gh: Not Found (HTTP 404)"), { status: 404 });
    }
    if (path.endsWith("/git/matching-refs/tags/android-v")) {
      const refs = tags.map((tag) => ({ ref: `refs/tags/${tag}` }));
      return paginate ? [refs] : refs;
    }
    throw Error(`unexpected path ${path}`);
  };
  return { api, paths };
}

test("an Android release beyond the first page of releases is still found", () => {
  const { api } = githubWith();
  assert.equal(androidReleaseState({ api, repo, version: "1.19.0" }).released, true);
});

test("every published Android tag is returned for the versionCode check", () => {
  const { api } = githubWith();
  assert.deepEqual(
    androidReleaseState({ api, repo, version: "1.20.0" }).publishedTags.sort(),
    androidTags,
  );
});

test("an unreleased version is reported as not released (404 on the tag lookup)", () => {
  const { api } = githubWith();
  assert.equal(androidReleaseState({ api, repo, version: "1.20.0" }).released, false);
});

test("the release list is not read; the tag is looked up directly", () => {
  const { api, paths } = githubWith();
  androidReleaseState({ api, repo, version: "1.19.0" });
  assert.ok(paths.includes(`repos/${repo}/releases/tags/android-v1.19.0`));
  assert.ok(!paths.some((path) => /\/releases\?/.test(path)), paths.join("\n"));
});

test("any lookup failure other than 404 stops the check instead of counting as not released", () => {
  const api = (path) => {
    if (path.includes("/releases/tags/"))
      throw Object.assign(Error("gh: Server Error (HTTP 502)"), { status: 502 });
    return [[]];
  };
  assert.throws(() => androidReleaseState({ api, repo, version: "1.20.0" }), /HTTP 502/);
});

test("gh api failures carry their HTTP status; pagination uses --paginate --slurp", () => {
  const calls = [];
  const fakeExec = (file, args) => {
    calls.push([file, ...args]);
    if (args.at(-1).includes("/releases/tags/"))
      throw Object.assign(Error("Command failed"), { stderr: "gh: Not Found (HTTP 404)\n" });
    return '[[{"ref":"refs/tags/android-v1.19.0"}]]';
  };
  const api = ghApi(fakeExec);
  assert.deepEqual(androidReleaseState({ api, repo, version: "1.20.0" }), {
    released: false,
    publishedTags: ["android-v1.19.0"],
  });
  assert.deepEqual(calls[1], [
    "gh",
    "api",
    "--paginate",
    "--slurp",
    `repos/${repo}/git/matching-refs/tags/android-v`,
  ]);
});
