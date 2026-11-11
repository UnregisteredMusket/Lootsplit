import test from "node:test";
import assert from "node:assert/strict";
import { gateAccess, identityFailure } from "./gate-access.ts";

// Audit 2026-11-10 D1: one failed account check (deploy 503, captive Wi-Fi, a 429 from the
// per-address limit a table shares) replaced a signed-in DM's campaign with Welcome and deleted
// the offline-owner marker. Only a positive "no session" may do that now.

const owner = "user-dm";

test("a check that could not finish keeps device-owner access and the marker", () => {
  for (const error of [
    Object.assign(new Error("Service unavailable"), { status: 503 }),
    Object.assign(new Error("Too many requests"), { status: 429 }),
    Object.assign(new Error("Internal error"), { status: 500 }),
    new TypeError("Failed to fetch"),
    new Error("The account service returned an unreadable response."),
  ]) {
    const check = identityFailure(error);
    assert.deepEqual(check, { kind: "unknown" }, String(error));
    const access = gateAccess({ check, owner, marker: owner });
    assert.equal(access.owned, true);
    assert.equal(access.marker, undefined, "the offline-owner marker is left as it is");
    assert.equal(access.verified, owner);
    assert.equal(access.unchecked, true, "the gate says so, offers Retry and checks again");
  }
});

test("an unfinished check grants nothing to a device that was never verified for this owner", () => {
  const unknown = identityFailure(Object.assign(new Error("x"), { status: 503 }));
  for (const [campaignOwner, marker] of [
    [owner, null],
    [owner, "someone-else"],
    [null, owner],
  ] as const) {
    const access = gateAccess({ check: unknown, owner: campaignOwner, marker });
    assert.equal(access.owned, false);
    assert.equal(access.verified, undefined);
    assert.equal(access.marker, undefined);
    assert.equal(access.unchecked, true);
  }
});

test("401 and 403 are a positive sign-out: Welcome, and the marker is forgotten", () => {
  for (const status of [401, 403]) {
    const check = identityFailure(Object.assign(new Error("Sign in"), { status }));
    assert.deepEqual(check, { kind: "signed-out" });
    assert.deepEqual(gateAccess({ check, owner, marker: owner }), {
      verified: null,
      marker: null,
      owned: false,
      unchecked: false,
    });
  }
  // A 200 with no user is the same answer.
  assert.equal(gateAccess({ check: { kind: "signed-out" }, owner, marker: owner }).owned, false);
});

test("a verified account owns its campaign and refreshes the marker", () => {
  assert.deepEqual(gateAccess({ check: { kind: "signed-in", userId: owner }, owner, marker: null }), {
    verified: owner,
    marker: owner,
    owned: true,
    unchecked: false,
  });
  const other = gateAccess({ check: { kind: "signed-in", userId: "user-b" }, owner, marker: owner });
  assert.equal(other.owned, false);
  assert.equal(other.marker, "user-b");
});
