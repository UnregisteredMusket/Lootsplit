import { chromium } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const output = process.env.BACKUP_SCREENSHOTS || "test-results/backups";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8081";
try {
  await page.goto(origin + "/settings");
  await page.waitForTimeout(1800);
  const skip = page.getByRole("button", { name: "Not now", exact: true });
  if (await skip.isVisible()) await skip.click();
  await page.getByRole("button", { name: /^Password/ }).click();
  await page.getByLabel("Password", { exact: true }).fill("audit-password");
  await page.getByLabel("Confirm password", { exact: true }).fill("audit-password");
  await page.getByRole("button", { name: "Save password", exact: true }).click();
  await page.getByRole("switch", { name: "Protect saves", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Save name", exact: true })
    .fill("Encrypted audit backup");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Password", { exact: true }).fill("audit-password");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByText("Encrypted audit backup", { exact: false }).waitFor();
  await page.getByLabel("Current password", { exact: true }).fill("audit-password");
  await page.getByLabel("New password", { exact: true }).fill("changed-password");
  await page.getByLabel("Confirm new password", { exact: true }).fill("changed-password");
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await page
    .getByText("Password changed. Locked saves use the new one.", { exact: true })
    .waitFor();
  const savedBackup = page.locator("li").filter({ hasText: "Encrypted audit backup" });
  await savedBackup.getByRole("button", { name: "Export", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Password", { exact: true }).fill("changed-password");
  const got = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  const file = await got;
  const body = JSON.parse(await readFile(await file.path(), "utf8"));
  assert.equal(body.kind, "lootsplit-locked");
  assert.equal(body.iterations, 210000);
  assert.equal(body.purses, undefined);
  await savedBackup.getByRole("button", { name: "Load", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Load backup", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Password", { exact: true }).fill("changed-password");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByText("Copy restored on this device.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Download backup", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Password", { exact: true }).fill("changed-password");
  const directDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  const direct = JSON.parse(await readFile(await (await directDownload).path(), "utf8"));
  assert.equal(direct.kind, "lootsplit-locked");
  assert.equal(await page.getByText("Google Drive", { exact: true }).count(), 0);
  await page.screenshot({ path: output + "/device-backups.png" });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "create protected backup",
        "direct device download remains encrypted",
        "change password and re-encrypt stored backup",
        "export encrypted backup",
        "confirm and restore protected backup",
      ],
    }),
  );
} catch (e) {
  console.error((await page.locator("body").innerText()).slice(0, 5000));
  await page.screenshot({ path: output + "/failure.png" });
  throw e;
} finally {
  await browser.close();
}
