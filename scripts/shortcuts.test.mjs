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
