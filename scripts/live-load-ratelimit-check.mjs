// Live-campaign load audit, shared-IP check (owner request, 2026-10-28). A DM running a combat
// with the TV display controller open (encounters/detail every 2 s, player-display-controller.tsx)
// and the map Initiative panel open (encounters/detail every 3 s, map-initiative-panel.tsx), while
// players at the same table share the household's IP. Drives the real account handler against a
// disposable local database for one minute of simulated polling and counts refusals.
//
// OWNER AUTHORIZATION REQUIRED (LOOTSPLIT_LOAD_AUDIT=owner-YYYY-MM-DD); never CI.
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { handleAccounts } from "../cloudflare/accounts.mjs";

if (process.env.CI) throw Error("The live-campaign load audit never runs in CI.");
if (!/^owner-\d{4}-\d{2}-\d{2}$/.test(process.env.LOOTSPLIT_LOAD_AUDIT ?? ""))
  throw Error("Owner authorization required: set LOOTSPLIT_LOAD_AUDIT=owner-YYYY-MM-DD.");

const origin = "http://localhost:8080";
const DB = localAccountDb();
const env = { DB, ACCOUNT_SECRET: "only-a-disposable-test-secret-12345678901234567890", ACCOUNT_ORIGIN: origin };
const HOUSEHOLD = "198.51.100.7"; // documentation range: everyone at one table, one Wi-Fi
let signupIp = 0;
const call = async (path, body, cookie, ip = HOUSEHOLD) => {
  const response = await handleAccounts(
    new Request(`${origin}/api/account/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { origin, "cf-connecting-ip": ip, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
  );
  return { status: response.status, cookie: response.headers.getSetCookie().map((s) => s.split(";")[0]).join("; "), data: await response.json().catch(() => null) };
};
const dm = await call("auth/sign-up/email", { email: "load-dm@example.com", name: "Load DM", password: "a long unique test password" }, "", `192.0.2.${++signupIp}`);
assert.equal(dm.status, 200);
const created = await call("encounters/create", { code: "LOADAUD", name: "Bridge ambush" }, dm.cookie, `192.0.2.${++signupIp}`);
const id = created.data?.id ?? created.data?.encounter?.id;

// One simulated minute in 1 s ticks: display every 2 s, initiative every 3 s, a DM roll or save
// every 10 s, and one player's account POST (a character sheet save) every 15 s from the same IP.
const results = { detail: [], other: [] };
for (let second = 0; second < 60; second++) {
  if (second % 2 === 0) results.detail.push((await call("encounters/detail", { id }, dm.cookie)).status);
  if (second % 3 === 0) results.detail.push((await call("encounters/detail", { id }, dm.cookie)).status);
  if (second % 10 === 5) results.other.push(["dm roll", (await call("encounters/save", { id, body: {} }, dm.cookie)).status]);
  if (second % 15 === 7) results.other.push(["player sheet save", (await call("sheets/save", { sheet: {} }, "")).status]);
}
const refusals = [...results.detail, ...results.other.map(([, s]) => s)].filter((s) => s === 429).length;
const firstRefusal = results.detail.findIndex((s) => s === 429);
const signIn = await call("auth/sign-in/email", { email: "load-dm@example.com", password: "a long unique test password" });
const out = {
  kind: "lootsplit.live-load-ratelimit.v1",
  at: new Date().toISOString(),
  encounterId: !!id,
  detailRequests: results.detail.length,
  detailStatuses: Object.fromEntries([...new Set(results.detail)].map((s) => [s, results.detail.filter((x) => x === s).length])),
  otherRequests: results.other,
  refusals429: refusals,
  firstRefusedDetailRequest: firstRefusal < 0 ? null : firstRefusal + 1,
  signInFromHouseholdAfterwards: signIn.status,
};
console.log(JSON.stringify(out, null, 2));
DB.close();
