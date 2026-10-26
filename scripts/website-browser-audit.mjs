import { openApplication, continueIntoApp, NOT_FOUND_AUDIT_PATH } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { verifyAndroidDownload } from "./android-download-audit.mjs";
import { readFileSync } from "node:fs";
import { PUBLIC_PAGE_META } from "../src/lib/deployment/public-urls.mjs";
const release = JSON.parse(readFileSync("src/lib/website/release.json", "utf8"));
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = process.env.WEBSITE_SCREENSHOTS || "test-results/website";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const failures = [];
/** Product screenshots whose load was cancelled by navigation; each must still exist. */
const abortedShots = new Set();
const externalFailures = [];
try {
  // Phones (320, 390), tablet (768) and desktop: no horizontal page scroll anywhere.
  const widths = [1280, 768, 390, 320];
  for (const width of widths) {
    // Each viewport is its own simulated visitor on disposable local servers, so
    // 32 public page loads do not spend the shared per-address account limit
    // that later audit steps rely on. Live audits never send this header.
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      extraHTTPHeaders: local
        ? { "cf-connecting-ip": `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1` }
        : {},
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => failures.push(e.message));
    page.on("requestfailed", (r) => {
      const entry = { url: r.url(), error: r.failure()?.errorText };
      // A lazy product screenshot still loading when the audit navigates away is cancelled by
      // the browser (net::ERR_ABORTED), which is not a broken asset. Each one is fetched again
      // at the end and must answer 200.
      if (entry.error === "net::ERR_ABORTED" && r.resourceType() === "image" && new URL(r.url()).pathname.startsWith("/product/"))
        return abortedShots.add(new URL(r.url()).pathname);
      (r.url().startsWith(origin) ? failures : externalFailures).push(entry);
    });
    for (const [path, heading] of [
      ["welcome", "Split the loot."],
      ["features", "Features"],
      ["downloads", "One party."],
      ["updates", "Changelog"],
      ["help", "A little help, adventurer."],
      ["resources", "Resources & credits"],
      ["donate", "Support Lootsplitter"],
      ["privacy", "Privacy at Lootsplitter"],
      ["community", "Find your"],
      ["account", "Welcome to your next chapter."],
    ]) {
      const response = await openApplication(page, `${origin}/${path}`, {
        waitUntil: "networkidle",
      });
      assert.equal(response.status(), 200);
      await page.getByRole("heading", { level: 1 }).filter({ hasText: heading }).waitFor();
      // Each public page carries its own title, one description and matching share tags (W3).
      const meta = PUBLIC_PAGE_META[`/${path}`];
      if (meta && width === 1280) {
        assert.equal(await page.title(), meta.title, `${path} title`);
        const descriptions = await page.locator('meta[name="description"]').evaluateAll((els) => els.map((e) => e.getAttribute("content")));
        assert.deepEqual(descriptions, [meta.description], `${path} description`);
        assert.equal(await page.locator('meta[property="og:title"]').getAttribute("content"), meta.title);
        assert.equal(await page.locator('meta[property="og:description"]').getAttribute("content"), meta.description);
      }
      if (path === "welcome" && width === 1280) {
        const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
        assert.equal(ld.length, 1, "one JSON-LD block on the home page");
        assert.deepEqual(JSON.parse(ld[0])["@graph"].map((n) => n["@type"]), ["WebSite", "Organization"]);
        await page.getByText("100% free, supported by donations", { exact: true }).waitFor();
      }
      if (path === "welcome") {
        // The maker's note closes the home page, signed with the owner's public handle.
        const why = page.locator("section#why, section[aria-labelledby='why']");
        assert.equal(await why.getByRole("heading", { name: "Why did I create Lootsplitter?", level: 2 }).count(), 1);
        assert.equal(await why.locator(".ls-why-signature").innerText(), "— UnregisteredMusket");
        // The kobold mascot heads the note; the kobold mark is the header logo (owner's brand set, 2026-10-23).
        assert.match(await why.locator("img.ls-why-mascot").getAttribute("alt"), /kobold/);
        assert.equal(await page.locator(".ls-header .ls-brand img").getAttribute("src"), "/brand/kobold-icon-128.png");
        await why.getByText("That’s why I created Lootsplitter: to save you time, and to smite shopping episodes forever.", { exact: true }).waitFor();
        // Owner, 2026-10-23: the note sits right under "Where it all began" (the loot section).
        assert.equal(
          await page.locator("main > section[aria-labelledby='loot'] + section").getAttribute("aria-labelledby"),
          "why",
        );
        // W-4: "Everything around the ledger" is a row the visitor moves: no auto motion, no loop
        // copy, cards snap, and each card opens its Features section.
        const track = page.locator(".ls-carousel-track");
        const cards = page.locator(".ls-carousel a.ls-area");
        assert.equal(await cards.count(), 8);
        for (const href of await cards.evaluateAll((a) => a.map((n) => n.getAttribute("href"))))
          assert.match(href, /^\/features#[a-z]+$/);
        assert.equal(await page.locator("[data-loop-copy]").count(), 0);
        assert.equal(await page.getByRole("button", { name: /the scrolling$/ }).count(), 0);
        assert.equal(await track.evaluate((e) => getComputedStyle(e).scrollSnapType), "x mandatory");
        assert.ok(await track.evaluate((e) => e.scrollWidth > e.clientWidth), "the row scrolls sideways");
        await track.scrollIntoViewIfNeeded();
        await page.mouse.move(1, 1);
        const still = await track.evaluate((e) => e.scrollLeft);
        await page.waitForTimeout(1500);
        assert.equal(await track.evaluate((e) => e.scrollLeft), still, "the row never moves by itself");
        const previous = page.getByRole("button", { name: "Previous areas", exact: true });
        const next = page.getByRole("button", { name: "Next areas", exact: true });
        assert.equal(await previous.isDisabled(), true);
        await next.click();
        await page.waitForFunction((s) => document.querySelector(".ls-carousel-track").scrollLeft > s + 100, still);
        await previous.click();
        await page.waitForFunction(() => document.querySelector(".ls-carousel-track").scrollLeft <= 2);
        // Phones get phone-sized captures through <picture media> (W-4).
        const sources = await page.locator(".ls-carousel picture source").evaluateAll((els) =>
          els.map((e) => ({ media: e.getAttribute("media"), src: e.getAttribute("srcset") })),
        );
        assert.equal(sources.length, 8);
        for (const source of sources) {
          assert.equal(source.media, "(max-width: 699px)");
          assert.match(source.src, /^\/product\/[a-z]+-phone\.webp$/);
        }
        if (width <= 390) {
          const shown = await page.locator(".ls-carousel img").first().evaluate((img) => img.currentSrc);
          assert.match(shown, /-phone\.webp$/, "phones load the phone capture");
        }
      }
      if (path === "privacy" && width === 1280) {
        // Owner decisions 2026-10-23: named as UnregisteredMusket, 30-day deletion, under-13 line.
        const policy = await page.locator("main").innerText();
        assert.match(policy, /run by one person, UnregisteredMusket/);
        assert.match(policy, /deleted within 30 days/);
        assert.match(policy, /not directed at children under 13/);
        assert.doesNotMatch(policy, /Oliver|Storie|UnregisteredMusket_Owner/i);
        for (const id of ["device", "server", "security", "cookies", "others", "deleting", "children", "changes"])
          assert.equal(await page.locator(`h2#${id}`).count(), 1, id);
      }
      if (path === "welcome" && width === 1280) {
        // The owner's promo video plays muted and looped in the hero, and can be paused (WCAG 2.2.2).
        const video = page.locator(".ls-hero video.ls-promo-video");
        assert.deepEqual(
          await video.evaluate((v) => ({ muted: v.muted, loop: v.loop, inline: v.playsInline, poster: v.getAttribute("poster") })),
          { muted: true, loop: true, inline: true, poster: "/media/lootsplitter-promo-poster.webp" },
        );
        await page.waitForFunction(() => document.querySelector(".ls-promo-video")?.currentTime > 0.5);
        await page.getByRole("button", { name: "Pause the video", exact: true }).click();
        assert.equal(await video.evaluate((v) => v.paused), true);
        await page.getByRole("button", { name: "Play the video", exact: true }).click();
        assert.equal(await video.evaluate((v) => v.paused), false);
        // Visitors who ask for reduced motion see the poster until they press play.
        const calm = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
        await openApplication(calm, `${origin}/welcome`, { waitUntil: "networkidle" });
        await calm.waitForTimeout(1500);
        assert.equal(await calm.locator(".ls-promo-video").evaluate((v) => v.paused), true);
        await calm.getByRole("button", { name: "Play the video", exact: true }).waitFor();
        assert.equal(await calm.locator(".ls-carousel-track").evaluate((e) => e.scrollLeft), 0);
        await calm.close();
        // W-5: the video waits until it is on screen (preload="none").
        assert.equal(await video.getAttribute("preload"), "none");
      }
      if (path === "welcome" && width === 390) {
        // W-5: phones see the poster only; the video downloads and plays only after a tap.
        const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const media = [];
        phone.on("request", (r) => {
          if (/\/media\/lootsplitter-promo\.(webm|mp4)/.test(r.url())) media.push(r.url());
        });
        await openApplication(phone, `${origin}/welcome`, { waitUntil: "networkidle" });
        const start = phone.getByRole("button", { name: "Play the video", exact: true });
        await start.waitFor();
        await phone.waitForTimeout(1500);
        assert.equal(await phone.locator(".ls-promo-video").evaluate((v) => v.paused), true);
        assert.deepEqual(media, [], "no promo video download before the tap");
        assert.ok((await start.boundingBox()).height >= 44);
        await start.click();
        await phone.waitForFunction(() => document.querySelector(".ls-promo-video")?.currentTime > 0.3);
        await phone.getByRole("button", { name: "Pause the video", exact: true }).click();
        assert.equal(await phone.locator(".ls-promo-video").evaluate((v) => v.paused), true);
        await phone.close();
        // Data saver on a large screen also gets the poster first.
        const saver = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await saver.addInitScript(() =>
          Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true } }),
        );
        await openApplication(saver, `${origin}/welcome`, { waitUntil: "networkidle" });
        await saver.getByRole("button", { name: "Play the video", exact: true }).waitFor();
        assert.equal(await saver.locator(".ls-promo-video").evaluate((v) => v.paused), true);
        await saver.close();
      }
      // One header, one consistent app link label, and a footer route to release details.
      assert.equal(await page.locator(".ls-header").count(), 1);
      assert.equal(await page.locator(".portal-header").count(), 0);
      const appLink = page.getByRole("link", { name: "Open the app", exact: true }).first();
      assert.equal(await appLink.isVisible(), true, `${path} app link hidden at ${width}`);
      assert.ok((await appLink.boundingBox()).height >= 44, `${path} app link target ${width}`);
      for (const old of ["Open app", "Open browser app", "Start your ledger"])
        assert.equal(await page.getByRole("link", { name: old, exact: true }).count(), 0);
      const footerNav = page.getByRole("navigation", { name: "Website footer" });
      for (const label of ["Home", "Features", "Downloads", "Changelog", "Help", "Resources", "Donate", "Privacy"])
        assert.equal(await footerNav.getByRole("link", { name: label, exact: true }).count(), 1, `${path} footer ${label}`);
      assert.equal(
        await footerNav.getByRole("link", { name: "Instagram ↗", exact: true }).getAttribute("href"),
        "https://www.instagram.com/lootsplitterdev/",
      );
      const identity = page.locator(".ls-footer-identity");
      assert.match(
        await identity.innerText(),
        new RegExp(`Android ${release.version.replaceAll(".", "\\.")} \\(code ${release.versionCode}\\)`),
      );
      assert.match(await identity.getAttribute("href"), /\/downloads#release-details$/);
      assert.equal(await page.getByText("About this app & releases", { exact: true }).count(), path === "downloads" ? 1 : 0);
      if (path === "donate")
        // Owner's wording, 2026-10-23.
        await page.getByText(/^For the price of one coffee, you can help support the development of Lootsplitter\./).waitFor();
      // Home is a header tab too (owner request 2026-10-23), marked current on the home page.
      assert.equal(
        await page.locator('.ls-header nav a[href="/welcome"]').getAttribute("aria-current"),
        path === "welcome" ? "page" : null,
      );
      const current = path === "welcome" ? null : `/${path}`;
      // Changelog, Resources and Privacy are marked current in the footer; the rest in the header too.
      const marked = ["/updates", "/resources", "/privacy"].includes(current ?? "") ? ".ls-footer-nav" : ".ls-header nav";
      if (current)
        assert.equal(
          await page.locator(`${marked} a[href="${current}"]`).getAttribute("aria-current"),
          "page",
        );
      if (width <= 768) {
        // The header collapses into an accessible menu button on phones and tablets.
        const menu = page.getByRole("button", { name: "Menu", exact: true });
        const nav = page.locator(".ls-header nav");
        assert.equal(await nav.isVisible(), false);
        assert.equal(await menu.getAttribute("aria-expanded"), "false");
        await menu.click();
        assert.equal(await menu.getAttribute("aria-expanded"), "true");
        for (const label of ["Home", "Features", "Downloads", "Help", "Donate", "My account"])
          await nav.getByRole("link", { name: label, exact: true }).waitFor();
        // Changelog and Resources moved to the footer (owner decision 2026-10-23), beside Home.
        for (const label of ["Changelog", "Resources", "Privacy"])
          assert.equal(await nav.getByRole("link", { name: label, exact: true }).count(), 0);
        await page.keyboard.press("Escape");
        assert.equal(await menu.getAttribute("aria-expanded"), "false");
        assert.equal(await nav.isVisible(), false);
      }
      if (path === "account") {
        // W-1: My account has its own tab title and never shows the app's title screen.
        assert.equal(await page.title(), "My account · Lootsplitter");
        assert.equal(await page.locator(".loot-opening").count(), 0, "account shows no title screen");
        const theme = await page.evaluate(() => {
          const site = getComputedStyle(document.querySelector(".ls-site"));
          const account = getComputedStyle(document.querySelector(".ls-account"));
          return {
            siteBackground: site.backgroundColor,
            accountBackground: account.backgroundColor,
            siteFont: site.fontFamily,
            accountFont: account.fontFamily,
            headingFont: getComputedStyle(document.querySelector(".ls-account h1")).fontFamily,
          };
        });
        assert.equal(theme.accountBackground, theme.siteBackground);
        assert.equal(theme.accountFont, theme.siteFont);
        assert.match(theme.headingFont, /Cormorant Garamond/);
      }
      if (path === "features") {
        // Owner request 2026-10-23: one tab per area instead of a long scroll, major features as
        // expandable cards, smaller ones listed, search and an audience filter.
        const tabs = page.getByRole("tab");
        const ids = ["money", "characters", "markets", "world", "maps", "encounters", "downtime", "together", "library", "platforms"];
        assert.equal(await tabs.count(), ids.length);
        for (const id of ids) {
          assert.equal(await page.locator(`#${id}-panel h2#${id}`).count(), 1, id);
          assert.ok((await page.locator(`#${id}-panel .ls-feature-card`).count()) >= 3, `${id} major`);
          assert.ok((await page.locator(`#${id}-panel .ls-feature-minor li`).count()) >= 3, `${id} minor`);
        }
        // One area at a time: a short page, not a long scroll.
        assert.equal(await page.locator("[role=tabpanel]:not([hidden])").count(), 1);
        await page.getByRole("tab", { name: "Shops & trade", exact: true }).click();
        assert.match(page.url(), /#markets$/);
        const panel = page.locator("#markets-panel");
        assert.equal(await panel.isVisible(), true);
        await page.keyboard.press("ArrowRight");
        assert.equal(await page.getByRole("tab", { name: "World", exact: true }).getAttribute("aria-selected"), "true");
        // Cards expand to their details; Expand all opens every card.
        const world = page.locator("#world-panel");
        const card = world.locator(".ls-feature-card").first();
        await card.locator("summary").click();
        assert.equal(await card.evaluate((d) => d.open), true);
        await world.getByRole("button", { name: "Expand all" }).click();
        assert.equal(await world.locator(".ls-feature-card:not([open])").count(), 0);
        // Audience filter: DM tools only shows DM-tagged items.
        await page.getByRole("radio", { name: "DM tools" }).click();
        const tagged = await world.locator(".ls-feature-card, .ls-feature-minor li").evaluateAll((els) =>
          els.every((el) => el.querySelector(".ls-dm")),
        );
        assert.ok(tagged, "DM filter shows only DM tools");
        await page.getByRole("radio", { name: "Everything" }).click();
        // Search finds a feature in another area and opens it.
        await page.getByRole("searchbox").fill("fog");
        await page.locator(".ls-feature-results button").first().click();
        assert.match(page.url(), /#maps$/);
        assert.equal(await page.locator('#maps-panel [data-feature="Fog, walls and vision"]').evaluate((d) => d.open), true);
        // Deep links from the home page open their area.
        await page.goto(`${origin}/features#downtime`, { waitUntil: "networkidle" });
        assert.equal(await page.getByRole("tab", { name: "Downtime", exact: true }).getAttribute("aria-selected"), "true");
        const images = await page.locator("main img[src^='/product/']").evaluateAll((nodes) =>
          nodes.map((img) => ({ alt: img.alt, width: img.getAttribute("width"), loading: img.loading })),
        );
        assert.ok(images.length >= 10);
        for (const image of images.filter((i) => i.width))
          assert.ok(image.alt.length > 20 && image.loading === "lazy", JSON.stringify(image));
      }
      if (path === "updates") {
        const latest = page.locator(`#android-${release.version.replaceAll(".", "\\.")}`);
        await latest
          .getByRole("heading", { name: `Version ${release.version}`, exact: true })
          .waitFor();
        const categories = [];
        for (const category of ["Added features", "Improvements", "Bug fixes"])
          if (await latest.getByRole("heading", { name: category, exact: true }).count())
            categories.push(category);
        assert.ok(categories.length >= 1);
        assert.equal(await latest.locator("ul").count(), categories.length);
        // Filters are real client state with aria-pressed.
        const all = page.getByRole("button", { name: "All releases", exact: true });
        const android = page.getByRole("button", { name: "Android", exact: true });
        const web = page.getByRole("button", { name: "Website and backend", exact: true });
        assert.equal(await all.getAttribute("aria-pressed"), "true");
        const webEntries = page.locator('article[id^="web-"]');
        const androidEntries = page.locator('article[id^="android-"]');
        assert.ok((await webEntries.count()) >= 1 && (await androidEntries.count()) >= 1);
        // Website and backend history runs from October 7 with no gap (owner rule 2026-10-23);
        // every entry names its deployed commit and its verification and live checks.
        assert.ok((await webEntries.count()) >= 14);
        for (const label of ["Complete main verification", "Publication and live checks"])
          assert.equal(
            await webEntries.getByRole("link", { name: label, exact: true }).count(),
            await webEntries.count(),
          );
        await android.click();
        assert.equal(await android.getAttribute("aria-pressed"), "true");
        assert.equal(await all.getAttribute("aria-pressed"), "false");
        assert.equal(await webEntries.first().isVisible(), false);
        assert.equal(await androidEntries.first().isVisible(), true);
        await web.click();
        assert.equal(await webEntries.first().isVisible(), true);
        assert.equal(await androidEntries.first().isVisible(), false);
        await all.click();
        assert.equal(await androidEntries.first().isVisible(), true);
        // Older Android releases stay available behind a disclosure.
        const older = androidEntries.nth(1);
        await older.getByText(/^Show changes/).click();
        assert.ok((await older.locator("li").count()) > 0);
      }
      if (path === "downloads") {
        // Technical details are folded for players (W8); the summary opens them.
        const tech = page.locator("details.ls-tech");
        assert.equal(await tech.evaluate((el) => el.open), false);
        await tech.locator("summary").click();
        const details = page.locator("#release-details");
        await details.getByText(/Browser · Client release label/).waitFor();
        const identityText = await details.innerText();
        assert.ok(
          identityText.includes(`Version ${release.version} · version code ${release.versionCode}`),
        );
        assert.equal(identityText.includes("Installed app version"), false);
        await details.getByRole("link", { name: "Web & backend history", exact: true }).waitFor();
        assert.equal(await page.locator(".ls-hash").textContent(), release.sha256);
        await page.getByText(`Permanently signed Android release, version code ${release.versionCode}.`, { exact: false }).waitFor();
        await page.getByRole("heading", { name: "Browser or Android?", exact: true }).waitFor();
        assert.equal(await page.locator(".ls-compare tbody tr").count(), 7);
        // The update notice keeps its guidance without naming old versions.
        const notice = await page.locator(".ls-notice").innerText();
        assert.match(notice, /Export a backup first/);
        assert.doesNotMatch(notice, /1\.3\.[01]/);
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${path} overflows ${width}`,
      );
      await page.screenshot({ path: `${output}/${path}-${width}.png`, fullPage: true });
    }
    // W-1: an unknown address shows the website's not-found page with a way on, never the
    // app's title screen or sign-in gate.
    const missing = await page.goto(`${origin}${NOT_FOUND_AUDIT_PATH}`, { waitUntil: "networkidle" });
    assert.equal(missing.status(), 404);
    await page.getByRole("heading", { level: 1, name: "This page wandered off", exact: true }).waitFor();
    assert.equal(await page.title(), "Page not found · Lootsplitter");
    assert.equal(await page.locator(".loot-opening").count(), 0, "404 shows no title screen");
    assert.equal(await page.getByText("Create an account or sign in", { exact: false }).count(), 0);
    const onward = page.getByRole("navigation", { name: "Where to go next" });
    for (const label of ["Home", "Help", "Open the app"])
      assert.equal(await onward.getByRole("link", { name: label, exact: true }).count(), 1, `404 ${label}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `404 overflows ${width}`);
    await page.screenshot({ path: `${output}/not-found-${width}.png`, fullPage: true });
    // A website link into My account keeps the document and shows no title screen.
    await onward.getByRole("link", { name: "Home", exact: true }).click();
    await page.getByRole("heading", { level: 1 }).filter({ hasText: "Split the loot." }).waitFor();
    await page.evaluate(() => (window.websiteAuditMarker = "account"));
    await page.getByRole("navigation", { name: "Website footer" }).getByRole("link", { name: "My account", exact: true }).click();
    await page.getByRole("heading", { level: 1 }).filter({ hasText: "Welcome to your next chapter." }).waitFor();
    assert.equal(await page.evaluate(() => window.websiteAuditMarker), "account");
    assert.equal(await page.locator(".loot-opening").count(), 0, "My account link replayed the title screen");
    await page.getByRole("link", { name: "Downloads", exact: true }).first().click();
    await page.getByRole("heading", { name: "One party. Your platform." }).waitFor();
    const download = page.getByRole("link", { name: "Download for Android", exact: true });
    assert.equal(await download.getAttribute("href"), "/download/android");
    await page.getByText("Why isn’t this on Google Play?", { exact: true }).waitFor();
    await page.getByText("Works in any modern browser, with nothing to install.", { exact: true }).waitFor();
    // The footer's release link opens the folded technical details.
    await page.locator(".ls-footer-identity").click();
    await page.waitForURL(/\/downloads#release-details$/);
    await page.locator(".ls-hash").waitFor({ state: "visible" });
    assert.equal(await page.locator(".ls-hash").textContent(), release.sha256);
    await page.getByRole("link", { name: "Installation & update guide" }).click();
    assert.match(page.url(), /\/help#android$/);
    // Client-side navigation to the public Features tour keeps the document.
    await page.evaluate(() => (window.websiteAuditMarker = "kept"));
    await page.getByRole("link", { name: "Features", exact: true }).first().click();
    await page.getByRole("heading", { level: 1, name: "Features", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/features");
    assert.equal(await page.evaluate(() => window.websiteAuditMarker), "kept");
    assert.equal(await page.locator(".loot-opening").count(), 0);
    await page.getByRole("link", { name: "Open the app", exact: true }).first().click();
    await continueIntoApp(page);
    await page
      .getByText(
        "Create an account or sign in to proceed as a Dungeon Master in your own campaign",
        { exact: true },
      )
      .waitFor();
    await page.getByRole("link", { name: "Create an account or sign in", exact: true }).waitFor();
    assert.equal(await page.evaluate(async () => (await indexedDB.databases()).length), 0);
    assert.equal(new URL(page.url()).pathname, "/");
    // Opening the app marks this browser, so the bare address now goes straight into the app.
    await page.waitForFunction(() => document.cookie.includes("lootsplit-app=1"));
    await page.waitForLoadState("networkidle");
    const returning = await context.newPage();
    await returning.goto(origin + "/");
    assert.equal(new URL(returning.url()).pathname, "/");
    await context.close();
  }
  // A first visit to the bare address (a new visitor or a search engine) opens the home page.
  {
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
    const first = await browser.newContext({
      extraHTTPHeaders: local
        ? { "cf-connecting-ip": `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1` }
        : {},
    });
    const visitor = await first.newPage();
    await visitor.goto(origin + "/");
    assert.equal(new URL(visitor.url()).pathname, "/welcome");
    await visitor.getByRole("link", { name: "Open the app", exact: true }).first().waitFor();
    assert.equal(await visitor.locator(".loot-opening").count(), 0);
    await first.close();
  }
  for (const path of abortedShots) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, `${path} exists`);
  }
  assert.deepEqual(failures, []);
  // Local fixtures keep their existing route checks; remote live audits also hash the APK bytes.
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) {
    const downloadReport = await verifyAndroidDownload(origin, release);
    await writeFile(`${output}/android-download.json`, JSON.stringify(downloadReport, null, 2));
    console.log(`PASS live Android ${release.version}: ${downloadReport.sha256}`);
  }
  console.log(
    JSON.stringify({ ok: true, widths: [1280, 768, 390, 320], pages: 10, externalFailures }, null, 2),
  );
} finally {
  await browser.close();
}
