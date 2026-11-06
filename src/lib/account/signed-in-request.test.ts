import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { savingMembership, subscribeMembershipSave, whileSavingMembership } from "./membership-save.ts";

// client.ts needs the browser build (import.meta.env, Capacitor); run its two guard functions alone.
const source = readFileSync(new URL("./client.ts", import.meta.url), "utf8");
const body = source.slice(
  source.indexOf("export function accountSessionKnown()"),
  source.indexOf("async function accountRequestCore<T>("),
);
function guards(verified: string | null) {
  const sent: string[] = [];
  const sessionStorage = { getItem: (key: string) => (key === "lootsplit.verified-account" ? verified : null) };
  const accountRequest = async (path: string) => {
    sent.push(path);
    return { ok: true };
  };
  const make = new Function(
    "sessionStorage",
    "accountRequest",
    stripTypeScriptTypes(body.replaceAll("export function", "function")) +
      "; return { accountSessionKnown, signedInAccountRequest };",
  );
  return { sent, ...make(sessionStorage, accountRequest) };
}

test("signed-out guests skip account-only reads with a 401-style error (QA pass 2026-11)", async () => {
  const guest = guards(null);
  assert.equal(guest.accountSessionKnown(), false);
  await assert.rejects(guest.signedInAccountRequest("encounters"), (e: { status?: number; message: string }) => {
    assert.equal(e.status, 401);
    // Screens that hide "sign in" errors (Characters) keep hiding this one.
    assert.match(e.message, /sign in/i);
    return true;
  });
  assert.deepEqual(guest.sent, [], "no request leaves the browser");
});

test("signed-in visitors still send the read", async () => {
  const member = guards("user-1");
  assert.equal(member.accountSessionKnown(), true);
  assert.deepEqual(await member.signedInAccountRequest("encounters"), { ok: true });
  assert.deepEqual(member.sent, ["encounters"]);
});

test("account reads wait while a new room is saved to My account, then are told to read", async () => {
  let notified = 0;
  const stop = subscribeMembershipSave(() => notified++);
  let during = false;
  await whileSavingMembership(async () => {
    during = savingMembership();
  });
  assert.equal(during, true);
  assert.equal(savingMembership(), false);
  assert.equal(notified, 2, "start and end are announced");
  await assert.rejects(
    whileSavingMembership(async () => {
      throw new Error("link failed");
    }),
  );
  assert.equal(savingMembership(), false, "a failed save never leaves reads waiting");
  stop();
});
