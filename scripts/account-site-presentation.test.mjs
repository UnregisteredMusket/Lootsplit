import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clientKind,
  describeClient,
  parseReleaseIdentity,
} from "../src/lib/website/client-presentation.ts";
import {
  formatGoldCopper,
  parsePublicSpendingSnapshot,
} from "../src/lib/website/public-spending.ts";
import { publishedWebReleases, webReleases } from "../src/lib/website/web-releases.ts";

test("Android browser and packaged preview remain browser clients without a native runtime", () => {
  assert.equal(clientKind(false, "android"), "browser");
  assert.equal(clientKind(false, "web"), "browser");
  assert.equal(clientKind(true, "android"), "android-native");
  assert.equal(clientKind(true, "ios"), "native");
  const browser = describeClient({
    isNative: false,
    platform: "android",
    declaredVersion: "1.6.0",
    installedVersion: "9.9.9",
  });
  assert.deepEqual(browser, {
    kind: "browser",
    label: "Browser",
    version: "1.6.0",
    versionLabel: "Client release label",
  });
});

test("native installed version and unavailable native metadata are labeled honestly", () => {
  const native = describeClient({
    isNative: true,
    platform: "android",
    declaredVersion: "1.6.0",
    installedVersion: "1.5.1",
  });
  assert.equal(native.version, "1.5.1");
  assert.equal(native.versionLabel, "Installed app version");
  const unavailable = describeClient({
    isNative: true,
    platform: "android",
    declaredVersion: "1.6.0",
    installedVersion: " ",
  });
  assert.equal(unavailable.version, "1.6.0");
  assert.equal(unavailable.versionLabel, "Client release label");
});

test("public release identity rejects invalid hashes and projects only public provenance", () => {
  const commit = "fb776325721f940143bc0c1bd3aadb3e147aa95d";
  assert.deepEqual(
    parseReleaseIdentity({
      commit,
      runId: "37661353259",
      token: "do-not-expose",
      room: { private: true },
    }),
    { commit, runId: "37661353259" },
  );
  assert.deepEqual(parseReleaseIdentity({ commit, runId: "local" }), { commit, runId: null });
  assert.deepEqual(parseReleaseIdentity({ commit, runId: "../../private" }), {
    commit,
    runId: null,
  });
  for (const value of [null, [], {}, { commit: "pending" }, { commit: "a".repeat(41) }])
    assert.equal(parseReleaseIdentity(value), null);
});

test("spending presentation preserves exact public integer total and returned metadata only", () => {
  const asOf = Date.UTC(2026, 9, 7);
  const value = {
    version: 1,
    asOf,
    scope: "current-shared-campaigns",
    metrics: { spentCopper: 301, debtCopper: 900, playerCharacters: 3 },
    privateCampaigns: ["not-public"],
  };
  const before = structuredClone(value);
  assert.deepEqual(parsePublicSpendingSnapshot(value), {
    spentCopper: 301,
    asOf,
    scope: "current-shared-campaigns",
  });
  assert.deepEqual(value, before);
  assert.deepEqual(parsePublicSpendingSnapshot({ metrics: { spentCopper: 0 } }), {
    spentCopper: 0,
    asOf: null,
    scope: null,
  });
  assert.deepEqual(
    parsePublicSpendingSnapshot({
      metrics: { spentCopper: 1 },
      asOf: "today",
      scope: "all-accounts",
    }),
    { spentCopper: 1, asOf: null, scope: null },
  );
});

test("unavailable, negative and unsafe totals cannot become a misleading zero", () => {
  for (const value of [
    null,
    [],
    {},
    { metrics: {} },
    { metrics: { spentCopper: -1 } },
    { metrics: { spentCopper: "0" } },
    { metrics: { spentCopper: 1.5 } },
    { metrics: { spentCopper: Number.MAX_SAFE_INTEGER + 1 } },
  ])
    assert.throws(() => parsePublicSpendingSnapshot(value), /Invalid total/);
  assert.equal(formatGoldCopper(0), "0");
  assert.equal(formatGoldCopper(1), "0.01");
  assert.equal(formatGoldCopper(10), "0.1");
  assert.equal(formatGoldCopper(301), "3.01");
  assert.equal(formatGoldCopper(Number.MAX_SAFE_INTEGER), "90,071,992,547,409.91");
});

test("web publication history remains separate from Android versioning and hides planned candidates", () => {
  const published = publishedWebReleases(webReleases);
  assert.ok(published.length > 0);
  for (const entry of published) {
    assert.match(entry.commit, /^[a-f0-9]{40}$/);
    assert.equal(new Date(`${entry.date}T00:00:00Z`).toISOString().slice(0, 10), entry.date);
    assert.ok(entry.evidence.some((item) => item.label === "Publication and live checks"));
    assert.ok(entry.improvements.length > 0);
    assert.equal("versionCode" in entry, false);
  }
  const planned = {
    ...published[0],
    id: "future-candidate",
    status: "planned",
    date: "2099-01-01",
  };
  const input = [...webReleases, planned];
  const before = structuredClone(input);
  assert.deepEqual(publishedWebReleases(input), published);
  assert.deepEqual(input, before);
});
