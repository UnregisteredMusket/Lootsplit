import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeShortcuts,
  defaultShortcuts,
  shortcutDestinations,
  destinationsFor,
} from "../src/lib/quire/shortcuts.mjs";
test("shortcut storage preserves six destinations and custom order without allowing arbitrary URLs", () => {
  assert.deepEqual(normalizeShortcuts(null), defaultShortcuts);
  assert.deepEqual(normalizeShortcuts({}), defaultShortcuts);
  const reordered = [...defaultShortcuts].reverse();
  assert.deepEqual(normalizeShortcuts(reordered), reordered);
  const changed = normalizeShortcuts([
    { destination: "chat", label: "  Send a message  ", icon: "message" },
  ]);
  assert.deepEqual(changed[0], {
    destination: "chat",
    label: "Send a message",
    icon: "message",
  });
  assert.equal(changed.length, 6);
  assert.deepEqual(
    normalizeShortcuts([{ destination: "javascript:alert(1)", href: "https://evil.invalid" }])[0],
    defaultShortcuts[0],
  );
  assert.equal(
    normalizeShortcuts([{ destination: "chat", label: "x".repeat(100), icon: "script" }])[0].label
      .length,
    32,
  );
  assert.ok(shortcutDestinations.every((x) => x.href.startsWith("/") && !x.href.startsWith("//")));
});
test("Character Sheet opens sheets for the DM and the assigned-sheet view for players", () => {
  assert.equal(destinationsFor("dm").find(x => x.id === "character").href, "/characters");
  assert.equal(destinationsFor("player").find(x => x.id === "character").href, "/?view=sheet");
  assert.equal(normalizeShortcuts([{ destination: "character", label: "My sheets", icon: "users" }], "dm")[0].destination, "character");
});
test("Pin to Desk keeps six buttons, puts the pin first and unpins to a default", async () => {
  const { pinShortcut, unpinShortcut } = await import("../src/lib/quire/shortcuts.mjs");
  const start = normalizeShortcuts(null, "dm");
  const pinned = pinShortcut(start, "quests", "dm");
  assert.equal(pinned.length, 6);
  assert.equal(pinned[0].destination, "quests");
  assert.deepEqual(pinned.slice(1), start.slice(0, 5), "the last button makes room");
  assert.equal(pinShortcut(pinned, "quests", "dm"), pinned, "pinning twice changes nothing");
  const unpinned = unpinShortcut(pinned, "quests", "dm");
  assert.equal(unpinned.length, 6);
  assert.ok(!unpinned.some((x) => x.destination === "quests"));
  assert.deepEqual(unpinned, start, "the dropped default comes back");
  assert.throws(() => pinShortcut(start, "javascript:alert(1)", "dm"));
  // Players cannot pin DM-only screens; DM-only feature IDs are not player destinations.
  assert.throws(() => pinShortcut(normalizeShortcuts(null, "player"), "time", "player"));
  assert.throws(() => pinShortcut(normalizeShortcuts(null, "player"), "review", "player"));
  assert.ok(destinationsFor("player").some((x) => x.id === "quests"));
});
