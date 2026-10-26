// Desk "Set up your campaign" checklist (design D4): computed from data, hidden once done,
// dismissed, or after the first completed session.
import assert from "node:assert/strict";
import test from "node:test";
import { campaignSetupSteps, setupDismissKey, showCampaignSetup } from "./campaign-setup.ts";

const empty = { purses: [], shops: [], journal: {}, online: false } as Parameters<
  typeof campaignSetupSteps
>[0];

test("a blank campaign lists five open steps with links", () => {
  const steps = campaignSetupSteps(empty);
  assert.deepEqual(
    steps.map((s) => [s.id, s.done]),
    [
      ["party", false],
      ["place", false],
      ["shop", false],
      ["map", false],
      ["players", false],
    ],
  );
  for (const s of steps) assert.match(s.href, /^\/[a-z]/);
  assert.equal(showCampaignSetup(steps, { sessions: [] }, false), true);
});

test("each step ticks itself from campaign data", () => {
  const steps = campaignSetupSteps({
    purses: [{ kind: "party" }, { kind: "character" }],
    shops: [{}],
    journal: {
      market: {
        locations: [{ id: "r", kind: "region", parentId: null, name: "Coast", description: "" }],
        currentLocationId: null,
      },
      world: { maps: [{}] },
    } as never,
    online: true,
  });
  assert.ok(steps.every((s) => s.done));
  assert.equal(showCampaignSetup(steps, { sessions: [] }, false), false);
});

test("a party purse alone is not a party", () => {
  const [party] = campaignSetupSteps({ ...empty, purses: [{ kind: "party" }] });
  assert.equal(party.done, false);
});

test("dismissing or finishing a session hides the checklist", () => {
  const steps = campaignSetupSteps(empty);
  assert.equal(showCampaignSetup(steps, { sessions: [] }, true), false);
  assert.equal(
    showCampaignSetup(
      steps,
      { sessions: [{ id: "s", name: "One", startedAt: 1, endedAt: 2 }] } as never,
      false,
    ),
    false,
  );
  assert.equal(
    showCampaignSetup(steps, { sessions: [{ id: "s", name: "One", startedAt: 1 }] } as never, false),
    true,
  );
  assert.notEqual(setupDismissKey("a"), setupDismissKey("b"));
});
