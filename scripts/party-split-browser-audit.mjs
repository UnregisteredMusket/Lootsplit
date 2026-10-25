// Split the party (mockups approved 2026-10-25) in a disposable device campaign at 1280, 390 and
// 320 px: the DM splits the party into two groups (one moves to Ironhold), sees the Groups panel,
// a player of each group sees their own group and only their own place's shops, buying fails
// across groups and works at home, the DM moves a group back and merges, and the party is whole
// again. No sideways scrolling anywhere. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const out = "test-results/party-split";
await mkdir(out, { recursive: true });
const noOverflow = async (page, label) => {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${label}: the page scrolls sideways`,
  );
  const dialog = page.getByRole("dialog");
  if (await dialog.count())
    assert.equal(
      await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      false,
      `${label}: the dialog scrolls sideways`,
    );
};
const book = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    return await economySnapshot();
  });
const seatAs = (page, purseIds) =>
  page.evaluate(async (ids) => {
    const { setSeat, DM_SEAT } = await import("/src/lib/quire/table.ts");
    setSeat(ids ? { ...DM_SEAT, role: "player", purseIds: ids, shopIds: ["chandlery", "armoury", "peddler"], openedAt: Date.now() } : DM_SEAT);
  }, purseIds);

try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 780 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/party?section=characters");
    // Disposable campaign "The Sunken Crown": the party stands at Saltmarsh · Harbour ward.
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const { fromCopper } = await import("/src/lib/quire/money.ts");
      const shop = (id, name, locationId) => ({ id, name, keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "general", priceScale: 1, acceptAnyCategory: true, ...(locationId ? { locationId } : {}) });
      const line = (id, shopId, name, copper) => ({ id, shopId, name, copper, quantity: 10, notes: "", baseCopper: copper, rarity: "common" });
      await applyCloudTable({
        purses: [
          { id: "hoard", name: "The Hoard", kind: "party", coins: fromCopper(7039) },
          { id: "brannoc", name: "Brannoc Vale", kind: "character", coins: fromCopper(4130) },
          { id: "oriel", name: "Oriel Ashdown", kind: "character", coins: fromCopper(2800) },
          { id: "tamsin", name: "Tamsin Reed", kind: "character", coins: fromCopper(1794) },
          { id: "kettle", name: "Kettle", kind: "character", coins: fromCopper(2200) },
        ],
        holdings: [],
        shops: [shop("chandlery", "Saltmarsh Chandlery", "harbour"), shop("armoury", "Ironhold Armoury", "ironhold"), shop("peddler", "Wandering peddler")],
        stock: [line("rope", "chandlery", "Hempen rope", 100), line("sword", "armoury", "Longsword", 1500), line("sack", "peddler", "Sack", 10)],
        ledger: [],
        listings: [],
        loans: [],
        sheets: [],
        notes: [],
        journal: readJournal({
          market: {
            currentLocationId: "harbour",
            locations: [
              { id: "coast", name: "The Sunken Coast", kind: "region", parentId: null, description: "" },
              { id: "saltmarsh", name: "Saltmarsh", kind: "town", parentId: "coast", description: "" },
              { id: "harbour", name: "Harbour ward", kind: "area", parentId: "saltmarsh", description: "" },
              { id: "ironhold", name: "Ironhold", kind: "town", parentId: "coast", description: "" },
            ],
          },
        }),
      });
    });
    await reloadApplication(page, origin + "/party?section=characters");

    // 1. The DM splits the party.
    await page.getByRole("button", { name: "Split the party", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Group A name").fill("Harbour watch");
    await dialog.getByLabel("Group B name").fill("Ironhold riders");
    await dialog.getByRole("combobox", { name: /Where group B is/ }).selectOption("ironhold");
    for (const who of ["Tamsin Reed", "Kettle"])
      await dialog.getByRole("group", { name: `Group for ${who}` }).getByRole("button", { name: "Ironhold riders (group B)" }).click();
    await noOverflow(page, `split ${width}`);
    await page.screenshot({ path: `${out}/split-${width}.png`, fullPage: true });
    await dialog.getByRole("button", { name: "Review split…" }).click();
    await dialog.getByText("Split the party into 2 groups?").waitFor();
    await dialog.getByText("Everyone is still in the party.").waitFor();
    await noOverflow(page, `confirm ${width}`);
    await page.screenshot({ path: `${out}/confirm-${width}.png`, fullPage: true });
    await dialog.getByRole("button", { name: "Split the party", exact: true }).click();
    await dialog.getByText("The party is split").first().waitFor();
    await dialog.getByText(/nothing charged, no time passed/).waitFor();
    await noOverflow(page, `receipt ${width}`);
    await page.screenshot({ path: `${out}/receipt-${width}.png`, fullPage: true });
    await dialog.getByRole("button", { name: "See groups" }).click();
    await dialog.waitFor({ state: "detached" });
    let t = await book(page);
    assert.equal(t.journal.world.groups.length, 1);
    const riders = t.journal.world.groups[0];
    assert.equal(riders.locationId, "ironhold");
    assert.deepEqual(t.journal.world.characterPositions.filter((s) => s.groupId === riders.id).map((s) => s.purseId).sort(), ["kettle", "tamsin"]);
    assert.equal(t.ledger.length, 0, "splitting charges nothing");

    // 2. The Groups panel.
    const panel = page.locator("#party-groups");
    await panel.getByRole("heading", { name: "Groups · the party is split" }).waitFor();
    await panel.getByRole("article", { name: "Harbour watch, group A" }).waitFor();
    await panel.getByRole("article", { name: "Ironhold riders, group B" }).getByText("Ironhold", { exact: true }).waitFor();
    await noOverflow(page, `panel ${width}`);
    await page.screenshot({ path: `${out}/groups-${width}.png`, fullPage: true });

    // 3. Each group's player sees their own group, and buys only at their own place.
    await seatAs(page, ["tamsin"]);
    await reloadApplication(page, origin + "/party");
    await page.getByText("You're with Ironhold riders").first().waitFor();
    await page.getByText(/Harbour watch.*Saltmarsh · Harbour ward/).first().waitFor();
    await noOverflow(page, `player B ${width}`);
    await page.screenshot({ path: `${out}/player-b-${width}.png`, fullPage: true });
    await reloadApplication(page, origin + "/market");
    await page.getByText("Ironhold Armoury").first().waitFor();
    assert.equal(await page.getByText("Saltmarsh Chandlery").count(), 0, "group B doesn't see Harbour ward's shops");
    const across = await page.evaluate(async () => {
      const { buyFromShop } = await import("/src/lib/quire/economy.ts");
      const refused = await buyFromShop({ stockId: "rope", purseId: "tamsin", quantity: 1 }).then(() => "", (e) => e.message);
      await buyFromShop({ stockId: "sword", purseId: "tamsin", quantity: 1 });
      return refused;
    });
    assert.match(across, /not available at the current location/);
    await seatAs(page, ["brannoc"]);
    await reloadApplication(page, origin + "/party");
    await page.getByText("You're with Harbour watch").first().waitFor();
    await reloadApplication(page, origin + "/market");
    await page.getByText("Saltmarsh Chandlery").first().waitFor();
    assert.equal(await page.getByText("Ironhold Armoury").count(), 0, "group A doesn't see Ironhold's shops");
    await seatAs(page, null);
    t = await book(page);
    assert.equal(t.purses.find((p) => p.id === "tamsin").coins.gp * 100 + t.purses.find((p) => p.id === "tamsin").coins.sp * 10 + t.purses.find((p) => p.id === "tamsin").coins.cp + t.purses.find((p) => p.id === "tamsin").coins.ep * 50 + t.purses.find((p) => p.id === "tamsin").coins.pp * 1000, 1794 - 1500);

    // 4. The DM moves the riders back and merges: the party is whole again.
    await reloadApplication(page, origin + "/party?section=characters");
    const card = page.getByRole("article", { name: "Ironhold riders, group B" });
    await card.getByRole("button", { name: "Move…" }).click();
    await card.getByRole("combobox", { name: /Move Ironhold riders to/ }).selectOption("harbour");
    await card.getByRole("button", { name: "Move group here" }).click();
    await card.getByText("Saltmarsh · Harbour ward").first().waitFor();
    await page.getByRole("button", { name: "Merge…" }).click();
    const merge = page.getByRole("dialog");
    await merge.getByText("The party is whole again").waitFor();
    await noOverflow(page, `merge ${width}`);
    await page.screenshot({ path: `${out}/merge-${width}.png`, fullPage: true });
    await merge.getByRole("button", { name: "Merge · regroup the party" }).click();
    await merge.waitFor({ state: "detached" });
    await page.locator("#party-groups").waitFor({ state: "detached" });
    t = await book(page);
    assert.equal(t.journal.world.groups[0].status, "merged");
    assert.equal(t.journal.world.mainGroup, undefined);
    assert.equal(t.journal.world.characterPositions.some((s) => s.groupId), false);
    assert.ok(t.journal.events.some((e) => /regrouped at Harbour ward/.test(e.summary)));
    await page.screenshot({ path: `${out}/merged-${width}.png`, fullPage: true });
    assert.deepEqual(errors, [], `page errors at ${width}`);
    await context.close();
  }
  console.log("Party split audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
