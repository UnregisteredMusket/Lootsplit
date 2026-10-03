import test from "node:test";
import assert from "node:assert/strict";
import { setCloudWatch, subscribeCloudWatch } from "./cloud-turn.ts";

test("unchanged polls skip reload notifications but data and turn changes remain observable", () => {
  const initial = { joined: true, mine: true, live: false, who: "DM" };
  setCloudWatch(initial);
  let calls = 0;
  const unsubscribe = subscribeCloudWatch(() => calls++);
  setCloudWatch({ ...initial }, false);
  assert.equal(calls, 0);
  setCloudWatch({ ...initial }, true);
  assert.equal(calls, 1);
  setCloudWatch({ ...initial, mine: false }, false);
  assert.equal(calls, 2);
  setCloudWatch({ ...initial });
  assert.equal(calls, 3);
  unsubscribe();
});
