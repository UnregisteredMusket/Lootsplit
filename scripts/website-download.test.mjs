import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// Strip TS with the same compiler as the application, keeping tests compatible with Node 22.
import ts from "typescript";
const code = ts.transpileModule(
  readFileSync(new URL("../src/lib/website/android-download.ts", import.meta.url), "utf8").replace(
    /import release from [^;]+;/,
    `const release = ${readFileSync(new URL("../src/lib/website/release.json", import.meta.url), "utf8")};`,
  ),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
const { androidDownload } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
test("Android download rejects an upstream error and provides recovery", async () => {
  const result = await androidDownload(
    new Request("https://example.org/download/android"),
    async () => new Response("not found", { status: 404 }),
  );
  assert.equal(result.status, 503);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.match(await result.text(), /GitHub/);
});
test("Android download never serves bytes with the wrong release checksum", async () => {
  const result = await androidDownload(
    new Request("https://example.org/download/android?url=https://evil.invalid"),
    async (url) => {
      assert.match(
        url,
        /^https:\/\/github.com\/UnregisteredMusket\/Lootsplit\/releases\/download\//,
      );
      return new Response("wrong APK");
    },
  );
  assert.equal(result.status, 503);
  assert.equal(result.headers.get("Content-Disposition"), null);
});
test("Android download rejects unsupported methods before fetching", async () => {
  const result = await androidDownload(
    new Request("https://example.org/download/android", { method: "POST" }),
    async () => {
      throw new Error("must not fetch");
    },
  );
  assert.equal(result.status, 405);
});

test("verified release returns attachment headers and HEAD omits the body", async () => {
  const { createHash } = await import("node:crypto");
  const fixture = new TextEncoder().encode("verified APK test fixture");
  const digest = createHash("sha256").update(fixture).digest("hex");
  const release = JSON.parse(
    readFileSync(new URL("../src/lib/website/release.json", import.meta.url), "utf8"),
  );
  const fixtureCode = code.replace(release.sha256, digest);
  const { androidDownload: serveFixture } = await import(
    "data:text/javascript;base64," + Buffer.from(fixtureCode).toString("base64")
  );
  for (const method of ["GET", "HEAD"]) {
    const response = await serveFixture(
      new Request("https://example.org/download/android", { method }),
      async () => new Response(fixture),
    );
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("Content-Disposition"),
      `attachment; filename="${release.filename}"`,
    );
    assert.equal(response.headers.get("Content-Type"), "application/vnd.android.package-archive");
    assert.equal(response.headers.get("Content-Length"), String(fixture.length));
    assert.equal((await response.arrayBuffer()).byteLength, method === "HEAD" ? 0 : fixture.length);
  }
});
