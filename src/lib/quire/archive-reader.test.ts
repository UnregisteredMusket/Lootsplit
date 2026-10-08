import test from "node:test";
import assert from "node:assert/strict";
import { emptyCloudTable } from "./cloud.ts";
import { readArchiveResult, readSessionSummary } from "./archive-reader.ts";
import { blankPurse } from "./economy.ts";

const session = { id: "old", name: "Old session", startedAt: 10, endedAt: 30 };
const row = (id: string, purseId: string, copper: number) => ({
  id,
  purseId,
  copper,
  at: 20,
  shopId: null,
  summary: "Recorded payment",
});

test("damaged archives cannot invent empty totals or borrow the active ledger", () => {
  const live = [row("active", "hero", 999999)];
  for (const snapshot of [
    "original private damaged bytes",
    "{}",
    JSON.stringify({ ...emptyCloudTable(), ledger: null }),
  ]) {
    const report = { snapshot };
    const before = structuredClone(report);
    const result = readSessionSummary(session, live, report);
    assert.equal(result.available, false);
    assert.ok("error" in result && result.error.includes("Totals are unavailable"));
    assert.deepEqual(report, before, "Reading must retain original archive bytes");
    assert.equal(JSON.stringify(result).includes("private damaged bytes"), false);
    assert.equal("summary" in result, false);
  }
  for (const error of ["Needs recovery", ""]) {
    assert.equal(
      readArchiveResult({ snapshot: JSON.stringify(emptyCloudTable()), error }).available,
      false,
    );
  }
});

test("valid neighboring archived summaries use original rows and preserve transfer accounting", () => {
  const snapshot = {
    ...emptyCloudTable(),
    ledger: [
      row("income", "hero", 100),
      { ...row("transfer", "hero", 50), transactionType: "transfer" as const },
    ],
  };
  const result = readSessionSummary(session, [row("active", "hero", 999999)], {
    snapshot: JSON.stringify(snapshot),
  });
  assert.ok(result.available);
  assert.deepEqual(result.summary, { received: 100, spent: 0, net: 150 });
  const unarchived = readSessionSummary(session, snapshot.ledger);
  assert.ok(unarchived.available);
  assert.deepEqual(
    unarchived.summary,
    result.summary,
    "Legacy unarchived records retain their actual ledger accounting",
  );
});

test("campaign/device reader projects private messages, notes and finances without mutating its source", () => {
  const table = {
    ...emptyCloudTable(),
    purses: [
      { ...blankPurse("character"), id: "hero" },
      { ...blankPurse("character"), id: "other" },
    ],
    ledger: [row("hero-income", "hero", 100), row("other-income", "other", 900)],
    notes: [
      {
        id: "party",
        at: 20,
        from: "dm" as const,
        to: "party" as const,
        purseId: "",
        text: "Shared reminder",
      },
      {
        id: "other-dm",
        at: 20,
        from: "player" as const,
        to: "dm" as const,
        purseId: "other",
        text: "Other player tells DM",
      },
      {
        id: "players-private",
        at: 20,
        from: "player" as const,
        to: "player" as const,
        purseId: "other",
        recipientId: "third",
        text: "Private player conversation",
      },
    ],
    journal: {
      sessions: [],
      requests: [],
      events: [],
      entries: [
        {
          id: "party-note",
          at: 20,
          authorId: "dm",
          purseId: "",
          title: "Public note",
          text: "Shared",
          visibility: "party" as const,
          reportIds: [],
        },
        {
          id: "dm-note",
          at: 20,
          authorId: "dm",
          purseId: "",
          title: "DM secret",
          text: "Private",
          visibility: "dm" as const,
          reportIds: [],
        },
        {
          id: "other-note",
          at: 20,
          authorId: "player",
          purseId: "other",
          title: "Other player secret",
          text: "Private",
          visibility: "player" as const,
          reportIds: [],
        },
      ],
    },
  };
  const report = { snapshot: JSON.stringify(table) },
    before = report.snapshot;
  const dm = readArchiveResult(report, { role: "dm", purseIds: [] });
  assert.ok(dm.available);
  assert.deepEqual(
    dm.snapshot.notes.map((n) => n.id),
    ["party", "other-dm"],
  );
  assert.deepEqual(
    dm.snapshot.journal!.entries!.map((n) => n.id),
    ["party-note", "dm-note"],
  );
  const player = readArchiveResult(report, { role: "player", purseIds: ["hero"] });
  assert.ok(player.available);
  assert.deepEqual(
    player.snapshot.notes.map((n) => n.id),
    ["party"],
  );
  assert.deepEqual(
    player.snapshot.journal!.entries!.map((n) => n.id),
    ["party-note"],
  );
  assert.deepEqual(
    player.snapshot.ledger.map((n) => n.id),
    ["hero-income"],
  );
  assert.deepEqual(
    player.snapshot.purses.map((n) => n.id),
    ["hero"],
  );
  assert.equal(report.snapshot, before);
  const summary = readSessionSummary(session, [], report, { role: "player", purseIds: ["hero"] });
  assert.ok(summary.available);
  assert.equal(summary.summary.received, 100);
});

test("already authorized account records retain the historical projection independently of current device seat", () => {
  const allowed = {
    ...emptyCloudTable(),
    notes: [
      {
        id: "historical-private",
        at: 20,
        from: "player" as const,
        to: "player" as const,
        purseId: "hero",
        recipientId: "other",
        text: "Authorized prior conversation",
      },
    ],
  };
  const result = readArchiveResult({ snapshot: allowed });
  assert.ok(result.available);
  assert.equal(result.snapshot.notes[0]!.text, "Authorized prior conversation");
});

test("legacy nested reports retain IDs for verified owned-device DM readers while shared seats remain restricted", () => {
  const nested = {
    ...emptyCloudTable(),
    notes: [
      {
        id: "shared-in-nested",
        at: 20,
        from: "dm" as const,
        to: "party" as const,
        purseId: "",
        text: "Full nested shared history",
      },
      {
        id: "hidden-in-nested",
        at: 20,
        from: "player" as const,
        to: "player" as const,
        purseId: "other",
        recipientId: "third",
        text: "Unrelated private nested conversation",
      },
    ],
  };
  const snapshot = {
    ...emptyCloudTable(),
    journal: {
      sessions: [],
      requests: [],
      events: [],
      reports: [
        {
          id: "legacy-nested",
          name: "Nested older report",
          at: 20,
          seatIds: ["original-dm"],
          snapshot: JSON.stringify(nested),
        },
      ],
    },
  };
  const report = { snapshot: JSON.stringify(snapshot) },
    originalBytes = report.snapshot;
  const denied = readArchiveResult(report, { role: "dm", purseIds: [], id: "different-dm" });
  assert.ok(denied.available);
  assert.equal(denied.snapshot.journal!.reports!.length, 0);
  const assigned = readArchiveResult(report, { role: "dm", purseIds: [], id: "original-dm" });
  assert.ok(assigned.available);
  assert.equal(assigned.snapshot.journal!.reports![0]!.id, "legacy-nested");
  const owned = readArchiveResult(report, { role: "dm", purseIds: [], ownedDevice: true });
  assert.ok(owned.available);
  assert.deepEqual(owned.snapshot.journal!.reports![0]!.seatIds, ["original-dm"]);
  const nestedResult = readArchiveResult(owned.snapshot.journal!.reports![0]!);
  assert.ok(nestedResult.available);
  assert.deepEqual(
    nestedResult.snapshot.notes.map((note) => note.id),
    ["shared-in-nested"],
  );
  const player = readArchiveResult(report, {
    role: "player",
    purseIds: ["hero"],
    ownedDevice: true,
  });
  assert.ok(player.available);
  assert.equal(
    player.snapshot.journal!.reports!.length,
    0,
    "A player cannot acquire local DM history using this flag",
  );
  assert.equal(report.snapshot, originalBytes);
});
