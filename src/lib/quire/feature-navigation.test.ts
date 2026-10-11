import test from "node:test";
import assert from "node:assert/strict";
import { appLinkDestination, safeReturn, screenName } from "./feature-navigation.ts";

test("feature returns retain every app screen and exact query/hash context", () => {
  for (const [href, name] of [
    ["/encounters?encounter=e-1#combat", "Encounters"],
    ["/catalog?pane=open5e&kind=spells", "Catalog"],
    ["/books?q=rules", "Books"],
    ["/book/book-1#page-2", "Book"],
    ["/read/article-1", "Reading"],
    ["/shop/shop-1?book=book-1", "Shop"],
    ["/account#account-backups", "Account"],
    ["/help?role=player#maps", "Help"],
    ["/features/properties#property-one", "Property Management"],
  ]) {
    assert.equal(safeReturn(href), href);
    assert.equal(screenName(href, true), name);
    const link = appLinkDestination("/features/bank", href);
    assert.equal(link.searchParams.get("from"), href);
  }
});

test("same-page hashes keep the current feature and its origin", () => {
  const link = appLinkDestination("#sessions", "/features/downtime?from=%2Fmarket");
  assert.equal(link.pathname, "/features/downtime");
  assert.equal(link.searchParams.get("from"), "/market");
  assert.equal(link.hash, "#sessions");
  const market = appLinkDestination("#market-locations", "/market?book=source");
  assert.equal(market.pathname, "/market");
  assert.equal(market.searchParams.get("book"), "source");
});

test("explicit feature origins survive navigation, recursive origins are removed", () => {
  assert.equal(
    appLinkDestination("/features/review?from=%2Fparty", "/market").searchParams.get("from"),
    "/party",
  );
  assert.equal(
    safeReturn("/features/bank?from=%2Fmarket#review-inbox"),
    "/features/bank#review-inbox",
  );
  assert.equal(appLinkDestination("/market#global-market", "/").searchParams.has("from"), false);
});

test("return links reject external, API, download and unknown destinations", () => {
  for (const href of [
    "//outside.example",
    "https://outside.example",
    "/\\outside.example",
    "/api/account/library",
    "/download/android",
    "/features/missing",
    "/missing",
    null,
    "/" + "x".repeat(601),
  ])
    assert.equal(safeReturn(href), "/?view=home");
  assert.equal(screenName("/?view=sheet", false), "Character");
  assert.equal(screenName("/?view=overview", false), "Campaign overview");
});

test("nested feature Return links do not create a reverse origin loop", () => {
  const property = appLinkDestination(
    "/features/properties#property-one",
    "/features/finances?from=%2F%3Fview%3Dhome",
  );
  assert.equal(property.searchParams.get("from"), "/features/finances");
  const returning = appLinkDestination(
    property.searchParams.get("from")!,
    property.pathname + property.search + property.hash,
    false,
  );
  assert.equal(returning.pathname, "/features/finances");
  assert.equal(returning.searchParams.has("from"), false);
  assert.equal(safeReturn(undefined), "/?view=home");
});
