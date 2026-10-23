import test from "node:test";
import assert from "node:assert/strict";
import { crawlerFile } from "../src/lib/deployment/public-urls.mjs";
import { deploymentOrigins } from "../src/lib/deployment/origins.mjs";

const get = (path, init) => crawlerFile(new Request("https://evil.example" + path, init));

test("robots.txt names the configured website sitemap, never the request host", () => {
  const robots = get("/robots.txt");
  assert.match(robots.type, /^text\/plain/);
  assert.match(robots.body, /^User-agent: \*$/m);
  for (const path of ["/api/", "/_serverFn/", "/account", "/share"])
    assert.match(robots.body, new RegExp(`^Disallow: ${path.replace(/\//g, "\\/")}$`, "m"));
  assert.match(robots.body, new RegExp(`^Sitemap: ${deploymentOrigins.website}/sitemap.xml$`, "m"));
  assert.doesNotMatch(robots.body, /evil\.example/);
});

test("sitemap.xml lists only the public pages on the configured website", () => {
  const sitemap = get("/sitemap.xml");
  assert.match(sitemap.type, /^application\/xml/);
  const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(
    locs,
    ["/welcome", "/features", "/downloads", "/updates", "/help", "/resources", "/donate", "/privacy"].map(
      (p) => deploymentOrigins.website + p,
    ),
  );
  assert.doesNotMatch(sitemap.body, /evil\.example|\/account|\/share/);
});

test("other paths and methods are not crawler files", () => {
  assert.equal(get("/robots.txt", { method: "POST" }), null);
  assert.ok(get("/sitemap.xml", { method: "HEAD" }));
  for (const path of ["/", "/robots.txt/x", "/assets/robots.txt", "/sitemap.xml.gz"])
    assert.equal(get(path), null, path);
});
