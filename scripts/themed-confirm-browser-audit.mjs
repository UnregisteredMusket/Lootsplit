// Themed confirmations and prompts (design audit D7) in a disposable device campaign: a danger
// confirmation at a real call site (Remove location: Escape/Cancel keeps it, the red action
// removes it, focus returns to the trigger), a discard question stacked over an open dialog
// (Restock: "Keep editing" keeps the amount and the dialog, "Discard changes" closes it), a
// type-to-confirm prompt (validation, Enter, Escape) and the Campaigns panel Danger zone.
// No native browser dialog may appear. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { chooseOption } from "./search-select-browser.mjs";
import { themedDialog } from "./themed-dialogs.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = `${process.env.AUDIT_RESULTS_DIR || "test-results"}/themed-confirm`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const noOverflow = async (page, label) =>
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
    `${label}: the page scrolls sideways`,
  );
/** The open dialog is the topmost element at its centre (stacked above any other dialog). */
const onTop = (dialog) =>
  dialog.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + 12));
  });

try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width < 400 ? 844 : 900 },
    });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const errors = [],
      native = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => {
      native.push(`${d.type()}: ${d.message()}`);
      void d.dismiss();
    });
    await openApplication(page, origin + "/market");
    // Disposable campaign: one shop with finite stock (for Restock).
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      await applyCloudTable({
        purses: [],
        holdings: [],
        shops: [
          {
            id: "audit-shop",
            name: "Audit Outfitters",
            keeper: "",
            place: "",
            notes: "",
            sellRate: 1,
            buyRate: 0.5,
            wealth: "modest",
            category: "general",
            priceScale: 1,
          },
        ],
        stock: [
          {
            id: "audit-rope",
            shopId: "audit-shop",
            name: "Rope",
            copper: 100,
            quantity: 3,
            notes: "",
            baseCopper: 100,
            rarity: "common",
          },
        ],
        ledger: [],
        listings: [],
        loans: [],
        sheets: [],
        notes: [],
        journal: readJournal({}),
      });
    });
    await reloadApplication(page, origin + "/market");

    // 1. Danger confirmation at a real call site: Remove location.
    const name = `Disposable Coast ${width}`;
    await page.getByRole("button", { name: /^Manage regions, cities, towns and areas/ }).click();
    await page.getByRole("button", { name: "Create location", exact: true }).click();
    const form = page.getByRole("form", { name: "Location configuration" });
    await form.getByLabel("Location name", { exact: true }).fill(name);
    await form.getByRole("button", { name: "Save location", exact: true }).click();
    await expect(form).toHaveCount(0);
    await chooseOption(page.getByLabel("Edit location", { exact: true }), {
      label: `${name} · region`,
    });
    const remove = form.getByRole("button", { name: "Remove location", exact: true });
    await remove.click();
    const confirm = page.getByRole("alertdialog", { name: `Remove ${name}?`, exact: true });
    await expect(confirm).toBeVisible();
    await expect(confirm).toHaveAttribute("data-tone", "danger");
    // The safe answer has focus; the destructive one is labelled with its action.
    await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await expect(confirm.getByRole("button", { name: "Remove location", exact: true })).toBeVisible();
    await noOverflow(page, `danger confirm ${width}`);
    await page.screenshot({ path: `${output}/danger-confirm-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect(remove).toBeFocused();
    await expect(form.getByLabel("Location name", { exact: true })).toHaveValue(name);
    await remove.click();
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expect(form).toBeVisible();
    await remove.click();
    await confirm.getByRole("button", { name: "Remove location", exact: true }).click();
    await expect(form).toHaveCount(0);
    const remaining = await page
      .getByLabel("Edit location", { exact: true })
      .evaluate((el) =>
        [...el.closest(".record-select").querySelector("select").options].map((o) => o.label),
      );
    assert.ok(!remaining.includes(`${name} · region`), "Confirming removes the location once");

    // 2. Discard question stacked over an open dialog (Restock).
    await page.getByRole("button", { name: "Restock", exact: true }).first().click();
    const restock = page.getByRole("dialog", { name: /^Restock / });
    const amount = restock.getByRole("spinbutton");
    await amount.fill("12");
    await restock.getByRole("button", { name: "Close", exact: true }).click();
    const discard = page.getByRole("alertdialog", {
      name: "Discard unsaved restock amount?",
      exact: true,
    });
    await expect(discard).toHaveAttribute("data-tone", "discard");
    await expect(discard.getByRole("button", { name: "Keep editing", exact: true })).toBeFocused();
    assert.ok(await onTop(discard), "The question sits above the Restock dialog");
    await page.screenshot({ path: `${output}/discard-over-dialog-${width}.png` });
    // Escape answers only the question; the Restock dialog and its amount stay.
    await page.keyboard.press("Escape");
    await expect(discard).toHaveCount(0);
    await expect(restock).toBeVisible();
    await expect(amount).toHaveValue("12");
    await restock.getByRole("button", { name: "Close", exact: true }).click();
    await discard.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(restock).toBeVisible();
    await restock.getByRole("button", { name: "Close", exact: true }).click();
    await discard.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(restock).toHaveCount(0);
    await expect(themedDialog(page)).toHaveCount(0);

    // 3. Type-to-confirm prompt (the account campaign delete uses the same dialog).
    const ask = () =>
      page.evaluate(() => {
        window.promptAnswer = "pending";
        void import("/src/lib/quire/confirm-store.ts").then(({ requestPrompt }) =>
          requestPrompt({
            title: "Delete shared campaign Audit Keep?",
            body: "A private cloud backup of its saved state will be kept.",
            label: "Type AUDIT1 to confirm",
            tone: "danger",
            confirmLabel: "Delete campaign",
            validate: (value) => (value === "AUDIT1" ? null : "Type AUDIT1 exactly to delete."),
          }).then((value) => (window.promptAnswer = value)),
        );
      });
    await ask();
    const prompt = page.getByRole("alertdialog", {
      name: "Delete shared campaign Audit Keep?",
      exact: true,
    });
    const field = prompt.getByLabel("Type AUDIT1 to confirm", { exact: true });
    await expect(field).toBeFocused();
    await field.fill("audit1");
    await prompt.getByRole("button", { name: "Delete campaign", exact: true }).click();
    await expect(prompt.getByRole("alert")).toHaveText("Type AUDIT1 exactly to delete.");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    assert.equal(await page.evaluate(() => window.promptAnswer), "pending");
    await page.screenshot({ path: `${output}/prompt-${width}.png` });
    await field.fill("AUDIT1");
    await field.press("Enter");
    await expect(prompt).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.promptAnswer), "AUDIT1");
    await ask();
    await expect(field).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(prompt).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.promptAnswer)).toBeNull();

    // 4. Campaigns panel: one heading; deleting sits in a Danger zone fold, still available.
    await page.locator(".campaign-switcher").click();
    const campaigns = page.getByRole("dialog", { name: "Campaigns", exact: true });
    await expect(campaigns.getByRole("heading", { name: "Campaigns", exact: true })).toHaveCount(1);
    await expect(
      campaigns.getByRole("button", { name: "Delete current campaign", exact: true }),
    ).toHaveCount(0);
    await campaigns.getByRole("button", { name: /^Danger zone/ }).click();
    await campaigns.getByRole("button", { name: "Delete current campaign", exact: true }).click();
    const deleting = page.getByRole("alertdialog", { name: /^Delete .* from this device\?$/ });
    await expect(deleting).toHaveAttribute("data-tone", "danger");
    await noOverflow(page, `campaign danger zone ${width}`);
    await page.screenshot({ path: `${output}/campaign-danger-zone-${width}.png` });
    await deleting.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(deleting).toHaveCount(0);
    await expect(campaigns).toBeVisible();

    assert.deepEqual(native, [], "No native browser dialog appears");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Themed confirm audit passed at 1280 and 390 px.");
} finally {
  await browser.close();
}
