import { test } from "node:test";
import assert from "node:assert/strict";
import { readAccountResponse } from "../account/response.ts";

test("account data and signed-out null retain their JSON values", async () => {
  assert.deepEqual(await readAccountResponse(Response.json({ code: "TEST" })), { code: "TEST" });
  assert.equal(await readAccountResponse(Response.json(null)), null);
  assert.deepEqual(
    await readAccountResponse(Response.json({ error: "Sign in" }, { status: 401 })),
    { error: "Sign in" },
  );
});
test("HTML and malformed JSON produce actionable recovery without exposing a gateway page", async () => {
  for (const response of [
    new Response("<!DOCTYPE html><h1>Gateway error</h1>", {
      status: 502,
      headers: { "content-type": "text/html" },
    }),
    new Response("<!DOCTYPE html><h1>Fallback</h1>", {
      headers: { "content-type": "application/json" },
    }),
    new Response('{"broken":', { headers: { "content-type": "application/json" } }),
  ]) {
    await assert.rejects(readAccountResponse(response), (error) => {
      assert.match((error as Error).message, /Refresh the campaign list/);
      assert.match((error as Error).message, /Pending actions.*kept/);
      assert.doesNotMatch((error as Error).message, /DOCTYPE|Gateway|Unexpected token/);
      return true;
    });
  }
});
test("interrupted response reads preserve their network/abort error", async () => {
  const error = new DOMException("Interrupted", "AbortError");
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(error);
      },
    }),
  );
  await assert.rejects(readAccountResponse(response), (e) => e === error);
});
