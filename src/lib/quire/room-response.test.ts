import test from "node:test";
import assert from "node:assert/strict";
import { emptyCloudTable } from "./cloud.ts";
import type { RoomView } from "./cloud.server.ts";
import { readJournal } from "./journal.ts";
import { readRoomResponse } from "./room-response.ts";

const incomplete = /The shared campaign response was incomplete\./;

function response(): RoomView {
  return {
    userId: "synthetic-owner",
    sessionId: "synthetic-session",
    code: "SYNTHETIC",
    revision: 1,
    turn: 0,
    mine: true,
    live: false,
    who: "Synthetic DM",
    seatId: "synthetic-dm",
    purseIds: [],
    shopIds: [],
    seats: [
      {
        id: "synthetic-dm",
        name: "Synthetic DM",
        role: "dm",
        pending: 0,
        allowParty: false,
      },
    ],
    acknowledged: [],
    draft: "[]",
    table: emptyCloudTable(),
  };
}

function freeze(value: unknown): void {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
}

test("a complete room response keeps exact response and table objects without mutation", () => {
  const source = response();
  const before = structuredClone(source);
  freeze(source);
  const result = readRoomResponse(source);
  assert.equal(result.remote, source);
  assert.equal(result.remote.table, source.table);
  assert.deepEqual(result.draft, []);
  assert.deepEqual(source, before);
});

test("missing results, generic JSON errors and HTML responses fail with actionable recovery", () => {
  for (const value of [
    undefined,
    null,
    false,
    "<html>private gateway details</html>",
    [],
    {},
    { statusCode: 500, message: "Server function info not found" },
    { error: "private account details" },
    new Response("<html>private gateway details</html>", {
      headers: { "content-type": "text/html" },
    }),
  ])
    assert.throws(
      () => readRoomResponse(value),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, incomplete);
        assert.match(error.message, /export any pending actions before refreshing/);
        assert.doesNotMatch(
          error.message,
          /private|unchanged|save failed|not saved|not committed/i,
        );
        return true;
      },
    );
});

test("required envelope fields cannot be missing or coerced", () => {
  for (const key of [
    "code",
    "seatId",
    "revision",
    "turn",
    "mine",
    "live",
    "who",
    "purseIds",
    "shopIds",
    "seats",
    "acknowledged",
    "draft",
    "table",
  ]) {
    const value = { ...response() } as Record<string, unknown>;
    delete value[key];
    assert.throws(() => readRoomResponse(value), incomplete, key);
  }
  for (const fields of [
    { code: "" },
    { seatId: "" },
    { revision: "1" },
    { revision: Number.NaN },
    { turn: -1 },
    { mine: 1 },
    { live: "false" },
    { acknowledged: [null] },
    { purseIds: [3] },
    { shopIds: [""] },
    { seats: [null] },
  ])
    assert.throws(() => readRoomResponse({ ...response(), ...fields }), incomplete);
});

test("legacy and guest views may omit account identity and newer optional flags", () => {
  const source = response();
  delete source.userId;
  delete source.sessionId;
  source.seats[0]!.role = "player";
  assert.equal(readRoomResponse(source).remote, source);
  source.userId = undefined;
  source.sessionId = undefined;
  source.viewOnly = undefined;
  source.testMode = undefined;
  source.departed = undefined;
  assert.equal(readRoomResponse(source).remote, source);
});

test("optional identity and seat metadata validate types when provided", () => {
  for (const fields of [
    { userId: 1 },
    { sessionId: null },
    { viewOnly: "false" },
    { testMode: 0 },
    { departed: {} },
    { departed: [{ id: "old-seat", name: "Old seat", status: "left", invitation: false }] },
  ])
    assert.throws(() => readRoomResponse({ ...response(), ...fields }), incomplete);
  const valid = response();
  valid.departed = [{ id: "old-seat", name: "Old seat", status: "left" }];
  valid.viewOnly = false;
  valid.testMode = false;
  assert.equal(readRoomResponse(valid).remote, valid);
  for (const fields of [
    { id: "" },
    { role: "owner" },
    { name: null },
    { pending: "0" },
    { allowParty: 1 },
  ]) {
    const source = response();
    assert.throws(
      () => readRoomResponse({ ...source, seats: [{ ...source.seats[0], ...fields }] }),
      incomplete,
    );
  }
});

test("the table envelope cannot silently replace missing consumed arrays", () => {
  for (const key of [
    "purses",
    "holdings",
    "shops",
    "stock",
    "ledger",
    "listings",
    "loans",
    "sheets",
    "notes",
  ]) {
    const value = response();
    const table = { ...value.table } as Record<string, unknown>;
    delete table[key];
    assert.throws(() => readRoomResponse({ ...value, table }), incomplete, key);
  }
  const value = response();
  assert.throws(
    () => readRoomResponse({ ...value, table: { ...value.table, handouts: "invalid" } }),
    incomplete,
  );
});

test("runtime table rejection happens before acknowledged work can be accepted", () => {
  const value = response();
  value.acknowledged = ["pending-command"];
  value.table.purses = [
    {
      id: "hero",
      name: "Synthetic character",
      kind: "character",
      coins: { cp: -1, sp: 0, ep: 0, gp: 0, pp: 0 },
    },
  ];
  const before = structuredClone(value);
  assert.throws(() => readRoomResponse(value), incomplete);
  assert.deepEqual(value, before);
});

test("old damaged archive bytes and extra metadata remain readable and untouched", () => {
  const source = response();
  source.table.journal = readJournal({
    reports: [
      {
        id: "old-report",
        name: "Historical recovery report",
        at: 1,
        snapshot: "original unreadable history",
      },
    ],
  });
  Object.assign(source.table, { legacyMetadata: { preserve: "original value" } });
  Object.assign(source, { futureMetadata: { preserve: true } });
  const before = structuredClone(source);
  const result = readRoomResponse(source);
  assert.equal(result.remote.table, source.table);
  assert.equal(result.remote.table.journal!.reports![0]!.snapshot, "original unreadable history");
  assert.deepEqual(source, before);
});

test("malformed or invalid command drafts fail before returning a response", () => {
  for (const draft of [
    "{",
    "null",
    "{}",
    '"not an array"',
    "[null]",
    "[{}]",
    '[{"id":"pending-command","kind":"not-a-command"}]',
    '[{"id":"pending-command","kind":"bank-repay","loanId":"loan","copper":"1"}]',
  ]) {
    const value = { ...response(), draft, acknowledged: ["pending-command"] };
    assert.throws(() => readRoomResponse(value), incomplete, draft);
    assert.equal(value.draft, draft);
    assert.deepEqual(value.acknowledged, ["pending-command"]);
  }
});

test("validated parsed drafts retain original receipt content without schema normalization", () => {
  const command = {
    id: "pending-command",
    kind: "journal-note",
    title: "  Original padded title  ",
    text: "Original note",
    visibility: "dm",
    purseId: "",
    preservedMetadata: { source: "original receipt" },
  };
  const value = { ...response(), draft: JSON.stringify([command]) };
  const result = readRoomResponse(value);
  assert.equal(result.remote, value);
  assert.deepEqual(result.draft, [command]);
  assert.equal(value.draft, JSON.stringify([command]));
});
