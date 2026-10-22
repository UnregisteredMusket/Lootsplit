import assert from "node:assert/strict";
import test from "node:test";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { mapGridSchema } from "./world-schema.ts";
import { mapTabletopSchema } from "./tabletop-schema.ts";
import { projectTabletopMap } from "./tabletop.ts";
import {
  RENDER_BADGE_DELAY_MS,
  RENDER_DEBOUNCE_MS,
  RENDER_MAX_WAIT_MS,
  awaitingPlayerView,
  initialRenderState,
  missingPlayerViews,
  renderBadge,
  renderDelay,
  renderReducer,
  type RenderEvent,
  type RenderState,
} from "./map-render-status.ts";

const player: CloudSeat = {
  id: "player",
  token: "player-token",
  name: "Player",
  role: "player",
  purseIds: ["hero"],
};
function table(settings: unknown): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      {
        id: "hero",
        kind: "character" as const,
        name: "Hero",
        coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
    ],
    journal: readJournal({
      world: {
        maps: [
          {
            id: "map",
            name: "Keep",
            image: "data:image/png;base64,cHJpdmF0ZS1zb3VyY2U=",
            locationId: null,
            visible: true,
            anchors: [],
            markers: [],
            grid: mapGridSchema.parse({ columns: 10, rows: 10 }),
            tokens: [
              {
                id: "t",
                kind: "character",
                entityId: "hero",
                label: "Hero",
                column: 1,
                row: 1,
                visibility: "party",
              },
            ],
            tabletop: mapTabletopSchema.parse(settings),
          },
        ],
      },
    }),
  };
}
const run = (events: RenderEvent[], state: RenderState = initialRenderState) =>
  events.reduce(renderReducer, state);

test("rapid changes are debounced, bounded by a maximum wait", () => {
  let state = run([{ type: "change", at: 0, missing: 1 }]);
  assert.equal(state.phase, "waiting");
  assert.equal(renderDelay(state, 0), RENDER_DEBOUNCE_MS);
  // Each move restarts the debounce…
  state = run([{ type: "change", at: 400, missing: 1 }], state);
  assert.equal(renderDelay(state, 400), RENDER_DEBOUNCE_MS);
  // …but continuous dragging still renders once the maximum wait has passed.
  for (let at = 800; at <= 1800; at += 200)
    state = run([{ type: "change", at, missing: 1 }], state);
  assert.equal(renderDelay(state, 1800), RENDER_MAX_WAIT_MS - 1800);
  assert.equal(renderDelay(state, 2500), 0);
  state = run(
    [
      { type: "start", at: 2000 },
      { type: "done", at: 2300, missing: 0 },
    ],
    state,
  );
  assert.deepEqual(state, { phase: "idle" });
  assert.equal(renderDelay(state, 3000), undefined);
});

test("a change during a render supersedes it; failures stay reported until a success", () => {
  let state = run([
    { type: "change", at: 0, missing: 2 },
    { type: "start", at: 600 },
    { type: "change", at: 700, missing: 2 },
  ]);
  assert.equal(state.phase, "waiting");
  assert.equal(state.firstChangeAt, 0);
  state = run(
    [
      { type: "start", at: 1300 },
      { type: "fail", at: 1400, error: "Upload failed." },
    ],
    state,
  );
  assert.equal(state.phase, "failed");
  assert.equal(renderDelay(state, 1500), undefined);
  assert.equal(renderBadge(state, 1500)?.tone, "alert");
  assert.match(renderBadge(state, 1500)!.text, /Upload failed/);
  // The next visibility change retries automatically and keeps the failure visible.
  state = run([{ type: "change", at: 5000, missing: 1 }], state);
  assert.equal(state.phase, "waiting");
  assert.equal(renderBadge(state, 5000)?.tone, "alert");
  state = run(
    [
      { type: "start", at: 5600 },
      { type: "done", at: 5700, missing: 0 },
    ],
    state,
  );
  assert.equal(renderBadge(state, 6000), undefined);
  // Retry restarts the wait.
  state = run([{ type: "retry", at: 9000 }], { phase: "failed", error: "x" });
  assert.deepEqual(state, { phase: "waiting", firstChangeAt: 9000, lastChangeAt: 9000 });
});

test("the DM badge appears only for renders that are slow to finish", () => {
  const state = run([
    { type: "change", at: 0, missing: 1 },
    { type: "start", at: 600 },
  ]);
  assert.equal(renderBadge(state, 600), undefined);
  assert.equal(renderBadge(state, RENDER_BADGE_DELAY_MS)?.tone, "status");
  assert.equal(renderBadge(run([{ type: "done", at: 900, missing: 0 }], state), 9000), undefined);
  // A render that ends with views still missing (another device holds the lock) keeps waiting.
  const partial = run([{ type: "done", at: 900, missing: 1 }], state);
  assert.equal(partial.phase, "waiting");
});

test("players see the waiting state from projected data alone", () => {
  const t = table({ fog: { enabled: true, base: "concealed", shapes: [] }, revision: 3 });
  const map = t.journal!.world!.maps[0];
  assert.deepEqual(missingPlayerViews(t, map), ["party"]);
  const projected = projectTabletopMap(t, map, player);
  assert.equal(awaitingPlayerView(projected), true);
  assert.deepEqual(projected.tabletop!.fog.shapes, []);
  const frame = {
    id: "00000000-0000-4000-8000-000000000001",
    audience: "party",
    revision: 3,
    media: {
      id: "11111111-1111-4111-8111-111111111111",
      sha256: "a".repeat(64),
      mime: "image/png",
      purpose: "render",
      width: 10,
      height: 10,
      bytes: 10,
    },
  };
  const rendered = table({
    fog: { enabled: true, base: "concealed", shapes: [] },
    revision: 3,
    frames: [frame],
  });
  const renderedMap = rendered.journal!.world!.maps[0];
  assert.deepEqual(missingPlayerViews(rendered, renderedMap), []);
  assert.equal(awaitingPlayerView(projectTabletopMap(rendered, renderedMap, player)), false);
  // A stale frame (older revision) is not shown, so players wait again.
  const stale = table({
    fog: { enabled: true, base: "concealed", shapes: [] },
    revision: 4,
    frames: [frame],
  });
  assert.equal(
    awaitingPlayerView(projectTabletopMap(stale, stale.journal!.world!.maps[0], player)),
    true,
  );
  // Individual vision needs one view per character as well as the party view.
  const individual = table({ vision: "individual", revision: 1 });
  assert.deepEqual(missingPlayerViews(individual, individual.journal!.world!.maps[0]), [
    "party",
    "purse:hero",
  ]);
  // An unmasked shared map is never waiting.
  const open = table({ fog: { enabled: false, base: "concealed", shapes: [] } });
  assert.deepEqual(missingPlayerViews(open, open.journal!.world!.maps[0]), []);
  assert.equal(
    awaitingPlayerView(projectTabletopMap(open, open.journal!.world!.maps[0], player)),
    false,
  );
});
