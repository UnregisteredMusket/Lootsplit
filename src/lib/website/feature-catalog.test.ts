// The public Features page and the Dungeon Master guide describe the same app (audit E1: the page
// had fallen behind Help by sixteen features). Each catalogue entry's `help` must name a DM guide
// topic, and each DM guide topic must be some entry's `help` or listed below with a reason, so a
// new Help topic for a feature fails here until the catalogue has it.
import assert from "node:assert/strict";
import test from "node:test";
import { HELP_GROUPS } from "../help/content.ts";
import { FEATURE_AREAS } from "./feature-catalog.ts";

const entries = FEATURE_AREAS.flatMap((area) =>
  [...area.major, ...area.minor].map((f) => ({ where: `${area.id}/${f.title}`, ...f })),
);
const dmTopics = new Map(HELP_GROUPS.flatMap((g) => g.topics.map((t) => [t.id, t] as const)));

/** DM guide topics with no catalogue entry of their own, and why. */
const NOT_IN_CATALOGUE: Record<string, string> = {
  "multiple-displays": "covered by Platforms → Split view and windows (help: split-view)",
  "split-party-travel": "part of Characters → Split the party",
  "quest-renown": "part of World → Quests",
  analytics: "explains the website's gold counter, not an app feature",
  "contact-support": "support contact, not a feature",
  "new-name": "rename notice, not a feature",
};

test("every catalogue help link names a Dungeon Master guide topic", () => {
  for (const e of entries)
    if (e.help !== undefined)
      assert.ok(dmTopics.has(e.help), `${e.where}: no DM Help topic "${e.help}"`);
});

test("every Dungeon Master guide topic has a catalogue entry or a listed reason", () => {
  const linked = new Set(entries.map((e) => e.help).filter(Boolean));
  const missing = [...dmTopics.keys()].filter((id) => !linked.has(id) && !NOT_IN_CATALOGUE[id]);
  assert.deepEqual(missing, [], "add a Features entry with this help topic, or a reason below");
  for (const id of Object.keys(NOT_IN_CATALOGUE)) {
    assert.ok(dmTopics.has(id), `exemption for unknown topic ${id}`);
    assert.ok(!linked.has(id), `${id} has an entry now; remove its exemption`);
  }
});

test("catalogue titles are unique (the page keys cards and search results by title)", () => {
  const seen = new Set<string>();
  for (const e of entries) {
    assert.ok(!seen.has(e.title), `duplicate title ${e.title}`);
    seen.add(e.title);
  }
});

test("owner-only tools are not on the public Features page", () => {
  const text = JSON.stringify(FEATURE_AREAS).toLowerCase();
  for (const owner of ["field monitor", "widget", "owner access", "monitor registry"])
    assert.ok(!text.includes(owner), `public Features page mentions ${owner}`);
});
