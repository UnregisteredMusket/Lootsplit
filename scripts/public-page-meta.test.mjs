import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PUBLIC_PAGE_META,
  homeStructuredData,
  publicPageMeta,
} from "../src/lib/deployment/public-urls.mjs";
import { deploymentOrigins } from "../src/lib/deployment/origins.mjs";
import { grokOgHeadTags } from "./grok-pwa-shared.mjs";

const pages = ["/welcome", "/features", "/downloads", "/updates", "/help", "/resources", "/donate", "/privacy"];

test("every public page has its own title and description, short enough for search results", () => {
  assert.deepEqual(Object.keys(PUBLIC_PAGE_META).sort(), [...pages].sort());
  const titles = pages.map((p) => PUBLIC_PAGE_META[p].title);
  const descriptions = pages.map((p) => PUBLIC_PAGE_META[p].description);
  assert.equal(new Set(titles).size, pages.length, "titles must be unique");
  assert.equal(new Set(descriptions).size, pages.length, "descriptions must be unique");
  for (const p of pages) {
    const { title, description } = PUBLIC_PAGE_META[p];
    assert.ok(title.includes("Lootsplitter"), `${p} title names Lootsplitter`);
    assert.ok(title.length <= 65, `${p} title ${title.length} chars`);
    assert.ok(
      description.length >= 70 && description.length <= 160,
      `${p} description ${description.length} chars`,
    );
  }
  assert.match(PUBLIC_PAGE_META["/welcome"].title, /free D&D loot splitter/);
  assert.match(PUBLIC_PAGE_META["/welcome"].description, /100% free/);
  assert.equal(publicPageMeta("/help/"), PUBLIC_PAGE_META["/help"]);
  for (const p of ["/", "/account", "/share", "/features/ships"])
    assert.equal(publicPageMeta(p), null, p);
});

test("each public route head uses its own metadata", () => {
  for (const [file, path] of [
    ["welcome", "/welcome"],
    ["features.index", "/features"],
    ["downloads", "/downloads"],
    ["updates", "/updates"],
    ["help", "/help"],
    ["resources", "/resources"],
    ["donate", "/donate"],
    ["privacy", "/privacy"],
  ])
    assert.match(
      readFileSync(`src/routes/${file}.tsx`, "utf8"),
      new RegExp(`publicPageHead\\("${path}"\\)`),
      file,
    );
});

test("share tags take the page's own title and description", () => {
  const tags = grokOgHeadTags({
    host: "lootsplitter.com",
    site: { title: "Lootsplitter", description: "Site-wide" },
    page: PUBLIC_PAGE_META["/downloads"],
  }).join("\n");
  assert.ok(
    tags.includes(
      `<meta property="og:title" content="Download Lootsplitter for Android or play in your browser">`,
    ),
  );
  assert.ok(tags.includes("og:description") && !tags.includes("Site-wide"));
  const fallback = grokOgHeadTags({
    host: "lootsplitter.com",
    site: { title: "Lootsplitter", description: "Site-wide" },
  }).join("\n");
  assert.ok(fallback.includes(`content="Lootsplitter"`) && fallback.includes("Site-wide"));
});

test("home structured data is WebSite and Organization only, on the configured website", () => {
  const data = homeStructuredData();
  assert.equal(data["@context"], "https://schema.org");
  assert.deepEqual(
    data["@graph"].map((n) => n["@type"]),
    ["WebSite", "Organization"],
  );
  assert.equal(data["@graph"][0].url, `${deploymentOrigins.website}/`);
  assert.doesNotMatch(JSON.stringify(data), /SoftwareApplication|aggregateRating|review/i);
});
