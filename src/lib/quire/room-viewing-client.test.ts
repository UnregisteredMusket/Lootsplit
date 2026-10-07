import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { VIEW_ONLY_MESSAGE } from "./room-access.ts";
const source = readFileSync(new URL("./cloud-client.ts", import.meta.url), "utf8");
function compile(start: string, end: string, names: string[]) {
  const part = source.slice(
    source.indexOf(start),
    source.indexOf(end, source.indexOf(start) + start.length),
  );
  assert.ok(part.length > 100);
  return new Function(
    ...names,
    stripTypeScriptTypes(part.replace(/^export /, "")) +
      `; return ${start.match(/function (\w+)/)![1]};`,
  );
}
const pending = { id: "not-on-server", kind: "patch", changes: [] };
for (const role of ["player", "dm"]) {
  test(`view-only ${role}: incoming ended state shows authoritative data while retaining pending commands and retry identity`, async () => {
    const saved = {
      role,
      seatId: "seat",
      token: "token",
      purseIds: ["hero"],
      pending: [pending],
      revision: 4,
      batchId: "original-batch",
    };
    const view = { readOnly: false, error: "" };
    const applied: unknown[] = [];
    let written: unknown;
    const build = compile("async function accept(", "async function refresh(", [
      "requireSession",
      "view",
      "applyCloudTable",
      "applyCommand",
      "rememberIncoming",
      "remember",
      "setSeat",
      "getSeat",
      "publish",
      "start",
      "fail",
    ]);
    const accept = build(
      () => saved,
      view,
      async (v: unknown) => applied.push(v),
      () => {
        throw Error("Must not replay pending edits in view-only mode");
      },
      () => {},
      (v: unknown) => {
        written = structuredClone(v);
      },
      () => {},
      () => ({}),
      (v: object) => Object.assign(view, v),
      () => {},
      (e: unknown) => {
        throw e;
      },
    );
    const table = { savedServerValue: 27 };
    await accept({
      readOnly: true,
      live: false,
      mine: false,
      revision: 5,
      acknowledged: [],
      draft: "[]",
      table,
      purseIds: ["hero"],
      shopIds: [],
      seats: [],
      seatId: "seat",
      code: "ROOM",
    });
    assert.deepEqual(applied, [table]);
    assert.equal(saved.batchId, "original-batch");
    assert.deepEqual(saved.pending, [pending]);
    assert.deepEqual(written, saved);
    assert.equal(view.readOnly, true);
  });
}

test("read-only client rejects mutation calls before staging, transport or optimistic work", async () => {
  const spans = [
    ["async function flush(", "async function stage("],
    ["async function stage(", "export function endTableTurn("],
    ["export function discardPending(", "export async function queueCommand("],
    ["export async function queueCommand(", "export function runSharedMutation("],
    ["export function runSharedMutation(", "export function chooseTableMode("],
    ["export function sendRoomMessage(", "export function roomCredentials("],
  ];
  for (const [start, end] of spans) {
    const fn = compile(start!, end!, ["requireWritable", "serial"])(
      () => {
        throw Error(VIEW_ONLY_MESSAGE);
      },
      (work: () => unknown) => Promise.resolve().then(work),
    );
    await assert.rejects(fn({ kind: "message", text: "No write" }), /view-only/, start);
  }
});

test("a closure discovered during refresh prevents both command and direct DM optimistic mutations", async () => {
  for (const [start, end] of [
    ["export async function queueCommand(", "export function runSharedMutation("],
    ["export function runSharedMutation(", "export function chooseTableMode("],
  ]) {
    let readOnly = false,
      calls = 0;
    const fn = compile(start!, end!, [
      "requireWritable",
      "serial",
      "requireSession",
      "view",
      "refresh",
    ])(
      () => {
        calls++;
        if (readOnly) throw Error(VIEW_ONLY_MESSAGE);
      },
      (work: () => unknown) => Promise.resolve().then(work),
      () => ({ pending: [], role: "dm" }),
      { mine: true, live: true },
      async () => {
        readOnly = true;
      },
    );
    await assert.rejects(fn({ kind: "patch" }), /view-only/);
    assert.equal(calls, 2);
  }
});
