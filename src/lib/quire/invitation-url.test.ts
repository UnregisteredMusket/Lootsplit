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
test("fresh invitations and activity-report links use the public website on native, never https://localhost", async () => {
  const { publicLinkOrigin } = await import("./invitation-url.ts");
  const { seatHref } = await import("./table.ts");
  const { readFileSync } = await import("node:fs");
  const fresh = new URL(invitationUrl({ origin: "https://localhost", native: true, code: "ROOM", session: "s1", invitation: "fresh-token" }));
  assert.equal(fresh.origin, deploymentOrigins.website);
  assert.equal(fresh.searchParams.get("join"), "ROOM");
  assert.equal(fresh.searchParams.get("session"), "s1");
  assert.equal(fresh.searchParams.get("invitation"), "fresh-token");
  assert.equal(publicLinkOrigin({ origin: "http://localhost:8080" }), "http://localhost:8080");
  assert.equal(new URL(seatHref("dm", "t.abc", publicLinkOrigin({ origin: "https://localhost", native: true }))).origin, deploymentOrigins.website);
  assert.equal(new URL(seatHref("dm", "t.abc", publicLinkOrigin({ origin: "https://campaign.test" }))).origin, "https://campaign.test");
  // Every shared-link builder in these controls goes through the shared helpers, not the page origin directly.
  const cloud = readFileSync(new URL("../../components/cloud-table.tsx", import.meta.url), "utf8");
  const chat = readFileSync(new URL("../../components/manual-chat.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(cloud, /new URL\("\/share", (window\.)?location\.origin\)/);
  assert.doesNotMatch(chat, /seatHref\([^)]*, window\.location\.origin\)/);
});
