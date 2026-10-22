import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { deploymentOrigins } from "../src/lib/deployment/origins.mjs";

test("native owner widget shares only the canonical HTTPS endpoint", () => {
  const source = readFileSync(
    "android/app/src/main/java/com/unregisteredmusket/lootsplit/WidgetClient.java",
    "utf8",
  );
  // The widgets request the compact owner view; the origin and path stay the canonical endpoint.
  assert.ok(
    source.includes(`"${deploymentOrigins.nativeApi}/api/account/owner/monitor?view=widget"`),
  );
  assert.equal(source.match(/https:\/\/[^"]+/g).length, 1, "Only one native endpoint");
});

test("native account changes clear widget state before requests and scope late failures to their old token", async () => {
  const events = [];
  const storage = new Map([["lootsplit.account.token.v1", "first-session"]]);
  const originals = Object.fromEntries(
    ["localStorage", "sessionStorage", "window", "fetch", "__disconnectWidget", "__installId"].map((key) => [
      key,
      globalThis[key],
    ]),
  );
  const memory = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  Object.assign(globalThis, {
    localStorage: memory,
    sessionStorage: memory,
    window: { dispatchEvent() {} },
    __disconnectWidget: async (expected) => events.push(["clear", expected]),
    __installId: "this-install",
  });
  try {
    const result = await build({
      entryPoints: ["src/lib/account/client.ts"],
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      define: { "import.meta.env.VITE_MOBILE": '"true"' },
      plugins: [
        {
          name: "isolated-account-side-effects",
          setup(builder) {
            builder.onResolve(
              { filter: /owner-widget|party-sheet-links|workspace-events/ },
              (args) => ({ path: args.path, namespace: "synthetic" }),
            );
            builder.onLoad({ filter: /.*/, namespace: "synthetic" }, ({ path }) => ({
              contents: path.includes("owner-widget")
                ? "export const disconnectOwnerWidget = (token) => globalThis.__disconnectWidget(token); export const readInstallId = async () => globalThis.__installId ?? '';"
                : "export const announceSheetChange = () => {}; export const announceWorkspaceChange = () => {};",
              loader: "js",
            }));
          },
        },
      ],
    });
    const { accountRequest } = await import(
      `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
    );
    globalThis.fetch = async () => {
      events.push(["fetch"]);
      return new Response("{}", { headers: { "content-type": "application/json" } });
    };
    await accountRequest("auth/sign-out", {});
    assert.deepEqual(events.slice(0, 2), [["clear", undefined], ["fetch"]]);
    assert.equal(storage.has("lootsplit.account.token.v1"), false);

    storage.set("lootsplit.account.token.v1", "old-session");
    events.length = 0;
    let respond;
    globalThis.fetch = () =>
      new Promise((resolve) => {
        respond = resolve;
      });
    const pending = accountRequest("library");
    storage.set("lootsplit.account.token.v1", "new-session");
    respond(new Response("not JSON", { status: 401 }));
    await assert.rejects(pending);
    assert.deepEqual(events, [["clear", "old-session"]]);

    for (const [path, body] of [
      ["auth/get-session", "null"],
      ["auth/get-session", '{"user":null}'],
      ["library", '{"user":{"role":"member"}}'],
    ]) {
      events.length = 0;
      globalThis.fetch = async () =>
        new Response(body, { headers: { "content-type": "application/json" } });
      await accountRequest(path, undefined, new AbortController().signal);
      assert.deepEqual(events, [["clear", "new-session"]]);
    }
    events.length = 0;
    globalThis.fetch = async () =>
      new Response('{"user":{"role":"owner"}}', {
        headers: { "content-type": "application/json" },
      });
    await accountRequest("library");
    assert.deepEqual(events, []);
    // A pre-binding token was adopted for this installation, never signed out.
    assert.equal(storage.get("lootsplit.account.token.install.v1"), "this-install");
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test("a WebView account token restored from another installation is never sent (audit S07)", async () => {
  const storage = new Map([
    ["lootsplit.account.token.v1", "restored-session"],
    ["lootsplit.account.token.install.v1", "old-install"],
    ["quire.campaigns", "[]"],
  ]);
  const originals = Object.fromEntries(
    ["localStorage", "sessionStorage", "window", "fetch", "__disconnectWidget", "__installId"].map((key) => [
      key,
      globalThis[key],
    ]),
  );
  const memory = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const sent = [];
  Object.assign(globalThis, {
    localStorage: memory,
    sessionStorage: memory,
    window: { dispatchEvent() {} },
    __disconnectWidget: async () => {},
    __installId: "new-install",
    fetch: async (_url, init) => {
      sent.push(new Headers(init.headers).get("authorization"));
      return new Response("null", { headers: { "content-type": "application/json" } });
    },
  });
  try {
    const result = await build({
      entryPoints: ["src/lib/account/client.ts"],
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      define: { "import.meta.env.VITE_MOBILE": '"true"' },
      plugins: [
        {
          name: "isolated-account-side-effects",
          setup(builder) {
            builder.onResolve(
              { filter: /owner-widget|party-sheet-links|workspace-events/ },
              (args) => ({ path: args.path, namespace: "synthetic" }),
            );
            builder.onLoad({ filter: /.*/, namespace: "synthetic" }, ({ path }) => ({
              contents: path.includes("owner-widget")
                ? "export const disconnectOwnerWidget = async () => {}; export const readInstallId = async () => globalThis.__installId;"
                : "export const announceSheetChange = () => {}; export const announceWorkspaceChange = () => {};",
              loader: "js",
            }));
          },
        },
      ],
    });
    const { accountRequest } = await import(
      `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
    );
    await accountRequest("auth/get-session", undefined, new AbortController().signal);
    assert.deepEqual(sent, [null]);
    assert.equal(storage.has("lootsplit.account.token.v1"), false);
    assert.equal(storage.get("lootsplit.account.token.install.v1"), "new-install");
    assert.equal(storage.get("quire.campaigns"), "[]", "Campaign data stays");
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
