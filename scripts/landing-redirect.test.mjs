import test from "node:test";
import assert from "node:assert/strict";
import { APP_VISITOR_COOKIE, landingRedirect } from "../src/lib/deployment/public-urls.mjs";

const html = "text/html,application/xhtml+xml";

test("a first visit to the bare address opens the public home page", () => {
  for (const url of ["/", "https://lootsplitter.com/", "http://127.0.0.1:8080/"])
    assert.equal(landingRedirect({ url, accept: html }), "/welcome", url);
  assert.equal(landingRedirect({ method: "HEAD", url: "/", accept: html }), "/welcome");
  assert.equal(
    landingRedirect({ url: "/", accept: html, cookie: "other=1; lootsplit-app=0" }),
    "/welcome",
  );
});

test("returning and signed-in browsers go straight into the app", () => {
  for (const cookie of [
    `${APP_VISITOR_COOKIE}=1`,
    `a=b; ${APP_VISITOR_COOKIE}=1`,
    `${APP_VISITOR_COOKIE}=1; a=b`,
    "__Secure-lootsplit.session_token=abc",
    "x=1; lootsplit.session_token=abc",
  ])
    assert.equal(landingRedirect({ url: "/", accept: html, cookie }), null, cookie);
});

test("everything except a bare HTML request for / is untouched", () => {
  for (const url of [
    "/?view=home",
    "/?join=ABCD",
    "/share?join=ABCD&session=x",
    "/welcome",
    "/account",
    "/api/account/library",
    "/index.html",
  ])
    assert.equal(landingRedirect({ url, accept: html }), null, url);
  assert.equal(landingRedirect({ method: "POST", url: "/", accept: html }), null);
  for (const accept of [undefined, "*/*", "application/json"])
    assert.equal(landingRedirect({ url: "/", accept }), null, String(accept));
});
