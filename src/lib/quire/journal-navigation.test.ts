import test from "node:test";
import assert from "node:assert/strict";
import {
  journalDestination,
  journalEntryHref,
  sessionRecordHref,
  authorizedJournalEntries,
  sessionChronicleEntries,
  canReadEncounterReceipt,
  confirmedReceiptHref,
} from "./journal-navigation.ts";
import type { Journal } from "./journal.ts";

test("exact journal/session IDs round-trip through hashes without interpreting names", () => {
  const id = "encounter-loot:receipt /?#+雪";
  assert.deepEqual(journalDestination(new URL(journalEntryHref(id), "https://example.com").hash), {
    kind: "entry",
    id,
  });
  assert.deepEqual(journalDestination(sessionRecordHref(id).split("#")[1]), {
    kind: "session",
    id,
  });
  for (const hash of [
    "sessions",
    "journal-entry-%broken",
    "journal-entry-",
    `journal-entry-${"x".repeat(151)}`,
  ])
    assert.equal(journalDestination(hash), null);
});

const provenance = {
  kind: "encounter-loot" as const,
  encounterId: "encounter-1",
  receiptId: "receipt-1",
  sessionId: "session-1",
};
const entry = (id: string, visibility: "party" | "dm" | "player", purseId = "") => ({
  id,
  visibility,
  purseId,
  at: 1,
  title: "Same title",
  text: "Same text",
  authorId: "dm",
  reportIds: [],
  provenance,
});
const entries: NonNullable<Journal["entries"]> = [
  entry("party", "party"),
  entry("dm", "dm"),
  entry("mine", "player", "hero"),
  entry("other", "player", "other"),
  { ...entry("unlinked", "party"), provenance: undefined },
  { ...entry("other-session", "party"), provenance: { ...provenance, sessionId: "session-2" } },
];
test("deep-link candidates and session backlinks obey existing journal privacy and exact provenance", () => {
  const player = { role: "player" as const, purseIds: ["hero"] };
  assert.deepEqual(
    authorizedJournalEntries(entries, player).map((e) => e.id),
    ["party", "mine", "unlinked", "other-session"],
  );
  assert.deepEqual(
    sessionChronicleEntries(entries, player, "session-1").map((e) => e.id),
    ["party", "mine"],
  );
  assert.deepEqual(
    sessionChronicleEntries(entries, { role: "dm", purseIds: [] }, "session-1").map((e) => e.id),
    ["party", "dm"],
  );
  assert.deepEqual(sessionChronicleEntries(entries, player, "missing"), []);
});

const scope = {
  role: "dm" as const,
  joined: true,
  roomRole: "dm" as const,
  code: "ROOM",
  ownedDevice: false,
};
const detail = {
  id: "encounter-1",
  code: "ROOM",
  status: "awarded",
  award: { receiptId: "receipt-1" },
};
test("only the current authorized DM's matching confirmed receipt gets an original link", () => {
  assert.equal(
    confirmedReceiptHref(provenance, detail, scope),
    "/encounters?encounter=encounter-1",
  );
  for (const changed of [
    { ...detail, id: "other" },
    { ...detail, code: "OTHER" },
    { ...detail, status: "review" },
    { ...detail, award: null },
    { ...detail, award: { receiptId: "other" } },
  ])
    assert.equal(confirmedReceiptHref(provenance, changed, scope), null);
  for (const changed of [
    { ...scope, role: "player" as const },
    { ...scope, roomRole: "player" as const },
    { ...scope, joined: false },
    { ...scope, code: "" },
  ]) {
    assert.equal(canReadEncounterReceipt(provenance, changed), false);
    assert.equal(confirmedReceiptHref(provenance, detail, changed), null);
  }
});

test("local original receipts require the verified owned-device scope and cannot cross into a shared room", () => {
  const local = { ...provenance, encounterId: "local-encounter" };
  const localDetail = { ...detail, id: local.encounterId, code: "device" };
  const owned = { ...scope, joined: false, ownedDevice: true };
  assert.equal(
    confirmedReceiptHref(local, localDetail, owned),
    "/encounters?encounter=local-encounter",
  );
  assert.equal(confirmedReceiptHref(local, localDetail, { ...owned, ownedDevice: false }), null);
  assert.equal(confirmedReceiptHref(local, localDetail, { ...owned, role: "player" }), null);
  assert.equal(confirmedReceiptHref(local, localDetail, scope), null);
});
