import { test } from "node:test";
import assert from "node:assert/strict";
import { consumeNavigationResume } from "./navigation-launch.ts";
function storage(value: string | null) {
  return {
    getItem: () => value,
    removeItem: () => {
      value = null;
    },
  };
}
test("context reload handoff is single-use, exact-path, and expires", () => {
  const fresh = storage(JSON.stringify({ path: "/", at: 1000 }));
  assert.equal(consumeNavigationResume(fresh, "/", 1001), true);
  assert.equal(consumeNavigationResume(fresh, "/", 1002), false);
  for (const [path, now] of [
    ["/party", 1001],
    ["/", 16000],
    ["/", 999],
  ] as const)
    assert.equal(
      consumeNavigationResume(storage(JSON.stringify({ path: "/", at: 1000 })), path, now),
      false,
    );
  assert.equal(consumeNavigationResume(storage(null), "/", 1000), false);
  assert.equal(consumeNavigationResume(storage("broken"), "/", 1000), false);
  assert.equal(
    consumeNavigationResume(
      {
        getItem() {
          throw Error("blocked");
        },
        removeItem() {},
      },
      "/",
    ),
    false,
  );
});
