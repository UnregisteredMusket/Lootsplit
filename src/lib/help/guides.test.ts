// Each Help guide renders group and topic IDs as element IDs and link targets (#topic), so an ID
// may appear only once per guide (audit E5: the player guide showed "Lootsplit is now
// Lootsplitter" twice, from its own start group and the shared install group).
import assert from "node:assert/strict";
import test from "node:test";
import { HELP_GUIDE_GROUPS } from "./guides.ts";

for (const [guide, groups] of Object.entries(HELP_GUIDE_GROUPS)) {
  test(`the ${guide} guide has no duplicate group or topic IDs`, () => {
    const seen = new Set<string>();
    const repeated: string[] = [];
    for (const id of groups.flatMap((g) => [g.id, ...g.topics.map((t) => t.id)]))
      if (seen.has(id)) repeated.push(id);
      else seen.add(id);
    assert.deepEqual(repeated, []);
  });
}

test("the player guide keeps its own copy of a topic and the shared install topics", () => {
  const topics = HELP_GUIDE_GROUPS.player.flatMap((g) => g.topics);
  const newName = topics.filter((t) => t.id === "new-name");
  assert.equal(newName.length, 1);
  const playerStart = HELP_GUIDE_GROUPS.player.find((g) => g.id === "start");
  assert.ok(
    playerStart?.topics.some((t) => t === newName[0]),
    "the player's own topic wins",
  );
  assert.ok(
    topics.some((t) => t.id === "android"),
    "install topics still join the player guide",
  );
});
