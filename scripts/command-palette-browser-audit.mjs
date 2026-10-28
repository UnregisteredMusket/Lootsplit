// Command palette and keyboard shortcuts (design D5, Q1, Q12) in a disposable device campaign at
// 1280, 390 and 320: Ctrl+K and "/" open an accessible combobox; arrows and Enter open a record,
// a screen or an action's existing flow (no command runs); "?" lists the shortcuts; g then a letter
// goes to a main screen; none of the letter keys fire in a text field or on Maps; the phone header
// has a search button; a player seat never finds hidden NPCs, DM-only maps or another character's
// items. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { continueIntoApp, openApplication } from "./title-screen-navigation.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = `${process.env.AUDIT_RESULTS_DIR || "test-results"}/command-palette`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
async function seed(page) {
  await page.evaluate(async () => {
    const { readJournal } = await import("/src/lib/quire/journal.ts");
    const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
    const coins = (gp) => ({ cp: 0, sp: 0, ep: 0, gp, pp: 0 });
    const holding = (id, purseId, name) => ({
      id,
      purseId,
      name,
      kind: "item",
      quantity: 1,
      unitCopper: 100,
      notes: "",
    });
    await applyCloudTable({
      purses: [
        { id: "party", name: "Party treasury", kind: "party", coins: coins(10) },
        { id: "audit-hero", name: "Mira Ashfall", kind: "character", coins: coins(5) },
        { id: "audit-rival", name: "Bram Stoneward", kind: "character", coins: coins(5) },
        { id: "jarl", name: "Jarl Birger", kind: "character", control: "npc", coins: coins(0) },
        { id: "spy", name: "Hidden Spy", kind: "character", control: "npc", coins: coins(0) },
      ],
      holdings: [
        holding("h-rope", "audit-hero", "Silk rope"),
        holding("h-letter", "audit-rival", "Sealed letter"),
        holding("h-pearl", "party", "Pearl necklace"),
      ],
      shops: [],
      stock: [],
      ledger: [],
      listings: [],
      loans: [],
      sheets: [],
      notes: [],
      journal: readJournal({
        market: {
          currentLocationId: "city",
          locations: [
            { id: "region", kind: "region", parentId: null, name: "Valika", description: "North" },
            { id: "city", kind: "city", parentId: "region", name: "Erlefurt", description: "Town" },
          ],
        },
        world: {
          npcs: [
            {
              id: "jarl",
              name: "Jarl Birger",
              description: "",
              locationId: "city",
              visible: true,
              barterAllowed: true,
              controllerPurseId: null,
            },
            {
              id: "spy",
              name: "Hidden Spy",
              description: "",
              locationId: "city",
              visible: false,
              barterAllowed: false,
              controllerPurseId: null,
            },
          ],
          maps: [
            {
              id: "atlas",
              name: "Atlas of Valika",
              image: "data:image/png;base64,AAAA",
              visible: true,
              locationId: "region",
              anchors: [],
              markers: [],
            },
            {
              id: "vault",
              name: "DM vault map",
              image: "data:image/png;base64,AAAA",
              visible: false,
              locationId: null,
              anchors: [],
              markers: [],
            },
          ],
        },
      }),
    });
  });
}

const setRole = (page, role, purseIds) =>
  page.evaluate(
    async ({ role, purseIds }) => {
      const t = await import("/src/lib/quire/table.ts");
      t.setSeat({ ...t.getSeat(), role, ...(purseIds ? { purseIds } : {}) });
    },
    { role, purseIds },
  );

try {
  for (const width of [1280, 390, 320]) {
    const phone = width < 600;
    const context = await browser.newContext({
      viewport: { width, height: width === 320 ? 640 : width === 390 ? 844 : 900 },
      hasTouch: phone,
      // Its own documentation-range address per width: the DM fixture signs up through the
      // account API, which rate-limits by address across every audit sharing the dev server
      // (main's run at e74a5b0 failed here with "Fixture identity: 429").
      extraHTTPHeaders: {
        "cf-connecting-ip": `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`,
      },
    });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const go = async (path) => {
      // A reload mid-navigation can abort the first attempt; the second one lands.
      await page.goto(origin + path).catch(async (e) => {
        if (!/ERR_ABORTED/.test(e.message)) throw e;
        await page.goto(origin + path);
      });
      await continueIntoApp(page);
      await page.locator(".concept-main").waitFor();
    };
    try {
      await openApplication(page, origin + "/");
      await setRole(page, "dm");
      await seed(page);
      await go("/party");
      const dialog = page.getByRole("dialog", { name: "Search Lootsplitter", exact: true });
      const box = dialog.getByRole("combobox", {
        name: "Search screens, records and actions",
        exact: true,
      });
      const trigger = page.getByRole("button", { name: /^Search \((Ctrl\+|⌘)K\)$/ });

      // 1. The header search button is there at every width (the phone entry point).
      await expect(trigger).toBeVisible();
      const size = await trigger.boundingBox();
      assert.ok(size.width >= 44 && size.height >= 44, `${width}: search button is a 44 px target`);
      await trigger.click();
      await expect(box).toBeFocused();
      await expect(box).toHaveAttribute("aria-expanded", "true");
      // Empty query: actions and screens, no record dump.
      await expect(dialog.getByRole("group", { name: "Actions", exact: true })).toBeVisible();
      await expect(dialog.getByRole("group", { name: "Records", exact: true })).toHaveCount(0);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
        `${width}: the palette does not scroll sideways`,
      );
      await page.screenshot({ path: `${output}/palette-${width}.png` });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);

      // 2. Ctrl+K, type, arrows move aria-activedescendant, Enter opens the record.
      await page.keyboard.press("Control+k");
      await expect(box).toBeFocused();
      await box.fill("jarl");
      const first = dialog.getByRole("option").first();
      await expect(first).toContainText("Jarl Birger");
      await expect(first).toHaveAttribute("aria-selected", "true");
      assert.equal(await box.getAttribute("aria-activedescendant"), await first.getAttribute("id"));
      await page.keyboard.press("Enter");
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).pathname).toBe("/features/npcs");
      assert.equal(new URL(page.url()).searchParams.get("npc"), "jarl");
      // The DM finds hidden records too.
      await page.keyboard.press("Control+k");
      await box.fill("hidden spy");
      await expect(dialog.getByRole("option").first()).toContainText("Hidden Spy");
      await box.fill("zzqx");
      await expect(dialog.getByRole("status")).toContainText("Nothing matches");
      await page.keyboard.press("Escape");

      // 3. Actions open the existing flow and run nothing: Advance 8 h fills Session Time only.
      const before = await page.evaluate(async () =>
        (await import("/src/lib/quire/economy.ts")).economySnapshot(),
      );
      await page.keyboard.press("Control+k");
      await box.fill("advance");
      await dialog.getByRole("option", { name: /Advance 8 h/ }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe("/features/time");
      await expect(page.getByLabel("Hours to advance")).toHaveValue("8");
      const after = await page.evaluate(async () =>
        (await import("/src/lib/quire/economy.ts")).economySnapshot(),
      );
      assert.deepEqual(
        after.journal.finance,
        before.journal.finance,
        "opening Session Time changes no time",
      );
      assert.deepEqual(after.ledger, before.ledger, "the palette posts no ledger lines");
      await page.keyboard.press("Control+k");
      await box.fill("new quest");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("article", { name: "New quest", exact: true })).toBeVisible();

      if (!phone) {
        // 4. "/" opens the palette outside fields, "?" the cheat sheet, g then p / d go.
        await go("/party");
        await page.locator("main#main").focus();
        await page.keyboard.press("/");
        await expect(box).toBeFocused();
        // Typing "/" inside the palette's field is just text.
        await page.keyboard.type("a/b");
        await expect(box).toHaveValue("a/b");
        await page.keyboard.press("Escape");
        await page.keyboard.press("Shift+?");
        const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
        await expect(sheet).toBeVisible();
        await expect(sheet).toContainText("Go to Desk");
        await page.screenshot({ path: `${output}/shortcuts-${width}.png` });
        await page.keyboard.press("Escape");
        await expect(sheet).toHaveCount(0);
        await page.locator("main#main").focus();
        await page.keyboard.press("g");
        await page.keyboard.press("d");
        await expect.poll(() => new URL(page.url()).pathname).toBe("/");
        await page.locator("main#main").focus();
        await page.keyboard.press("g");
        await page.keyboard.press("p");
        await expect.poll(() => new URL(page.url()).pathname).toBe("/party");
        // In a text field the letters are text, not shortcuts.
        await go("/library");
        const search = page.getByLabel("Search library destinations and catalog", { exact: true });
        await search.click();
        await page.keyboard.type("g/d?");
        await expect(search).toHaveValue("g/d?");
        assert.equal(new URL(page.url()).pathname, "/library");
        await expect(dialog).toHaveCount(0);
        // On Maps "/" belongs to the map's own search; Ctrl+K still opens the palette.
        await go("/maps");
        await page.locator("body").press("/");
        await expect(dialog).toHaveCount(0);
        await page.keyboard.press("Control+k");
        await expect(box).toBeFocused();
        await page.keyboard.press("Escape");
      }

      // 4b. Settings & Management → Help → Keyboard shortcuts; below 1024 px Tabs & windows
      // leaves the header (design M4) and stays in Settings → Appearance.
      await go("/party");
      const settings = page.getByRole("dialog", { name: "Settings & Management", exact: true });
      await page.getByRole("button", { name: "Settings & Management", exact: true }).click();
      await settings.getByRole("button", { name: /^Help/ }).click();
      await settings.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      if (!phone)
        await expect(page.getByRole("button", { name: "Tabs & windows", exact: true })).toBeVisible();
      if (phone) {
        await expect(page.getByRole("button", { name: "Tabs & windows", exact: true })).toBeHidden();
        await page.getByRole("button", { name: "Settings & Management", exact: true }).click();
        await settings.getByRole("button", { name: /^Appearance/ }).click();
        await settings.getByRole("button", { name: "Tabs & windows…", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "Tabs & windows", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await page.screenshot({ path: `${output}/header-${width}.png`, clip: { x: 0, y: 0, width, height: 80 } });
      }

      // 5. A player seat finds only what their projection holds.
      await setRole(page, "player", ["audit-hero"]);
      await go("/party");
      await page.keyboard.press("Control+k");
      for (const [query, expected] of [
        ["jarl", "Jarl Birger"],
        ["silk rope", "Silk rope"],
          ["atlas", "Atlas of Valika"],
      ]) {
        await box.fill(query);
        await expect(dialog.getByRole("option").first()).toContainText(expected);
      }
      for (const hidden of [
        "Hidden Spy",
        "DM vault map",
        "Sealed letter",
        "Award loot",
        "Review Inbox",
      ]) {
        await box.fill(hidden);
        await expect(dialog.getByRole("option").filter({ hasText: hidden })).toHaveCount(0);
      }
      await page.keyboard.press("Escape");
      assert.deepEqual(errors, [], `${width}: no page errors`);
    } catch (error) {
      await page.screenshot({ path: `${output}/failure-${width}.png` }).catch(() => {});
      throw error;
    }
    await context.close();
    console.log(`PASS ${width}`);
  }
  console.log(
    "PASS: command palette (Ctrl+K, /, header button), combobox keyboard, records/screens/actions, no command runs, ? cheat sheet, g shortcuts, text fields and Maps keep their keys, player visibility, 1280/390/320.",
  );
} finally {
  await browser.close();
}
