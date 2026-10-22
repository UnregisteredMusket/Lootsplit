import test from "node:test";
import assert from "node:assert/strict";
import { HELP_GROUPS, topicMatches } from "../help/content.ts";
import { SUPPORT_EMAIL } from "../website/contact.ts";
import { PLAYER_HELP_GROUPS } from "../help/player-content.ts";
import { featureScreens, type Feature } from "./feature-navigation.ts";
import { dmOnlyScreen } from "./split-view.ts";

/**
 * App routes a player seat can open. Anything else (Books, Favorites, Encounters,
 * Settings, the PDF reader) is DM-only or DM setup and must not be linked from
 * player Help. Feature screens are checked against `featureScreens[...].dm`.
 */
const PLAYER_ROUTES = new Set([
  "/",
  "/share",
  "/account",
  "/library",
  "/characters",
  "/party",
  "/catalog",
  "/market",
  "/maps",
  "/help",
]);

function links(groups: typeof HELP_GROUPS) {
  return groups.flatMap((group) =>
    group.topics.flatMap((topic) =>
      topic.links.map(([label, href]) => ({ where: `${group.id}/${topic.id}: ${label}`, href })),
    ),
  );
}

test("every player Help link targets a player route or a dm:false feature screen", () => {
  const all = links(PLAYER_HELP_GROUPS);
  assert.ok(all.length > 0);
  for (const { where, href } of all) {
    const url = new URL(href, "https://lootsplit.invalid");
    assert.equal(url.origin, "https://lootsplit.invalid", `${where} must be an app link`);
    assert.equal(dmOnlyScreen(href), false, `${where} links to a DM-only screen (${href})`);
    if (url.pathname.startsWith("/features/")) {
      const feature = url.pathname.slice("/features/".length) as Feature;
      assert.ok(Object.hasOwn(featureScreens, feature), `${where}: unknown screen ${href}`);
      assert.equal(featureScreens[feature].dm, false, `${where} links to DM screen ${href}`);
    } else {
      assert.ok(PLAYER_ROUTES.has(url.pathname), `${where} is not a player route (${href})`);
    }
  }
});

test("every DM Help feature-screen link names a screen that exists", () => {
  for (const { where, href } of links(HELP_GROUPS)) {
    const url = new URL(href, "https://lootsplit.invalid");
    if (!url.pathname.startsWith("/features/")) continue;
    const feature = url.pathname.slice("/features/".length);
    assert.ok(Object.hasOwn(featureScreens, feature), `${where}: unknown screen ${href}`);
  }
});

test("DM Help covers every DM-only feature screen and Favorites", () => {
  const hrefs = new Set(
    links(HELP_GROUPS).map(({ href }) => new URL(href, "https://lootsplit.invalid").pathname),
  );
  for (const [feature, screen] of Object.entries(featureScreens))
    if (screen.dm)
      assert.ok(hrefs.has(`/features/${feature}`), `no DM Help link to ${screen.title}`);
  assert.ok(hrefs.has("/favorites"), "no DM Help link to Favorites");
});

test("both Help guides offer the public support address as a mailto, not an app link", () => {
  assert.equal(SUPPORT_EMAIL, "support@lootsplitter.com");
  for (const groups of [HELP_GROUPS, PLAYER_HELP_GROUPS]) {
    const topic = groups.flatMap((g) => g.topics).find((t) => t.id === "contact-support");
    assert.ok(topic, "no Contact support topic");
    assert.equal(topic.email, SUPPORT_EMAIL);
    assert.ok(topic.paragraphs.some((p) => p.includes(SUPPORT_EMAIL)));
    assert.ok(topicMatches(topic, "support@lootsplitter"));
    assert.ok(topic.links.every(([, href]) => !href.startsWith("mailto:")));
  }
});
