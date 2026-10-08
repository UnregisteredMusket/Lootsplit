import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { readNotes } from "./chat.ts";

const source = readFileSync(new URL("./chat.ts", import.meta.url), "utf8");
const privateNote = {
  id: "private-original",
  at: 1,
  from: "player" as const,
  to: "dm" as const,
  purseId: "hero",
  text: "Synthetic original private note",
};
function chatHarness(phase: "database" | "commit" | "read") {
  let active = "original",
    opened!: () => void,
    ready!: () => void;
  const readyPromise = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const databasePromise = new Promise<object>((resolve) => {
    opened = () => resolve(db);
  });
  let tx: any, req: any;
  const writes: unknown[] = [];
  const db = {
    transaction: () => {
      tx = {
        objectStore: () => ({
          put: (row: unknown) => {
            writes.push(row);
            ready();
          },
          get: () => {
            req = { result: { notes: [privateNote] } };
            ready();
            return req;
          },
        }),
      };
      return tx;
    },
  };
  const notes: unknown[] = [{ id: "current-other", text: "Current campaign note" }];
  let publishes = 0,
    alerts = 0;
  const body = [
    source.slice(
      source.indexOf("export async function loadNotes("),
      source.indexOf("export async function postNotes("),
    ),
    source.slice(
      source.indexOf("export async function replaceNotes("),
      source.indexOf("export async function rememberIncoming("),
    ),
    source.slice(
      source.indexOf("export async function refreshChat("),
      source.indexOf("function publish()"),
    ),
    source.slice(source.indexOf("function request<T>")),
  ]
    .join("\n")
    .replaceAll("export async function", "async function");
  const methods = new Function(
    "captureDeviceMutationScope",
    "assertDeviceMutationScope",
    "quireDb",
    "readNotes",
    "publish",
    "alertNotes",
    "getNotes",
    stripTypeScriptTypes(`let notes=getNotes();const EMPTY=[],KEY="chat";${body};`) +
      ";return {replaceNotes,refreshChat,current:()=>notes};",
  )(
    () => ({ identity: active }),
    (scope: { identity: string }) => {
      if (scope.identity !== active) throw Error("Synthetic campaign or account changed");
    },
    async () => {
      if (phase === "database") {
        ready();
        return databasePromise;
      }
      return db;
    },
    readNotes,
    () => {
      publishes++;
    },
    () => {
      alerts++;
    },
    () => notes,
  );
  return {
    ...methods,
    ready: () => readyPromise,
    switch: () => {
      active = "other";
    },
    open: () => opened(),
    complete: () => {
      if (phase === "read") req.onsuccess();
      else tx.oncomplete();
    },
    writes,
    publishes: () => publishes,
    alerts: () => alerts,
  };
}

test("real chat hydration rejects an original campaign write after its database-opening context changes", async () => {
  const h = chatHarness("database");
  const work = h.replaceNotes([privateNote]);
  await h.ready();
  h.switch();
  h.open();
  await assert.rejects(work, /campaign or account changed/);
  assert.equal(h.writes.length, 0);
  assert.equal(h.publishes(), 0);
  assert.equal(h.alerts(), 0);
  assert.equal(h.current()[0].id, "current-other");
});
test("real completed original chat write never publishes or alerts its private notes under the changed context", async () => {
  const h = chatHarness("commit");
  const work = h.replaceNotes([privateNote]);
  await h.ready();
  h.switch();
  h.complete();
  await assert.rejects(work, /campaign or account changed/);
  assert.equal(h.writes.length, 1);
  assert.equal(h.publishes(), 0);
  assert.equal(h.alerts(), 0);
  assert.equal(h.current()[0].id, "current-other");
});
test("real late chat refresh keeps the current campaign notes instead of publishing or clearing them", async () => {
  const h = chatHarness("read");
  const work = h.refreshChat();
  await h.ready();
  h.switch();
  h.complete();
  await work;
  assert.equal(h.publishes(), 0);
  assert.equal(h.alerts(), 0);
  assert.equal(h.current()[0].id, "current-other");
});
