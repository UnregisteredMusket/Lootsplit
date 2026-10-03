import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const origin = "http://127.0.0.1:8080";
const output = process.env.BUG_AUDIT_SCREENSHOTS || "test-results/bug-audit";
await mkdir(output, { recursive: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
const p = await context.newPage();
p.setDefaultTimeout(15000);
const results = [];
async function visit(path) {
  await p.goto(origin + path);
  await p.locator(".role-chip:enabled").waitFor();
  await p.locator(".quire-dawn").waitFor({ state: "hidden" });
}
try {
  await visit("/party");
  const id = await p.evaluate(async () => {
    const e = await import("/src/lib/quire/economy.ts"),
      s = await import("/src/lib/quire/sheet.ts"),
      m = await import("/src/lib/characters/model.mjs");
    const body = {
      ...m.blankSheet(),
      name: "Existing advanced hero",
      level: 9,
      proficiency: 4,
      tempHp: 7,
      inspiration: true,
      conditions: "Blessed",
      initiative: 2,
      notes: "KEEP THESE CUSTOM NOTES",
      skills: { ...m.blankSheet().skills, Athletics: { rank: 1, extra: 1 } },
    };
    const id = await e.createCampaignCharacter(body);
    const legacy = {
      ...s.sheetFromFields({
        CharacterName: body.name,
        ClassLevel: "Fighter 9",
        STR: "10",
        HPCurrent: "10",
      }),
      purseId: id,
      importedAt: 1,
    };
    // Simulate a character retaining its pre-upgrade imported sheet alongside new play fields.
    await s.saveSheet(legacy);
    return id;
  });
  await visit("/party");
  await p.getByRole("tab", { name: "Funds & inventory", exact: true }).click();
  await p.locator(`#purse-${id} > summary`).click();
  const scope = p.locator(`#purse-${id}`);
  await scope.getByLabel("Race", { exact: true }).fill("Human");
  await scope.getByLabel("Race", { exact: true }).press("Tab");
  await p.waitForTimeout(700);
  const r = await p.evaluate(async (id) => {
    const e = await import("/src/lib/quire/economy.ts");
    const p = (await e.economySnapshot()).purses.find((p) => p.id === id);
    return {
      level: p.sheet.level,
      proficiency: p.sheet.proficiency,
      tempHp: p.sheet.tempHp,
      inspiration: p.sheet.inspiration,
      conditions: p.sheet.conditions,
      initiative: p.sheet.initiative,
      notes: p.sheet.notes,
      athletics: p.sheet.skills.Athletics,
      species: p.sheet.species,
    };
  }, id);
  results.push({
    name: "Legacy blank field edit preserves advanced data",
    failed:
      r.level !== 9 ||
      r.proficiency !== 4 ||
      r.tempHp !== 7 ||
      !r.inspiration ||
      r.conditions !== "Blessed" ||
      r.notes !== "KEEP THESE CUSTOM NOTES",
    actual: r,
  });
  console.log(JSON.stringify(results.at(-1)));
  await p.screenshot({ path: output + "/legacy-edit.png", fullPage: true });
  // Existing inventory accepts long descriptive item names; the full character form must still save HP.
  await p.evaluate(async (id) => {
    const e = await import("/src/lib/quire/economy.ts");
    await e.saveHolding({
      id: "long-name-item",
      purseId: id,
      name: "An ornate ceremonial sword with a silver pommel, gilded crossguard, and an inscription commemorating the victory at the Battle of the Northern Gate",
      kind: "item",
      quantity: 1,
      unitCopper: 100,
      notes: "",
    });
  }, id);
  await visit("/characters?id=" + encodeURIComponent("party:" + id));
  await p.getByRole("heading", { name: "Existing advanced hero", exact: true }).waitFor();
  await p.getByRole("button", { name: "Edit sheet", exact: true }).click();
  await p.getByLabel("Current HP", { exact: true }).fill("4");
  await p.getByRole("button", { name: "Save character", exact: true }).click();
  await p.waitForTimeout(700);
  results.push({
    name: "HP save with existing long inventory name",
    failed: (await p.getByRole("alert").count()) > 0,
    alerts: await p.getByRole("alert").allTextContents(),
    savedHp: await p.evaluate(
      async (id) =>
        (await (await import("/src/lib/quire/economy.ts")).economySnapshot()).purses.find(
          (p) => p.id === id,
        ).sheet.hp,
      id,
    ),
  });
  console.log(JSON.stringify(results.at(-1)));
} finally {
  await writeFile("test-results/data-integrity-results.json", JSON.stringify(results, null, 2));
  await browser.close();
  process.exitCode = results.some((r) => r.failed) ? 1 : 0;
}
