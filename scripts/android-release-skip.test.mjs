import assert from "node:assert/strict";
import test from "node:test";
import { appVersion, releasedVersionDecision } from "./android-release-skip.mjs";

const before = "a".repeat(40);
const base = { optIn: true, eventName: "push", before, previousVersion: "1.9.1", version: "1.9.1" };

test("a push that leaves an already released APP_VERSION unchanged may skip", () => {
  assert.equal(releasedVersionDecision(base).skip, true);
});

test("version changes, manual runs and unknown history keep the hard release failure", () => {
  for (const changed of [
    { optIn: false },
    { eventName: "workflow_dispatch" },
    { eventName: undefined },
    { previousVersion: "1.9.0" },
    { previousVersion: undefined },
    { before: undefined },
    { before: "0".repeat(40) },
    { before: "not-a-sha" },
  ])
    assert.equal(releasedVersionDecision({ ...base, ...changed }).skip, false, JSON.stringify(changed));
});

test("APP_VERSION is read from version.ts source", () => {
  assert.equal(appVersion('export const APP_VERSION = "1.9.1";'), "1.9.1");
  assert.equal(appVersion("no version"), undefined);
});
