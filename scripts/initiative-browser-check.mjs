import { expect } from "playwright/test";

export async function expectInitiativeOrder(page, names) {
  await expect(page.locator(".combat-identity strong")).toHaveText(names);
}

// Shared by the existing device and account encounter audits; all actions use the UI.
export async function checkManualInitiative(page, firstName, output) {
  const names = [firstName, "Initiative scout", "Initiative guard", "Unrolled ally"];
  for (const name of names.slice(1)) {
    await page.getByRole("button", { name: "Add combatant", exact: true }).click();
    await page
      .locator(".encounter-combatant")
      .last()
      .getByLabel("Name", { exact: true })
      .fill(name);
  }
  const row = (name) =>
    page.locator(".encounter-combatant").filter({
      has: page.locator(".combat-identity strong").filter({ hasText: new RegExp(`^${name}$`) }),
    });
  const score = (name) => row(name).getByLabel("Initiative", { exact: true });
  await score(firstName).fill("");
  await score(firstName).focus();
  for (const digit of ["1", "0"]) {
    await score(firstName).press(digit);
    await expect(score(firstName)).toBeFocused();
    await expectInitiativeOrder(page, names);
  }
  await expect(score(firstName)).toHaveValue("10");
  await page.screenshot({ path: `${output}/initiative-desktop.png`, fullPage: true });
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await score(names[1]).fill("18");
  await score(names[2]).fill("18");
  await expect(score(names[2])).toBeFocused();
  await expectInitiativeOrder(page, names);
  // A keyboard activation is an explicit sort, just like a pointer/touch click.
  const sort = page.getByRole("button", { name: "Sort initiative", exact: true });
  await sort.focus();
  await sort.press("Enter");
  const sorted = [names[1], names[2], firstName, names[3]];
  await expectInitiativeOrder(page, sorted);
  await row(firstName).getByRole("button", { name: "Set active", exact: true }).click();
  await sort.click();
  await expect(row(firstName)).toHaveClass(/is-active/);
  await expect(page.getByLabel("Round", { exact: true })).toHaveValue("1");
  await score(firstName).fill("25");
  await expect(score(firstName)).toBeFocused();
  await expectInitiativeOrder(page, sorted);
  await score(firstName).fill("");
  await expectInitiativeOrder(page, sorted);
  await score(firstName).fill("25");
  await page.getByRole("button", { name: "Next turn", exact: true }).click();
  await expect(row(names[3])).toHaveClass(/is-active/);
  await page.getByRole("button", { name: "Next turn", exact: true }).click();
  await expect(row(names[1])).toHaveClass(/is-active/);
  await expect(page.getByLabel("Round", { exact: true })).toHaveValue("2");
  await expectInitiativeOrder(page, sorted);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: `${output}/initiative-mobile.png`, fullPage: true });
  await page.setViewportSize(viewport);
  return sorted;
}
