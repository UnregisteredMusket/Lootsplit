import test from "node:test";
import assert from "node:assert/strict";
import { rememberSessionName, takeSessionName, forgetSessionName } from "./session-name-draft.ts";

test("explicit downtime handoff consumes its name only in the same campaign/account scope", () => {
  rememberSessionName("owner-a:campaign-a", "Return to the gate");
  assert.equal(takeSessionName("owner-b:campaign-a"), "");
  assert.equal(takeSessionName("owner-a:campaign-b"), "");
  assert.equal(takeSessionName("owner-a:campaign-a"), "Return to the gate");
  assert.equal(takeSessionName("owner-a:campaign-a"), "");
});

test("completed or interrupted handoff cannot revive a forgotten name", () => {
  rememberSessionName("guest:campaign-c", "An unsaved session");
  forgetSessionName("guest:campaign-c");
  assert.equal(takeSessionName("guest:campaign-c"), "");
});
