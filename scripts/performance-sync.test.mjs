import test from "node:test";
import assert from "node:assert/strict";
import { githubClient } from "./performance-sync.mjs";

const reply = (status, body = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: new Headers(),
  json: async () => body,
});
const scripted = (...answers) => {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push(init.method);
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
};
const noPause = { pause: async () => {} };

test("a read retries a transient GitHub 502 and returns the later answer", async () => {
  const s = scripted(reply(502), reply(200, { jobs: [1] }));
  const api = githubClient("t", { fetchImpl: s.fetchImpl, ...noPause });
  assert.deepEqual(await api("/actions/runs/1/attempts/1/jobs"), { jobs: [1] });
  assert.equal(s.calls.length, 2);
});

test("a read retries network errors and rate limits", async () => {
  const s = scripted(new TypeError("fetch failed"), reply(429), reply(200, { ok: 1 }));
  const api = githubClient("t", { fetchImpl: s.fetchImpl, ...noPause });
  assert.deepEqual(await api("/x"), { ok: 1 });
  assert.equal(s.calls.length, 3);
});

test("a read gives up after its attempts and names the count", async () => {
  const s = scripted(reply(502), reply(502), reply(502), reply(502));
  const api = githubClient("t", { fetchImpl: s.fetchImpl, ...noPause });
  await assert.rejects(api("/x"), /HTTP 502 after 4 attempts/);
  assert.equal(s.calls.length, 4);
});

test("permanent errors and writes are not repeated", async () => {
  const notFound = scripted(reply(404));
  await assert.rejects(
    githubClient("t", { fetchImpl: notFound.fetchImpl, ...noPause })("/x"),
    /HTTP 404$/,
  );
  assert.equal(notFound.calls.length, 1);
  const write = scripted(reply(502), reply(200));
  await assert.rejects(
    githubClient("t", { fetchImpl: write.fetchImpl, ...noPause })("/git/refs", {
      method: "POST",
      body: {},
    }),
    /POST .*HTTP 502$/,
  );
  assert.deepEqual(write.calls, ["POST"]);
});

test("a missing resource still returns null without retrying", async () => {
  const s = scripted(reply(404));
  const api = githubClient("t", { fetchImpl: s.fetchImpl, ...noPause });
  assert.equal(await api("/git/ref/heads/none", { missing: true }), null);
  assert.equal(s.calls.length, 1);
});

test("an exhausted rate limit (HTTP 403, none remaining) is named with its reset time", async () => {
  const limited = {
    status: 403,
    ok: false,
    headers: new Headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1793361600" }),
    json: async () => ({}),
  };
  const s = scripted(limited);
  const api = githubClient("t", { fetchImpl: s.fetchImpl, ...noPause });
  await assert.rejects(api("/x"), /rate limit reached; it resets at 2026-10-30T12:00:00.000Z/);
  assert.equal(s.calls.length, 1);
});
