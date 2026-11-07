import test from "node:test";
import assert from "node:assert/strict";
import { drawsBeforeAccountCheck, isGatePublicPath } from "./public-gate.ts";

const website = [
  "/welcome",
  "/features",
  "/downloads",
  "/updates",
  "/help",
  "/resources",
  "/donate",
  "/privacy",
  "/community",
  "/community/some-table",
];

test("public website pages draw before the account check (QA pass 2026-11)", () => {
  for (const path of website) {
    assert.equal(isGatePublicPath(path), true, path);
    assert.equal(drawsBeforeAccountCheck(path, false), true, path);
  }
  assert.equal(drawsBeforeAccountCheck("/no-such-page", true), true, "not-found page");
});

test("My account is let through but still waits, because it reads the campaign providers", () => {
  assert.equal(isGatePublicPath("/account"), true);
  assert.equal(drawsBeforeAccountCheck("/account", false), false);
});

test("campaign pages keep waiting for the account check", () => {
  for (const path of [
    "/",
    "/settings",
    "/characters",
    "/encounters",
    "/party",
    "/market",
    "/catalog",
    "/share",
    "/features/factions",
    "/library",
  ]) {
    assert.equal(isGatePublicPath(path), false, path);
    assert.equal(drawsBeforeAccountCheck(path, false), false, path);
  }
});

test("one trailing slash on a public page draws at once too, like the root layout", () => {
  for (const path of website) {
    const slashed = `${path}/`;
    assert.equal(isGatePublicPath(slashed), true, slashed);
    assert.equal(drawsBeforeAccountCheck(slashed, false), true, slashed);
  }
  // My account with a slash is let through but still waits for the providers.
  assert.equal(isGatePublicPath("/account/"), true);
  assert.equal(drawsBeforeAccountCheck("/account/", false), false);
});

test("matching stays exact apart from one trailing slash", () => {
  for (const path of [
    "/WELCOME",
    "/Welcome/",
    "/welcome//",
    "/welcome/x",
    "/welcome%2F",
    "/%77elcome",
    "/welcome%20",
    "//welcome",
    "/welcome.",
    "/features/factions/",
    "/settings/",
    "/",
    "",
  ]) {
    assert.equal(drawsBeforeAccountCheck(path, false), false, path);
  }
  for (const path of ["/WELCOME", "/welcome//", "/welcome/x", "/welcome%2F", "/settings/", "/"])
    assert.equal(isGatePublicPath(path), false, path);
});
