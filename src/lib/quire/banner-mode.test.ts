import assert from "node:assert/strict";
import test from "node:test";
import { BANNER_SEEN_PREFIX, bannerKey, bannerMode } from "./banner-mode.ts";

test("the first visit gets the full banner; later visits and split panes are compact", () => {
  assert.equal(bannerMode({ seenBefore: false, splitPane: false }), "full");
  assert.equal(bannerMode({ seenBefore: true, splitPane: false }), "compact");
  assert.equal(bannerMode({ seenBefore: false, splitPane: true }), "compact");
});

test("one remembered key per screen; every shop or book shares its kind's key", () => {
  assert.equal(bannerKey("/party"), `${BANNER_SEEN_PREFIX}/party`);
  assert.equal(bannerKey("/features/downtime/"), `${BANNER_SEEN_PREFIX}/features/downtime`);
  assert.equal(bannerKey("/shop/abc"), bannerKey("/shop/xyz"));
  assert.equal(bannerKey("/book/1"), `${BANNER_SEEN_PREFIX}/book`);
});
