import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, readdir, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

// Actual mobile account component, synthetic native bridge. Native transport/storage/rendering
// are independently exercised by Android instrumentation; no real account or network is used.
const mock = `
  let connected=false;
  export const hasOwnerWidget=()=>true;
  export const connectOwnerWidget=async()=>{ if(window.widgetFail) throw Error('Synthetic offline connection'); connected=true; };
  export const disconnectOwnerWidget=async()=>{connected=false;};
  export const OwnerWidget={
    status:async()=>({connected,installed:0,pinSupported:true}),
    pin:async()=>{window.widgetPins=(window.widgetPins||0)+1;return {requested:true};},
    refresh:async()=>{window.widgetRefreshes=(window.widgetRefreshes||0)+1; if(window.widgetRefreshFail) throw Error('Could not refresh · tap Refresh to retry');},
    consumeOpenRequest:async()=>({open:false})
  };
`;
const result = await build({
  stdin: {
    contents:
      'import React from "react"; import { createRoot } from "react-dom/client"; import { MobileOwnerWidget } from "./src/components/account/mobile-owner-widget"; createRoot(document.getElementById("root")).render(<MobileOwnerWidget name="Widget Audit Owner" email="widget-audit-with-a-long-address@example.invalid" />);',
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  define: { "import.meta.env.VITE_MOBILE": '"true"', "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "synthetic-native-bridge",
      setup(builder) {
        builder.onResolve({ filter: /\/mobile\/owner-widget$/ }, () => ({
          path: "widget",
          namespace: "mock",
        }));
        builder.onResolve({ filter: /^@capacitor\/app$/ }, () => ({
          path: "app",
          namespace: "mock",
        }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
          contents:
            path === "widget" ? mock : "export const App={addListener:async()=>({remove(){}})};",
          loader: "js",
        }));
      },
    },
  ],
});
const assets = await readdir("dist/mobile/assets");
const css = (
  await Promise.all(
    assets
      .filter((name) => name.endsWith(".css"))
      .map((name) => readFile(`dist/mobile/assets/${name}`, "utf8")),
  )
).join("\n");
const server = createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/app.js" ? "text/javascript" : "text/html");
  response.end(
    request.url === "/app.js"
      ? result.outputFiles[0].text
      : `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><main class="portal" style="padding:16px"><div id="root"></div></main><script type="module" src="/app.js"></script></body></html>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  headless: true,
  args: ["--no-sandbox"],
});
const output = "test-results/android-widget-controls";
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(origin + "/")
      ? route.continue()
      : route.abort(),
  );
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByText("Not connected · 0 on home screen", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Connect owner account", exact: true }).click();
  await page.getByText("Connected · 0 on home screen", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Add to home screen", exact: true }).click();
  await page.getByText("Confirm Add in Android’s home-screen prompt.", { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.widgetPins), 1);
  await page.getByRole("button", { name: "Refresh widget", exact: true }).click();
  await page.getByText("Widget refreshed.", { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.widgetRefreshes), 1);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: `${output}/account-${width}.png`, fullPage: true });
  }
  await page.evaluate(() => {
    window.widgetRefreshFail = true;
  });
  await page.getByRole("button", { name: "Refresh widget", exact: true }).click();
  await page.getByText("Could not refresh · tap Refresh to retry", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Refresh widget", exact: true }).isEnabled(),
    true,
  );
  await page.getByText("Connected · 0 on home screen", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.widgetRefreshFail = false;
  });
  await page.getByRole("button", { name: "Disconnect widget", exact: true }).click();
  await page.getByText("Not connected · 0 on home screen", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Add to home screen", exact: true }).isDisabled(),
    true,
  );
  await page.evaluate(() => {
    window.widgetFail = true;
  });
  await page.getByRole("button", { name: "Connect owner account", exact: true }).click();
  await page.getByText("Synthetic offline connection", { exact: true }).waitFor();
  await page.getByText("Not connected · 0 on home screen", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Mobile widget controls: connect, pin handoff, refresh, disconnect, failure and 320/390/1280 layout passed.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
