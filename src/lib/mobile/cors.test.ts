import test from "node:test";
import assert from "node:assert/strict";
import mobileCors from "../../../server/middleware/mobile-cors.ts";

function event(origin: string, method = "POST", path = "/_serverFn/preview") {
  return { url: new URL(path, "https://lootsplit.oliverstorie2017.workers.dev"), req: { method, headers: new Headers({ origin }) } };
}

test("Android can read the serialization header and response body", async () => {
  const result = await mobileCors(event("https://localhost"), () => new Response('{"result":"roster"}', {
    headers: { "content-type": "application/json", "x-tss-serialized": "true" },
  })) as Response;
  assert.equal(result.headers.get("access-control-allow-origin"), "https://localhost");
  const exposed = result.headers.get("access-control-expose-headers")!.split(",").map(s => s.trim());
  assert.ok(exposed.includes("x-tss-serialized"));
  assert.ok(exposed.includes("x-tss-raw"));
  assert.equal(result.headers.get("x-tss-serialized"), "true");
  assert.equal(await result.text(), '{"result":"roster"}');
});

test("preflight succeeds without calling the room handler", async () => {
  const response = await mobileCors(event("https://localhost", "OPTIONS"), () => { throw new Error("called"); }) as Response;
  assert.equal(response.status, 204);
});

test("unapproved origins and normal pages receive no CORS grant", async () => {
  for (const input of [event("https://example.com"), event("https://localhost", "GET", "/")]) {
    const response = new Response("unchanged");
    assert.equal(await mobileCors(input, () => response), response);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
});
