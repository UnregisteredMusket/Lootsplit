import assert from "node:assert/strict";
import test from "node:test";
import { getWithReset, isConnectionReset } from "./browser/request-retry.mjs";

const reset = () =>
  new Error(
    "apiRequestContext.get: read ECONNRESET\nCall log:\n  - → GET http://127.0.0.1:8082/api/account/library",
  );

test("a GET on a reset keep-alive socket is asked once more", async () => {
  const calls = [];
  const request = {
    async get(url, options) {
      calls.push([url, options]);
      if (calls.length === 1) throw reset();
      return { ok: () => true };
    },
  };
  const response = await getWithReset(request, "http://127.0.0.1:8082/api/account/library", {
    timeout: 5,
  });
  assert.equal(response.ok(), true);
  assert.deepEqual(calls, [
    ["http://127.0.0.1:8082/api/account/library", { timeout: 5 }],
    ["http://127.0.0.1:8082/api/account/library", { timeout: 5 }],
  ]);
});

test("only once, and never for other errors", async () => {
  let calls = 0;
  const always = {
    async get() {
      calls++;
      throw reset();
    },
  };
  await assert.rejects(getWithReset(always, "u"), /ECONNRESET/);
  assert.equal(calls, 2);
  calls = 0;
  const refused = {
    async get() {
      calls++;
      throw new Error("connect ECONNREFUSED 127.0.0.1:8082");
    },
  };
  await assert.rejects(getWithReset(refused, "u"), /ECONNREFUSED/);
  assert.equal(calls, 1);
  assert.equal(isConnectionReset(new Error("socket hang up")), true);
  assert.equal(isConnectionReset(new Error("Timeout 30000ms exceeded")), false);
});
