import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bounded, fontsOnly, missingPackages, parseDryRun, unlocatable } from "./ci-chromium-install.mjs";

const dryRun =
  'sudo -- sh -c "apt-get update&& apt-get install -y --no-install-recommends libasound2t64 libnss3 xvfb fonts-liberation"\n';

test("reads Playwright's own dependency check, current and earlier formats", () => {
  // Playwright 1.63+: an apt simulation reports exactly what is missing.
  assert.deepEqual(parseDryRun("All system dependencies are installed.\n"), { missing: [] });
  assert.deepEqual(
    parseDryRun("Missing system dependencies (2):\n  fonts-wqy-zenhei\n  xvfb\n"),
    { missing: ["fonts-wqy-zenhei", "xvfb"] },
  );
  // Earlier versions print the install command; its list is checked with dpkg.
  assert.deepEqual(parseDryRun(dryRun), { packages: ["libasound2t64", "libnss3", "xvfb", "fonts-liberation"] });
  assert.equal(parseDryRun("Error: 'apt-get install -s' exited with code 100"), null);
  assert.throws(() => parseDryRun('sh -c "apt-get install -y --no-install-recommends ok $(evil)"'), /Unexpected package/);
  assert.throws(() => parseDryRun("Missing system dependencies (1):\n  $(evil)\n"), /Unexpected package/);
});

test("only packages dpkg reports installed (ii) are skipped", () => {
  const { packages } = parseDryRun(dryRun);
  const dpkg = "libasound2t64 ii \nlibnss3 rc \nxvfb un \n";
  assert.deepEqual(missingPackages(packages, dpkg), ["libnss3", "xvfb", "fonts-liberation"]);
  assert.deepEqual(missingPackages(["libnss3"], "libnss3:amd64 ii \n"), []);
  assert.deepEqual(missingPackages(packages, ""), packages);
});

test("each install phase has a deadline and one retry, then fails loudly", () => {
  const calls = [];
  const flaky = (results) => (command, args, options) => {
    calls.push(options.timeout);
    return results.shift();
  };
  assert.equal(typeof bounded("x", "cmd", [], { seconds: 5, run: flaky([{ status: 0 }]) }), "number");
  bounded("x", "cmd", [], { seconds: 5, run: flaky([{ status: null, error: { code: "ETIMEDOUT" } }, { status: 0 }]) });
  assert.throws(
    () => bounded("apt", "cmd", [], { seconds: 5, run: flaky([{ status: 1 }, { status: 1 }]) }),
    /apt failed after 2 attempts/,
  );
  assert.ok(calls.every((ms) => ms === 5000));
});

test("browser jobs install Chromium through the cached, separately bounded step", () => {
  const action = readFileSync(".github/actions/playwright-chromium/action.yml", "utf8");
  for (const use of action.matchAll(/uses: (\S+)/g)) assert.match(use[1], /@[0-9a-f]{40}$/, "actions pinned by SHA");
  assert.match(action, /key: playwright-headless-shell-.*steps\.version\.outputs\.playwright/);
  for (const name of ["verify.yml", "player-reference-audit.yml", "android-widget.yml", "website-release.yml", "verify-live.yml", "product-screenshots.yml", "code-health.yml"]) {
    const workflow = readFileSync(`.github/workflows/${name}`, "utf8");
    assert.doesNotMatch(workflow, /playwright install --with-deps/, name);
    const steps = [...workflow.matchAll(/- name: Install Chromium for Playwright\n\s+timeout-minutes: (\d+)\n\s+uses: \.\/\.github\/actions\/playwright-chromium/g)];
    assert.ok(steps.length > 0, name);
    for (const [, minutes] of steps) assert.equal(Number(minutes), 12, name);
  }
});

test("only optional font packages may be skipped when the mirror cannot supply them", () => {
  assert.equal(fontsOnly(["fonts-freefont-ttf", "xfonts-scalable", "fonts-unifont"]), true);
  assert.equal(fontsOnly(["fonts-liberation", "libnss3"]), false);
  assert.equal(fontsOnly([]), false);
});

test("without package lists, apt's unlocatable packages are the missing ones", () => {
  // Playwright 1.63's dry run, run on a runner whose apt-get update could not reach the archive.
  const output =
    "Error: 'apt-get install -s' exited with code 100:\nReading package lists...\nE: Unable to locate package fonts-unifont\nE: Unable to locate package xfonts-utils\n    at reportMissingDependenciesLinux\n";
  assert.deepEqual(unlocatable(output), ["fonts-unifont", "xfonts-utils"]);
  assert.equal(fontsOnly(unlocatable(output)), true);
  assert.deepEqual(unlocatable("E: Unable to locate package libnss3\n"), ["libnss3"]);
  assert.equal(fontsOnly(unlocatable("E: Unable to locate package libnss3\n")), false);
  // Any other apt error means nothing is known.
  assert.equal(unlocatable("E: Could not get lock /var/lib/apt/lists/lock\nE: Unable to locate package fonts-unifont\n"), null);
  assert.equal(unlocatable("Reading package lists...\n"), null);
  assert.throws(() => unlocatable("E: Unable to locate package $(evil)\n"), /Unexpected package/);
});
