// 2026-10-28 live-campaign load audit, F12: background work (push notifications) runs after the
// response under the Worker's waitUntil; without a request context it is awaited as before.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterResponse, runWithRequestContext } from "../cloudflare/request-context.mjs";

test("without a Worker context the task is awaited as before", async () => {
  let done = false;
  await afterResponse(async () => {
    await new Promise((r) => setTimeout(r, 5));
    done = true;
  });
  assert.equal(done, true);
  await assert.rejects(afterResponse(async () => Promise.reject(Error("kept"))), /kept/);
});

test("inside a Worker request the task goes to waitUntil and the caller continues at once", async () => {
  const deferred = [];
  let release;
  const held = new Promise((r) => (release = r));
  let finished = false;
  const order = [];
  await runWithRequestContext({ waitUntil: (p) => deferred.push(p) }, async () => {
    await afterResponse(async () => {
      await held;
      finished = true;
    });
    order.push("responded");
  });
  assert.deepEqual(order, ["responded"]);
  assert.equal(finished, false);
  assert.equal(deferred.length, 1);
  release();
  await deferred[0];
  assert.equal(finished, true);
  // A failing deferred task is logged, never an unhandled rejection.
  const warn = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args[0]);
  try {
    const more = [];
    await runWithRequestContext({ waitUntil: (p) => more.push(p) }, () =>
      afterResponse(async () => {
        throw Error("push service down");
      }),
    );
    await more[0];
    assert.match(warned[0], /Background task failed/);
  } finally {
    console.warn = warn;
  }
  // Outside the run, no context leaks into later work.
  let inline = false;
  await afterResponse(async () => {
    inline = true;
  });
  assert.equal(inline, true);
});

test("the Worker runs the app inside the request context and submits defer their pushes", () => {
  const worker = readFileSync(new URL("../cloudflare/worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /runWithRequestContext\(context, \(\) =>\s*cachedPublicPage\(/);
  const server = readFileSync(new URL("../src/lib/quire/cloud.server.ts", import.meta.url), "utf8");
  assert.match(server, /await afterResponse\(async \(\) => \{\s*try \{\s*const \{ pushMessages \}/);
});
