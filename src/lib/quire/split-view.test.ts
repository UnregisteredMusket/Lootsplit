import test from "node:test";
import assert from "node:assert/strict";
import {
  SPLIT_MIN_PANE,
  SPLIT_STORAGE_KEY,
  besideFromSearch,
  clampRatio,
  defaultBeside,
  dmOnlyScreen,
  keyboardRatio,
  paneLabel,
  paneScreens,
  readSplitLayout,
  rememberBeside,
  retainBeside,
  sanitizePaneHref,
  snapRatio,
  splitAvailable,
  withBeside,
  writeSplitLayout,
  DEFAULT_SPLIT_LAYOUT,
} from "./split-view.ts";
import { safeReturn } from "./feature-navigation.ts";
import { workspaceDestination } from "./workspace-windows.ts";

function memory() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

test("split view is offered from the 1024px desktop/tablet-landscape breakpoint only", () => {
  assert.equal(splitAvailable(1440), true);
  assert.equal(splitAvailable(1194), true);
  assert.equal(splitAvailable(1024), true);
  assert.equal(splitAvailable(1023), false);
  assert.equal(splitAvailable(390), false);
  assert.equal(splitAvailable(Number.NaN), false);
});

test("pane screens match Tabs & windows and hide DM-only screens from players", () => {
  const player = paneScreens(false).map((s) => s.href);
  const dm = paneScreens(true).map((s) => s.href);
  for (const href of ["/?view=home", "/characters", "/party", "/market", "/library", "/maps", "/share?tab=chat"]) {
    assert.ok(player.includes(href), href);
    assert.ok(dm.includes(href), href);
  }
  assert.ok(!player.includes("/encounters"));
  assert.ok(dm.includes("/encounters"));
  for (const id of ["time", "financial", "reports", "review", "shops", "music"]) {
    assert.ok(!player.includes(`/features/${id}`), id);
    assert.ok(dm.includes(`/features/${id}`), id);
  }
  assert.ok(player.includes("/features/finances"));
  assert.ok(!dm.includes("/features/finances"), "DMs keep the existing Tabs & windows exclusion");
  assert.deepEqual(
    paneScreens(false).filter((s) => s.group === "main").map((s) => s.title),
    ["Home", "Character sheet", "Inventory", "Market", "Library", "Maps", "Campaign chat"],
  );
  assert.equal(paneScreens(true)[0].title, "DM Desk");
});

test("pane destinations are sanitized and role-filtered", () => {
  assert.equal(sanitizePaneHref("/market", false), "/market");
  assert.equal(sanitizePaneHref("/shop/lantern?book=x#stock", false), "/shop/lantern?book=x#stock");
  assert.equal(sanitizePaneHref("/characters?id=party%3Amira", false), "/characters?id=party%3Amira");
  assert.equal(sanitizePaneHref("/?view=home", true), "/?view=home");
  assert.equal(sanitizePaneHref("/features/bank", false), "/features/bank");
  // DM-only screens never open beside for a player seat.
  assert.equal(sanitizePaneHref("/encounters", false), null);
  assert.equal(sanitizePaneHref("/features/time", false), null);
  assert.equal(sanitizePaneHref("/features/music", false), null);
  assert.equal(sanitizePaneHref("/encounters", true), "/encounters");
  assert.equal(dmOnlyScreen("/features/review?from=%2F"), true);
  assert.equal(dmOnlyScreen("/features/journal"), false);
  // External, unknown, public website and account pages stay out of panes.
  for (const value of [
    "https://evil.example/market",
    "//evil.example/market",
    "/features/unknown",
    "/account",
    "/welcome",
    "/help",
    "/player-display",
    "market",
    "",
    42,
    null,
    "/" + "x".repeat(700),
  ])
    assert.equal(sanitizePaneHref(value, true), null, String(value));
  // Invitations, account callbacks, seat links and nested panes are removed.
  assert.equal(
    sanitizePaneHref("/share?tab=chat&join=ROOM&session=s&character=c&invitation=i&as=dm", true),
    "/share?tab=chat",
  );
  assert.equal(sanitizePaneHref("/market?beside=%2Fparty&token=t", true), "/market");
});

test("the URL beside value round-trips through search strings and parsed search objects", () => {
  const href = withBeside("/characters?id=party%3Amira", "/shop/lantern?book=");
  const url = new URL(href, "https://x.invalid");
  assert.equal(url.pathname, "/characters");
  assert.equal(url.searchParams.get("id"), "party:mira");
  assert.equal(besideFromSearch(url.search, false), "/shop/lantern?book=");
  assert.equal(besideFromSearch({ beside: "/market", view: "home" }, false), "/market");
  assert.equal(besideFromSearch({ view: "home" }, false), null);
  assert.equal(besideFromSearch("?beside=/encounters", false), null);
  assert.equal(besideFromSearch("?beside=/encounters", true), "/encounters");
  // Old URLs without the parameter keep a single screen.
  assert.equal(besideFromSearch("?view=home", true), null);
  assert.equal(withBeside(href, null), "/characters?id=party%3Amira");
  // Return links and new windows never carry the pane along.
  assert.equal(safeReturn("/market?beside=%2Fparty"), "/market");
  assert.equal(
    workspaceDestination("/market?beside=%2Fparty", "https://lootsplit.example"),
    "https://lootsplit.example/market",
  );
});

test("navigation in the main pane keeps the pane beside it until explicitly closed", () => {
  const next = (dest: Record<string, unknown>) => (search: Record<string, unknown>) => {
    void search;
    return dest;
  };
  assert.deepEqual(retainBeside({ search: { beside: "/market", view: "home" }, next: next({ id: "a" }) }), {
    id: "a",
    beside: "/market",
  });
  assert.deepEqual(
    retainBeside({ search: { beside: "/market" }, next: next({ id: "a", beside: undefined }) }),
    { id: "a", beside: undefined },
  );
  assert.deepEqual(retainBeside({ search: { view: "home" }, next: next({ id: "a" }) }), { id: "a" });
  assert.deepEqual(
    retainBeside({ search: { beside: "/market" }, next: next({ beside: "/party" }) }),
    { beside: "/party" },
  );
});

test("divider ratios keep both panes at least the minimum width and reach the presets", () => {
  const width = 1336;
  const min = SPLIT_MIN_PANE / width;
  assert.ok(clampRatio(0.1, width) >= min - 0.001);
  assert.ok(clampRatio(0.95, width) <= 1 - min + 0.001);
  assert.ok(clampRatio(0.1, width) * width >= SPLIT_MIN_PANE - 1);
  assert.equal(clampRatio(0.5, width), 0.5);
  assert.equal(clampRatio(0.6, width), 0.6);
  // Too narrow for two panes at their minimum: share evenly.
  assert.equal(clampRatio(0.7, 700), 0.5);
  assert.equal(clampRatio(Number.NaN, width), 0.5);
  assert.equal(keyboardRatio(0.5, "ArrowRight", false, width), 0.55);
  assert.equal(keyboardRatio(0.55, "ArrowRight", false, width), 0.6);
  assert.equal(keyboardRatio(0.6, "ArrowLeft", true, width), 0.59);
  assert.equal(keyboardRatio(0.6, "Enter", false, width), 0.5);
  assert.equal(keyboardRatio(0.6, "Home", false, width), clampRatio(0, width));
  assert.equal(keyboardRatio(0.6, "End", false, width), clampRatio(1, width));
  assert.equal(keyboardRatio(0.6, "a", false, width), null);
  assert.equal(snapRatio(0.507), 0.5);
  assert.equal(snapRatio(0.592), 0.6);
  assert.equal(snapRatio(0.55), 0.55);
});

test("layout persists per device and tolerates corrupt or blocked storage", () => {
  const storage = memory();
  assert.deepEqual(readSplitLayout(storage), DEFAULT_SPLIT_LAYOUT);
  const layout = rememberBeside({ ...DEFAULT_SPLIT_LAYOUT, ratio: 0.6 }, "/market");
  assert.ok(writeSplitLayout(storage, layout));
  assert.deepEqual(readSplitLayout(storage), {
    open: true,
    beside: "/market",
    ratio: 0.6,
    recent: ["/market"],
  });
  const again = rememberBeside(rememberBeside(layout, "/party"), "/market?book=");
  assert.deepEqual(again.recent, ["/market?book=", "/party"]);
  storage.values.set(SPLIT_STORAGE_KEY, "{not json");
  assert.deepEqual(readSplitLayout(storage), DEFAULT_SPLIT_LAYOUT);
  storage.values.set(SPLIT_STORAGE_KEY, JSON.stringify({ open: "yes", ratio: 7, recent: [1, "//x", "/maps"] }));
  assert.deepEqual(readSplitLayout(storage), { open: false, beside: "", ratio: 0.5, recent: ["/maps"] });
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(readSplitLayout(blocked), DEFAULT_SPLIT_LAYOUT);
  assert.equal(writeSplitLayout(blocked, layout), false);
  assert.deepEqual(readSplitLayout(undefined), DEFAULT_SPLIT_LAYOUT);
});

test("the layout toggle restores the last screen used beside, never a duplicate or a hidden screen", () => {
  const layout = rememberBeside(DEFAULT_SPLIT_LAYOUT, "/encounters");
  assert.equal(defaultBeside(layout, "/characters", true), "/encounters");
  assert.equal(defaultBeside(layout, "/characters", false), "/market");
  assert.equal(defaultBeside(layout, "/encounters", true), "/market");
  assert.equal(defaultBeside(DEFAULT_SPLIT_LAYOUT, "/market", false), "/party");
  assert.equal(paneLabel("primary", "/characters?id=x", false), "Left pane: Character sheet");
  assert.equal(paneLabel("secondary", "/shop/lantern", false), "Right pane: Shop");
  assert.equal(paneLabel("secondary", "/share?tab=chat", true), "Right pane: Campaign chat");
});
