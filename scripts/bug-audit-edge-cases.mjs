import { openApplication } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const origin = "http://127.0.0.1:8080",
  findings = [];
const output = process.env.BUG_AUDIT_SCREENSHOTS || "test-results/bug-audit";
await mkdir(output, { recursive: true });
async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const p = await ctx.newPage();
  p.setDefaultTimeout(15000);
  await visit(p, "/party");
  return p;
}
async function visit(p, path) {
  await openApplication(p, origin + path);
  await p.locator(".role-chip:enabled").waitFor();
  await p.locator(".quire-dawn").waitFor({ state: "hidden" });
}
async function record(name, result) {
  findings.push({ name, ...result });
  console.log(JSON.stringify({ name, ...result }));
}
try {
  const p = await fresh();
  const legacy = await p.evaluate(async () => {
    const e = await import("/src/lib/quire/economy.ts"),
      c = await import("/src/lib/quire/cloud.ts"),
      s = await import("/src/lib/quire/sheet.ts");
    const draft = s.sheetFromFields({
      CharacterName: "Legacy veteran",
      ClassLevel: "Fighter 9",
      STR: "18",
      DEX: "16",
      AC: "17",
      HPCurrent: "35",
      ProficiencyBonus: "4",
      Athletics: "8",
      Initiative: "5",
    });
    if (!draft) throw Error("Fixture parser rejected legacy sheet");
    Object.assign(draft, {
      classLevel: "Fighter 9",
      proficiency: "4",
      initiative: "5",
      hitPoints: "35",
      skills: [{ name: "Athletics", bonus: "8" }],
    });
    const purse = { ...e.blankPurse("character"), id: "legacy-veteran", name: "Legacy veteran" };
    delete purse.sheet;
    await e.applyCloudTable({
      ...c.emptyCloudTable(),
      purses: [purse],
      sheets: [{ ...draft, purseId: purse.id, importedAt: 1 }],
    });
    return draft;
  });
  await visit(p, "/characters?id=party%3Alegacy-veteran");
  await p.getByRole("heading", { name: "Legacy veteran", exact: true }).waitFor();
  const r = await p.evaluate(async () => {
    const req = (await import("/src/lib/characters/campaign-client.ts")).characterRequest;
    const d = await req("sheets/detail", { id: "party:legacy-veteran" });
    const roll = await req("sheets/roll", {
      id: "party:legacy-veteran",
      revision: d.revision,
      requestKey: crypto.randomUUID(),
      kind: "ability",
      key: "str",
    });
    return {
      displayedStrength: d.body.scores.str,
      displayedLevel: d.body.level,
      displayedClasses: d.body.classes,
      displayedProficiency: d.body.proficiency,
      displayedAthletics: d.body.skills.Athletics,
      displayedInitiative: d.body.initiative,
      actualRoll: roll.formula,
      actualSkillRoll: (
        await req("sheets/roll", {
          id: "party:legacy-veteran",
          revision: d.revision,
          requestKey: crypto.randomUUID(),
          kind: "skill",
          key: "Athletics",
        })
      ).formula,
      actualInitiativeRoll: (
        await req("sheets/roll", {
          id: "party:legacy-veteran",
          revision: d.revision,
          requestKey: crypto.randomUUID(),
          kind: "initiative",
        })
      ).formula,
    };
  });
  await record("Legacy sheet projection and dice", {
    failed:
      r.actualRoll !== "1d20+4" ||
      r.actualSkillRoll !== "1d20+8" ||
      r.actualInitiativeRoll !== "1d20+5" ||
      r.displayedLevel !== 9 ||
      r.displayedProficiency !== 4 ||
      r.displayedInitiative !== 2 ||
      4 + r.displayedAthletics.rank * r.displayedProficiency + r.displayedAthletics.extra !== 8,
    input: {
      strength: legacy.abilities.str.score,
      classLevel: legacy.classLevel,
      proficiency: legacy.proficiency,
      athletics: legacy.skills,
      initiative: legacy.initiative,
    },
    actual: r,
  });
  await p.getByRole("button", { name: "Play sheet", exact: true }).click();
  await p.getByRole("tab", { name: "Skills", exact: true }).click();
  await p.screenshot({ path: output + "/legacy-sheet.png", fullPage: true });
  await p.context().close();
  const q = await fresh();
  await q.evaluate(async () => {
    const e = await import("/src/lib/quire/economy.ts"),
      c = await import("/src/lib/quire/campaigns.ts"),
      m = await import("/src/lib/characters/model.mjs");
    const first = c.getCampaigns().activeId;
    await e.createCampaignCharacter({ ...m.blankSheet(), name: "First campaign hero" });
    c.createCampaign("Second audit campaign");
    await e.ensureEconomy();
    const second = c.getCampaigns().activeId;
    const hero = await e.createCampaignCharacter({
      ...m.blankSheet(),
      name: "Second campaign hero",
    });
    c.switchCampaign(first);
    return { first, second, hero };
  });
  await visit(q, "/characters");
  await q.locator(".character-savebar").waitFor();
  const before = (await q.locator(".character-editor").count())
    ? await q.locator(".character-editor").innerText()
    : await q.locator("main").innerText();
  await q.locator(".campaign-switcher").click();
  const campaignRow = q
    .getByRole("dialog")
    .locator("li")
    .filter({ hasText: "Second audit campaign" });
  await campaignRow.getByRole("button", { name: "Open", exact: true }).click();
  await q.keyboard.press("Escape");
  await q.waitForTimeout(1800);
  await record("Guest campaign switch while viewing character", {
    failed: !(await q
      .getByRole("heading", { name: "Second campaign hero", exact: true })
      .isVisible()),
    before: before.slice(0, 500),
    after: (await q.locator("main").innerText()).slice(0, 1500),
    active: await q.evaluate(() => localStorage.getItem("quire.campaign.v1")),
  });
  await q.screenshot({ path: output + "/campaign-switch.png", fullPage: true });
  await q.context().close();
} finally {
  await writeFile("test-results/edge-case-results.json", JSON.stringify(findings, null, 2));
  await browser.close();
  process.exitCode = findings.some((r) => r.failed) ? 1 : 0;
}
