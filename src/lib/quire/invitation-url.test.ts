import test from "node:test";
import assert from "node:assert/strict";
import { invitationUrl } from "./invitation-url.ts";
import { deploymentOrigins } from "../deployment/origins.mjs";
test("invitation links preserve identifiers and keep native API and public website roles separate", () => {
  const input = { origin: "https://campaign.test", code: "ROOM", session: "session?&", character: "hero & ally", invitation: "specific-token" };
  const url = new URL(invitationUrl(input));
  assert.equal(url.origin, input.origin);
  assert.equal(url.pathname, "/share");
  for (const key of ["session", "character", "invitation"] as const) assert.equal(url.searchParams.get(key), input[key]);
  assert.equal(new URL(invitationUrl({ ...input, native: true })).origin, deploymentOrigins.website);
  assert.throws(() => invitationUrl({ ...input, origin: "https://good.test/path" }));
});
