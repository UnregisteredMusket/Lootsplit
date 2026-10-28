import { chromium } from "playwright";
import { expect } from "playwright/test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { localAccountDb } from "./account-dev-db.mjs";
import { blankSheet } from "../src/lib/characters/model.mjs";
import { blankEncounter } from "../src/lib/encounters/model.mjs";
import { openApplication } from "./title-screen-navigation.mjs";
import { answerThemedDialog } from "./themed-dialogs.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(origin))
  throw Error("Player reference fixtures require disposable loopback data.");
const output = "test-results/player-references";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
// Match the existing packaged Worker audit's disposable Wrangler D1 fixture.
// Its store is separate from the development server's SQLite file.
function workerFixtureDb() {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...bound) {
          values = bound;
          return this;
        },
        async run() {
          let index = 0;
          const command = sql.replace(/\?/g, () => {
            if (index >= values.length) throw Error("Missing fixture SQL parameter.");
            return "'" + String(values[index++]).replaceAll("'", "''") + "'";
          });
          if (index !== values.length) throw Error("Unused fixture SQL parameter.");
          execFileSync(
            process.execPath,
            [
              "node_modules/wrangler/bin/wrangler.js",
              "d1",
              "execute",
              "DB",
              "--local",
              "--command",
              command,
            ],
            { stdio: "pipe" },
          );
        },
      };
    },
    close() {},
  };
}
const db =
    new URL(origin).port === "8082" ? workerFixtureDb() : localAccountDb("data/account-dev.sqlite"),
  contexts = [],
  users = [],
  codes = [];
let activePage;
try {
  for (const width of [1280, 390]) {
    const code = "R" + crypto.randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase();
    codes.push(code);
    const host = await browser.newContext({
      viewport: { width, height: 900 },
      extraHTTPHeaders: {
        "cf-connecting-ip": `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`,
      },
    });
    contexts.push(host);
    const signup = await host.request.post(origin + "/api/account/auth/sign-up/email", {
      headers: { origin },
      data: {
        name: "Reference audit DM",
        email: `reference-${crypto.randomUUID()}@example.test`,
        password: "disposable reference password 2026",
      },
    });
    assert.equal(signup.status(), 200, await signup.text());
    const user = (await signup.json()).user.id;
    users.push(user);
    const room = {
      code,
      revision: 1,
      live: true,
      turn: 0,
      drafts: {},
      seen: { gifts: [], sales: [] },
      seats: [
        { id: "dm", token: "dm-token", role: "dm", name: "DM", purseIds: [], userId: user },
        { id: "guest", token: "player-token", role: "player", name: "Guest", purseIds: ["hero"] },
      ],
      table: {
        purses: ["hero", "other"].map((id) => ({
          id,
          kind: "character",
          name: id === "hero" ? "Reference hero" : "Other player character",
          sheet: {
            ...blankSheet(),
            name: id === "hero" ? "Reference hero" : "Other player character",
          },
          editingAllowed: false,
          coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
        })),
        holdings: [],
        shops: [],
        stock: [],
        ledger: [],
        sheets: [],
        loans: [],
        listings: [],
        notes: [],
        handouts: [
          {
            id: "shared",
            title: "Shared travel note",
            text: "A shared handout remains readable during an encounter.",
          },
        ],
        journal: { sessions: [], events: [], requests: [] },
      },
    };
    await db
      .prepare("INSERT INTO campaign_rooms (code,revision,body) VALUES (?,1,?)")
      .bind(code, JSON.stringify(room))
      .run();
    await db
      .prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)")
      .bind(user, code, "dm", "dm-token", "Reference audit")
      .run();
    await host.addInitScript(() => {
      localStorage.setItem("quire.guide.offer.v3", "seen");
    });
    const player = await browser.newContext({ viewport: { width, height: 900 } });
    contexts.push(player);
    await player.addInitScript((code) => {
      localStorage.setItem("quire.guide.offer.v3", "seen");
      sessionStorage.setItem(
        "lootsplit.player.reconnect.v1",
        JSON.stringify({
          code,
          token: "player-token",
          seatId: "guest",
          role: "player",
          purseIds: ["hero"],
        }),
      );
      localStorage.setItem(
        "lootsplit.open5e.search.v1",
        JSON.stringify(
          ["items", "spells", "creatures"].map((kind) => ({
            key: JSON.stringify({ kind, edition: "srd-2014", query: "Reference audit", page: 1 }),
            at: new Date().toISOString(),
            data: {
              count: 1,
              more: false,
              entries: [
                {
                  key: `audit-${kind}`,
                  kind,
                  edition: "srd-2014",
                  name: `Reference audit ${kind}`,
                  category: "general",
                  copper: kind === "items" ? 100 : null,
                  description: "A complete read-only reference description.",
                  facts: ["Synthetic reference fact"],
                  source: "Synthetic SRD fixture",
                  attribution: "Disposable reference audit fixture",
                  url: "https://open5e.com",
                },
              ],
            },
          })),
        ),
      );
    }, code);
    // Only the deliberate source search fails; real campaign sync and permissions stay online.
    await player.route("**/_serverFn/**", (route) =>
      route.request().postData()?.includes("Reference audit")
        ? route.abort("failed")
        : route.continue(),
    );
    const dmPage = await host.newPage(),
      page = await player.newPage(),
      errors = [];
    activePage = page;
    dmPage.guestAccessAudit = true;
    page.guestAccessAudit = true;
    for (const p of [page, dmPage]) {
      p.setDefaultTimeout(20000);
      p.on("pageerror", (e) => errors.push(e.message));
    }
    await openApplication(dmPage, origin + "/library");
    await dmPage.getByRole("button", { name: "Resume", exact: true }).click();
    await dmPage
      .locator('nav[aria-label="Sections"]:visible')
      .getByRole("link", { name: "Library", exact: true })
      .click();
    await expect(dmPage.getByLabel("Allow player reference lookup", { exact: true })).toBeChecked();
    await openApplication(page, origin + "/library");
    await expect(
      page.getByRole("heading", { name: "Shared campaign records", exact: true }),
    ).toBeVisible();
    assert.equal(
      await page.getByRole("link", { name: /Books|Resource packs|import PDF/ }).count(),
      0,
    );
    for (const [tile, kind] of [
      ["Items", "items"],
      ["Spells", "spells"],
      ["Creatures", "creatures"],
    ]) {
      await page
        .locator(".library-tiles a")
        .filter({ has: page.locator("strong", { hasText: new RegExp(`^${tile}$`) }) })
        .click();
      await expect(
        page.getByRole("combobox", { name: "Reference section", exact: true }),
      ).toHaveValue(kind);
      await page.getByLabel("Search by name", { exact: true }).fill("Reference audit");
      await page.getByRole("button", { name: "Search Open5e", exact: true }).click();
      await page.getByText(`Reference audit ${kind}`, { exact: true }).click();
      await expect(
        page.getByText("A complete read-only reference description.", { exact: true }),
      ).toBeVisible();
      assert.equal(
        await page.getByRole("button", { name: /Add to catalog|Use this loot/ }).count(),
        0,
      );
      assert.equal(await page.getByLabel("Shop list price", { exact: true }).count(), 0);
      assert.equal(
        await page.getByText(/set its shop price|add a copy to your catalog/).count(),
        0,
      );
      await page
        .locator('nav[aria-label="Sections"]:visible')
        .getByRole("link", { name: "Library", exact: true })
        .click();
      await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
      assert.equal(await page.locator(".loot-opening").count(), 0);
    }
    // Exercise the actual DM encounter start/conclude controls, without giving players enemy data.
    const id = crypto.randomUUID();
    const create = await host.request.post(origin + "/api/account/encounters/create", {
      headers: { origin },
      data: { id, code, encounter: { ...blankEncounter(), name: "Private reference encounter" } },
    });
    assert.equal(create.status(), 200, await create.text());
    await openApplication(dmPage, origin + `/encounters?encounter=${id}`);
    await dmPage.getByRole("button", { name: "Start encounter", exact: true }).click();
    await expect(dmPage.getByRole("button", { name: "Start encounter", exact: true })).toHaveCount(
      0,
    );
    await expect(page.locator(".library-tile-disabled")).toHaveCount(5);
    await expect(page.getByText("Shared travel note", { exact: true })).toBeVisible();
    await page.getByText("Shared travel note", { exact: true }).click();
    await expect(
      page.getByText("A shared handout remains readable during an encounter.", { exact: true }),
    ).toBeVisible();
    await openApplication(page, origin + "/catalog?pane=open5e&kind=creatures");
    await expect(page.getByText(/Reference lookup is paused while an encounter/)).toBeVisible();
    assert.equal(await page.getByRole("button", { name: "Search Open5e", exact: true }).count(), 0);
    await page.screenshot({ path: `${output}/blocked-${width}.png`, fullPage: true });
    await openApplication(dmPage, origin + "/library#reference-access");
    async function setReferenceControl(label, checked) {
      const input = dmPage.getByLabel(label, { exact: true });
      // These controlled values change only after the authoritative command.
      // Click once, then assert the committed value rather than an immediate native toggle.
      await input.click();
      await expect(input).toBeChecked({ checked });
    }
    await setReferenceControl("Allow lookup during active encounters", true);
    await expect(page.getByRole("button", { name: "Search Open5e", exact: true })).toBeEnabled();
    await setReferenceControl("Allow creatures lookup", false);
    await expect(page.getByLabel("Search by name", { exact: true })).toBeDisabled();
    await page
      .getByRole("combobox", { name: "Reference section", exact: true })
      .selectOption("spells");
    await expect(page.getByLabel("Search by name", { exact: true })).toBeEnabled();
    await setReferenceControl("Allow creatures lookup", true);
    await setReferenceControl("Allow lookup during active encounters", false);
    await expect(page.getByText(/Reference lookup is paused while an encounter/)).toBeVisible();
    await openApplication(dmPage, origin + `/encounters?encounter=${id}`);
    await dmPage.getByRole("button", { name: "Conclude & review loot", exact: true }).click();
    await answerThemedDialog(dmPage);
    await expect(
      dmPage.getByText("Encounter concluded. Review recipients and loot before transferring.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Search Open5e", exact: true })).toBeEnabled();
    await openApplication(dmPage, origin + "/library#reference-access");
    await setReferenceControl("Allow player reference lookup", false);
    await expect(
      page.getByText("Reference lookup is disabled by your DM.", { exact: true }),
    ).toBeVisible();
    await setReferenceControl("Allow player reference lookup", true);
    await expect(page.getByRole("button", { name: "Search Open5e", exact: true })).toBeEnabled();
    await openApplication(page, origin + "/characters");
    await page.locator(".character-library-controls > summary").click();
    await expect(page.getByLabel("Choose character", { exact: true }).locator("option")).toHaveText(
      ["Choose a character", "Reference hero"],
    );
    await openApplication(page, origin + "/?view=home");
    await page.getByRole("button", { name: "Help", exact: true }).click();
    const guide = page.getByRole("dialog", { name: "How Lootsplitter works", exact: true });
    await expect(guide.getByRole("heading", { name: "Player guide", exact: true })).toBeVisible();
    await guide.getByRole("searchbox").fill("lookup");
    await expect(guide.locator("#guide-references[open]")).toBeVisible();
    assert.equal(
      await guide
        .getByRole("link", {
          name: /DM books|Encounter builder|Player reference controls|Saved DM shortcut/,
        })
        .count(),
      0,
    );
    await page.screenshot({ path: `${output}/player-help-${width}.png`, fullPage: true });
    // W-3: a player can explicitly switch the in-app guide to the DM guide and back.
    const guideFor = guide.getByRole("group", { name: "Guide for", exact: true });
    await guideFor.getByRole("button", { name: "Dungeon Masters", exact: true }).click();
    await expect(guide.getByRole("heading", { name: "Dungeon Master guide", exact: true })).toBeVisible();
    await guideFor.getByRole("button", { name: "Players", exact: true }).click();
    await expect(guide.getByRole("heading", { name: "Player guide", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator(".settings-trigger:visible").first().click();
    const settings = page.getByRole("dialog", { name: "Settings & Management", exact: true });
    await settings.getByRole("button", { name: "Help", exact: true }).click();
    await settings.getByRole("link", { name: "Guides & help", exact: false }).click();
    await expect(page.getByRole("heading", { name: "Player guide", exact: true })).toBeVisible();
    await page.getByRole("searchbox").fill("lookup");
    await expect(page.locator("#references[open]")).toBeVisible();
    await page.getByRole("link", { name: "Library", exact: false }).first().click();
    await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
    await page.screenshot({ path: `${output}/player-library-${width}.png`, fullPage: true });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
    );
    assert.deepEqual(errors, []);
    await player.close();
    await host.close();
  }
  console.log(
    "Player Library/Help: read-only cached item/spell/creature searches, real encounter start/conclusion, direct-link block, DM section/overall/encounter overrides, shared handouts and assigned-character selector passed on desktop/mobile.",
  );
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${output}/failure.png`, fullPage: true });
    await writeFile(`${output}/failure.txt`, await activePage.locator("body").innerText());
  }
  throw error;
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  for (const code of codes)
    await db.prepare("DELETE FROM campaign_rooms WHERE code=?").bind(code).run();
  for (const user of users) await db.prepare("DELETE FROM user WHERE id=?").bind(user).run();
  db.close();
  await browser.close();
}
