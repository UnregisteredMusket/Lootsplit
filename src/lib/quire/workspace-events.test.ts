import test from "node:test";
import assert from "node:assert/strict";
import { announceWorkspaceChange, subscribeWorkspaceChanges } from "./workspace-events.ts";

test("workspace invalidations isolate campaigns, contain no contents, and tolerate blocked channels", () => {
  const previous = {
    window: globalThis.window,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    BroadcastChannel: globalThis.BroadcastChannel,
  };
  const notices: unknown[] = [],
    received: unknown[] = [];
  let bus: { onmessage?: (event: { data: unknown }) => void };
  class Blocked {
    constructor() {
      throw Error("Blocked by browser policy");
    }
  }
  class Channel {
    onmessage?: (event: { data: unknown }) => void;
    constructor() {
      bus = { onmessage: (event) => this.onmessage?.(event) };
    }
    postMessage(data: unknown) {
      notices.push(data);
    }
  }
  Object.assign(globalThis, {
    window: {},
    localStorage: { getItem: () => "campaign-a" },
    sessionStorage: { getItem: () => null },
    BroadcastChannel: Blocked,
  });
  let unsubscribe = () => {};
  try {
    assert.doesNotThrow(() => {
      unsubscribe = subscribeWorkspaceChanges((notice) => received.push(notice));
    });
    assert.doesNotThrow(() => announceWorkspaceChange());
    Object.assign(globalThis, { BroadcastChannel: Channel });
    announceWorkspaceChange();
    assert.deepEqual(notices, [{ campaignId: "campaign-a", kind: "data" }]);
    bus!.onmessage!({ data: { campaignId: "campaign-b", kind: "data" } });
    bus!.onmessage!({ data: { campaignId: "campaign-a", kind: "invented" } });
    bus!.onmessage!({ data: null });
    assert.deepEqual(received, []);
    bus!.onmessage!({ data: { campaignId: "campaign-a", kind: "data" } });
    bus!.onmessage!({ data: { campaignId: "campaign-b", kind: "account" } });
    assert.deepEqual(received, [
      { campaignId: "campaign-a", kind: "data" },
      { campaignId: "campaign-b", kind: "account" },
    ]);
    unsubscribe();
    bus!.onmessage!({ data: { campaignId: "campaign-a", kind: "data" } });
    assert.equal(received.length, 2);
  } finally {
    unsubscribe();
    Object.assign(globalThis, previous);
  }
});
