import { chooseOption } from "./search-select-browser.mjs";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import {
  prepareDmFixture,
  openApplication,
  reloadApplication,
} from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(
  origin,
  /^http:\/\/(127\.0\.0\.1|localhost):/,
  "Resource fixtures require a disposable server.",
);
const pack = JSON.parse(await readFile("docs/examples/resource-pack.json", "utf8"));
const incomplete = structuredClone(pack.entries[0]);
incomplete.id = "incomplete";
incomplete.name = "Incomplete Guardian";
incomplete.stats.hp = null;
pack.entries.push(incomplete);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/resource-packs", { recursive: true });
async function records(page) {
  return page.evaluate(async () => {
    const current = localStorage.getItem("quire.campaign.v1");
    const name =
      JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((c) => c.id === current)
        ?.db || "quire";
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const result = {};
      for (const store of ["meta", "purses", "holdings", "shops", "stock", "ledger", "catalog"])
        result[store] = await new Promise((resolve, reject) => {
          const r = db.transaction(store).objectStore(store).getAll();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      return result;
    } finally {
      db.close();
    }
  });
}
function upload(value) {
  return {
    name: "synthetic-resource-pack.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  };
}
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      serviceWorkers: "block",
      // Isolate the first account lookup too; DM setup assigns its signup identity later.
      extraHTTPHeaders: {
        "cf-connecting-ip": `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`,
      },
    });
    await context.route(
      (url) => url.origin !== origin && !["blob:", "data:"].includes(url.protocol),
      (route) => route.abort(),
    );
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await prepareDmFixture(page, origin);
    await openApplication(page, origin + "/library");
    const section = page.getByRole("region", { name: "Resource packs", exact: true });
    await expect(section.getByLabel("Resource pack JSON", { exact: true })).toBeEnabled();
    const before = await records(page);
    await section
      .getByLabel("Resource pack JSON", { exact: true })
      .setInputFiles(upload({ format: "wrong" }));
    await expect(section.getByRole("alert")).toBeVisible();
    await expect(
      section.getByRole("button", { name: "Apply resource pack", exact: true }),
    ).toHaveCount(0);
    await section.getByLabel("Resource pack JSON", { exact: true }).setInputFiles(upload(pack));
    await section.getByRole("button", { name: "Review resource pack", exact: true }).click();
    await expect(section.getByLabel("Resource import preview")).toContainText(
      "Import: 7 references",
    );
    await section.getByRole("button", { name: "Apply resource pack", exact: true }).click();
    await expect(section.getByRole("status")).toContainText("Resource pack imported");
    const imported = await records(page);
    for (const store of ["purses", "holdings", "shops", "stock", "ledger"])
      assert.deepEqual(imported[store], before[store]);
    assert.equal(
      imported.meta.find((r) => r.id === "journal").value.resourceLibrary.packs.length,
      1,
    );
    await section.getByLabel("Resource pack JSON", { exact: true }).setInputFiles(upload(pack));
    await section.getByRole("button", { name: "Review resource pack", exact: true }).click();
    await expect(section.getByLabel("Resource import preview")).toContainText(
      "Reuse: 7 references",
    );
    await section.getByRole("button", { name: "Apply resource pack", exact: true }).click();
    await expect(section.getByRole("status")).toContainText("no duplicate references");
    assert.equal(
      (await records(page)).meta.find((r) => r.id === "journal").value.resourceLibrary.packs.length,
      1,
    );
    await section
      .getByRole("button", { name: "Review campaign locations and shops", exact: true })
      .click();
    await expect(section.getByLabel("Resource location preview")).toContainText(
      "2 new locations · 1 new closed, empty shops",
    );
    await section
      .getByRole("button", { name: "Apply campaign locations and shops", exact: true })
      .click();
    await expect(section.getByRole("status")).toContainText(
      "Campaign locations and shops imported",
    );
    const materialized = await records(page);
    assert.equal(materialized.shops.filter((s) => s.name === "Reed Workshop").length, 1);
    assert.equal(materialized.shops.find((s) => s.name === "Reed Workshop").closed, true);
    assert.deepEqual(materialized.stock, before.stock);
    await section
      .getByRole("button", { name: "Review campaign locations and shops", exact: true })
      .click();
    await expect(section.getByLabel("Resource location preview")).toContainText(
      "0 new locations · 0 new closed, empty shops",
    );
    await section
      .getByRole("button", { name: "Apply campaign locations and shops", exact: true })
      .click();
    await section.getByRole("button", { name: "Add Reed Charm to catalogue", exact: true }).click();
    await expect(section.getByRole("alert")).toContainText("Enter a nonnegative");
    await section.getByLabel("Price for Reed Charm", { exact: true }).fill("150");
    await section.getByRole("button", { name: "Add Reed Charm to catalogue", exact: true }).click();
    await expect(section.getByRole("status")).toContainText("Item added");
    await expect(
      section.getByRole("button", { name: "Add Reed Charm to catalogue", exact: true }),
    ).toBeDisabled();
    assert.equal(
      (await records(page)).catalog.find((i) => i.name === "Reed Charm").baseCopper,
      150,
    );
    const download = page.waitForEvent("download");
    await section.getByRole("button", { name: "Export resource pack", exact: true }).click();
    assert.deepEqual(JSON.parse(await readFile(await (await download).path(), "utf8")), pack);
    await page.screenshot({
      path: `test-results/resource-packs/library-${width}.png`,
      fullPage: true,
    });
    await page.evaluate(() => (window.libraryDocumentMarker = "same-document"));
    await section
      .getByRole("link", { name: "Open Reed Guardian in Library →", exact: true })
      .click();
    const entry = page.getByRole("article", { name: "Library entry", exact: true });
    await expect(entry.getByRole("heading", { name: "Reed Guardian", exact: true })).toBeVisible();
    await expect(entry).toContainText("Reed Lash");
    await expect(entry).toContainText("PDF p. 12");
    assert.deepEqual(JSON.parse(new URL(page.url()).searchParams.get("record").slice(7)), [
      "resource",
      pack.id,
      pack.revision,
      "reed-guardian",
    ]);
    assert.equal(await page.evaluate(() => window.libraryDocumentMarker), "same-document");
    assert.equal(await page.locator(".loot-opening").count(), 0);
    await page.screenshot({ path: `test-results/resource-packs/entry-${width}.png` });
    await page.goBack();
    await section
      .getByRole("link", { name: "Open Reed Workshop in Library →", exact: true })
      .click();
    await entry.getByRole("link", { name: "Reed Port →", exact: true }).click();
    await expect(entry.getByRole("heading", { name: "Reed Port", exact: true })).toBeVisible();
    await entry.getByRole("link", { name: "Close entry", exact: true }).click();
    const librarySearch = page.getByLabel("Search library destinations and catalog", {
      exact: true,
    });
    await librarySearch.fill("guardian");
    await chooseOption(page.getByLabel("Library record type", { exact: true }), "Monster");
    await expect(page.locator(".library-record-list a")).toHaveCount(2);
    await librarySearch.fill("no-such-entry");
    await expect(page.locator(".library-record-list a")).toHaveCount(0);
    await expect(page.getByText("No entries match your search.", { exact: true })).toBeVisible();
    await librarySearch.fill("");
    await chooseOption(page.getByLabel("Library record type", { exact: true }), "");
    await section.getByRole("link", { name: "Use creatures in Encounters →", exact: true }).click();
    assert.equal(await page.locator(".loot-opening").count(), 0);
    await page.getByRole("button", { name: "New encounter", exact: true }).click();
    await page.getByRole("button", { name: "Builder & generator", exact: true }).click();
    const creatures = page.getByRole("region", { name: "Imported creatures", exact: true });
    await expect(
      creatures.getByRole("button", { name: "Add imported Incomplete Guardian", exact: true }),
    ).toBeDisabled();
    await creatures.getByLabel("Find an imported monster", { exact: true }).click();
    const monsterMenu = page.locator(".record-select-menu:visible");
    await monsterMenu.getByRole("combobox").fill("Reed Guardian");
    await expect(monsterMenu.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(
      creatures.getByRole("button", { name: "Add imported Incomplete Guardian", exact: true }),
    ).toHaveCount(0);
    await chooseOption(creatures.getByLabel("Find an imported monster", { exact: true }), "");
    await creatures
      .getByRole("button", { name: "Add imported Reed Guardian", exact: true })
      .click();
    await chooseOption(page.getByLabel("Generation target", { exact: true }), "cr");
    await chooseOption(page.getByLabel("Enemy CR", { exact: true }), "1");
    await page.getByLabel("Enemy count", { exact: true }).fill("2");
    await creatures
      .getByRole("button", { name: "Generate from imported creatures", exact: true })
      .click();
    await page.getByLabel("Encounter name", { exact: true }).fill(`Resource encounter ${width}`);
    await page.getByRole("button", { name: "Save encounter", exact: true }).click();
    await expect(page.getByText("Encounter saved.", { exact: true })).toBeVisible();
    const stored = (await records(page)).meta.find((r) => r.id === "localEncounters").rows;
    const encounter = stored.find((e) => e.body.name === `Resource encounter ${width}`);
    assert.equal(encounter.body.combatants.length, 3);
    assert.equal(new Set(encounter.body.combatants.map((c) => c.id)).size, 3);
    for (const c of encounter.body.combatants) {
      assert.equal(c.maxHp, 22);
      assert.equal(c.notes, pack.entries[0].text);
      assert.match(c.source, /PDF p. 12/);
    }
    await reloadApplication(page);
    await page.getByRole("button", { name: new RegExp(`Resource encounter ${width}`) }).click();
    await page.getByRole("button", { name: "Builder & generator", exact: true }).click();
    await expect(page.getByLabel("Creature resource pack", { exact: true })).toContainText(
      pack.title,
    );
    await page.screenshot({
      path: `test-results/resource-packs/encounter-${width}.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 900 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "320px viewport has no horizontal overflow.",
    );
    assert.deepEqual(errors, []);
    // Optional private local fixture files are never committed or supplied to public CI.
    if (width === 390 && process.env.RESOURCE_PACK_FILES) {
      const files = JSON.parse(process.env.RESOURCE_PACK_FILES);
      const additional = await Promise.all(
        files.map(async (file) => ({ file, pack: JSON.parse(await readFile(file, "utf8")) })),
      );
      await page
        .locator('nav[aria-label="Sections"]:visible')
        .getByRole("link", { name: "Library", exact: true })
        .click();
      const beforeBook = await records(page);
      for (const record of additional) {
        await section.getByLabel("Resource pack JSON", { exact: true }).setInputFiles(record.file);
        await section.getByRole("button", { name: "Review resource pack", exact: true }).click();
        await expect(section.getByLabel("Resource import preview")).toContainText(
          `Import: ${record.pack.entries.length} references`,
        );
        await section.getByRole("button", { name: "Apply resource pack", exact: true }).click();
        await expect(section.getByRole("status")).toContainText("Resource pack imported");
      }
      const afterBook = await records(page);
      for (const store of ["purses", "holdings", "shops", "stock", "ledger", "catalog"])
        assert.deepEqual(afterBook[store], beforeBook[store]);
      assert.equal(
        afterBook.meta.find((r) => r.id === "journal").value.resourceLibrary.packs.length,
        1 + additional.length,
      );
      await reloadApplication(page);
      for (const record of additional) {
        await section.getByLabel("Resource pack JSON", { exact: true }).setInputFiles(record.file);
        await section.getByRole("button", { name: "Review resource pack", exact: true }).click();
        await expect(section.getByLabel("Resource import preview")).toContainText(
          `Reuse: ${record.pack.entries.length} references`,
        );
        await section.getByRole("button", { name: "Apply resource pack", exact: true }).click();
        await expect(section.getByRole("status")).toContainText("no duplicate references");
      }
      const source = additional.find((r) => r.pack.entries.some((e) => e.kind === "creature"));
      const creature = source.pack.entries.find((e) => e.kind === "creature");
      await section
        .getByRole("link", { name: "Use creatures in Encounters →", exact: true })
        .click();
      await page.getByRole("button", { name: "New encounter", exact: true }).click();
      await page.getByRole("button", { name: "Builder & generator", exact: true }).click();
      await chooseOption(page.getByLabel("Creature resource pack", { exact: true }), {
        label: `${source.pack.title} · ${source.pack.revision}`,
      });
      await page.getByLabel("Search imported creatures", { exact: true }).fill(creature.name);
      await page
        .getByRole("button", { name: `Add imported ${creature.name}`, exact: true })
        .click();
      await page.getByLabel("Encounter name", { exact: true }).fill("Private source pack check");
      await page.getByRole("button", { name: "Save encounter", exact: true }).click();
      await expect(page.getByText("Encounter saved.", { exact: true })).toBeVisible();
      const rows = (await records(page)).meta.find((r) => r.id === "localEncounters").rows;
      const copied = rows.find((e) => e.body.name === "Private source pack check").body
        .combatants[0];
      assert.equal(copied.ac, creature.stats.ac);
      assert.equal(copied.maxHp, creature.stats.hp);
      assert.ok(copied.notes.startsWith(creature.text));
      assert.deepEqual(errors, []);
      console.log(
        `PASS: ${additional.length} private source files imported, reloaded, reused and copied into a saved encounter without economic changes.`,
      );
    }
    // A long real import must remain searchable beyond the first displayed option batch.
    await page
      .locator('nav[aria-label="Sections"]:visible')
      .getByRole("link", { name: "Library", exact: true })
      .click();
    const bulk = {
      ...pack,
      id: "bulk-locations",
      title: "Synthetic Location Index",
      entries: Array.from({ length: 105 }, (_, i) => ({
        id: `place-${i}`,
        kind: "location",
        name: `Imported Region ${String(i).padStart(3, "0")}`,
        locationKind: "region",
        parentId: null,
        text: "Synthetic place for picker verification.",
        tags: [],
        warnings: [],
        sources: [{ book: "Synthetic index", pdfPage: i + 1, printedPage: null }],
      })),
    };
    await section.getByLabel("Resource pack JSON", { exact: true }).setInputFiles(upload(bulk));
    await section.getByRole("button", { name: "Review resource pack", exact: true }).click();
    await section.getByRole("button", { name: "Apply resource pack", exact: true }).click();
    await expect(section.getByRole("status")).toContainText("Resource pack imported");
    await section
      .getByRole("button", { name: "Review campaign locations and shops", exact: true })
      .click();
    await section
      .getByRole("button", { name: "Apply campaign locations and shops", exact: true })
      .click();
    await expect(section.getByRole("status")).toContainText(
      "Campaign locations and shops imported",
    );
    await page
      .locator('nav[aria-label="Sections"]:visible')
      .getByRole("link", { name: "Maps", exact: true })
      .click();
    await page.getByRole("button", { name: "Manage campaign locations", exact: true }).click();
    const locationPicker = page.getByLabel("Party location", { exact: true });
    await locationPicker.click();
    const menu = page.locator(".record-select-menu:visible");
    await expect(menu.getByRole("option")).toHaveCount(60);
    await menu.getByRole("button", { name: /^Show more results/ }).click();
    assert.ok((await menu.getByRole("option").count()) > 60);
    await menu.getByRole("combobox").fill("no-such-place");
    await expect(menu.getByText("No matching records.", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(locationPicker).toHaveText("All campaign shops · no location set");
    await locationPicker.click();
    await menu.getByRole("combobox").fill("Imported Region 097");
    await expect(menu.getByRole("option")).toHaveCount(1);
    await page.screenshot({ path: `test-results/resource-packs/location-search-${width}.png` });
    await page.keyboard.press("Enter");
    await expect(locationPicker).toHaveText("Imported Region 097 · region");
    await chooseOption(locationPicker, "");
    await expect(locationPicker).toHaveText("All campaign shops · no location set");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS: resource file review, duplicate protection, reference export, canonical closed/empty locations and shops, explicit item price, imported encounter copies/generation/reload, desktop/mobile and 320px fit.",
  );
} finally {
  await browser.close();
}
