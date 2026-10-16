import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { activeCampaignId, pinCampaignContext, selectWindowCampaign } from "./campaign-context.ts";
import { workspaceDestination, openWorkspaceWindow } from "./workspace-windows.ts";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
test("window campaign pins survive another window's selection while explicit switches still work", () => {
  const previous = {
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
  };
  const local = storage(),
    session = storage();
  Object.assign(globalThis, { localStorage: local, sessionStorage: session });
  try {
    local.setItem("quire.campaign.v1", "original");
    assert.equal(pinCampaignContext(), "original");
    local.setItem("quire.campaign.v1", "other-window");
    assert.equal(activeCampaignId(), "original");
    selectWindowCampaign("chosen-here");
    assert.equal(activeCampaignId(), "chosen-here");
    assert.equal(local.getItem("quire.campaign.v1"), "chosen-here");
    Object.assign(globalThis, {
      sessionStorage: {
        getItem: () => {
          throw Error("Storage blocked");
        },
      },
    });
    assert.equal(
      activeCampaignId(),
      "chosen-here",
      "Blocked per-window storage retains the legacy campaign",
    );
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("shared window synchronization queues for the existing lock and rejects a changed campaign", async () => {
  const source = readFileSync(new URL("./cloud-client.ts", import.meta.url), "utf8");
  const serialSource = source.slice(
    source.indexOf("function serial<T>"),
    source.indexOf("function publish("),
  );
  let held = Promise.resolve<unknown>(undefined);
  const navigator = {
    locks: {
      request: (name: string, options: LockOptions, work: () => Promise<unknown>) => {
        assert.equal(name, "original.write");
        assert.equal(
          options.ifAvailable,
          undefined,
          "Visible companion windows wait rather than dropping a sync attempt",
        );
        assert.ok(options.signal);
        const pending = held.then(work);
        held = pending.catch(() => undefined);
        return pending;
      },
    },
  };
  const build = new Function(
    "key",
    "navigator",
    "let chain=Promise.resolve();" + stripTypeScriptTypes(serialSource) + ";return serial;",
  );
  let secondCampaign = "original";
  const first = build(() => "original", navigator),
    second = build(() => secondCampaign, navigator);
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  const a = first(async () => {
    order.push("first-start");
    entered();
    await gate;
    order.push("first-finish");
  });
  await started;
  const b = second(async () => {
    order.push("second");
  });
  await Promise.resolve();
  assert.deepEqual(order, ["first-start"]);
  release();
  await Promise.all([a, b]);
  assert.deepEqual(order, ["first-start", "first-finish", "second"]);
  const old = second(async () => {
    throw Error("Stale work must never run");
  });
  secondCampaign = "changed";
  await assert.rejects(old, /campaign changed/);
});
test("workspace destinations retain screen selection and exclude invitations and external targets", () => {
  const origin = "https://lootsplit.example";
  assert.equal(
    workspaceDestination("/maps?map=map-1#markers", origin),
    origin + "/maps?map=map-1#markers",
  );
  assert.equal(
    workspaceDestination(
      "/share?join=ROOM&token=secret&invitation=invite&tab=chat&as=player",
      origin,
    ),
    origin + "/share?tab=chat",
  );
  for (const target of [
    "https://attacker.example/",
    "//attacker.example/",
    "javascript:alert(1)",
    "/api/account/library",
  ])
    assert.equal(workspaceDestination(target, origin), origin + "/?view=home");
});
test("opening windows isolates the opener, pins only context, and reports blocked popups", () => {
  const previous = {
    window: globalThis.window,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
  };
  const local = storage(),
    session = storage(),
    childStorage = storage();
  let blocked = false,
    opened = "",
    features = "",
    focused = false;
  const child = {
    sessionStorage: childStorage,
    opener: {},
    location: {
      replace: (url: string) => {
        opened = url;
      },
    },
    focus: () => {
      focused = true;
    },
    close: () => {},
  };
  Object.assign(globalThis, {
    localStorage: local,
    sessionStorage: session,
    window: {
      location: { origin: "https://lootsplit.example" },
      open: (_url: string, target: string, options: string) => {
        assert.equal(target, "_blank");
        features = options;
        return blocked ? null : child;
      },
    },
  });
  try {
    local.setItem("quire.campaign.v1", "campaign");
    openWorkspaceWindow("/features/bank", "window");
    assert.equal(opened, "https://lootsplit.example/features/bank");
    assert.equal(child.opener, null);
    assert.equal(childStorage.getItem("lootsplit.window.campaign.v1"), "campaign");
    assert.equal(childStorage.getItem("lootsplit.verified-account"), null);
    assert.ok(focused);
    assert.match(features, /popup/);
    blocked = true;
    assert.throws(() => openWorkspaceWindow("/maps", "tab"), /browser blocked/);
    assert.equal(activeCampaignId(), "campaign");
  } finally {
    Object.assign(globalThis, previous);
  }
});
