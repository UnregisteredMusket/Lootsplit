// Run only against a disposable local server. These are real UI captures using synthetic data.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { blankSheet } from "../src/lib/characters/model.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw Error("Disposable local server required.");
const output = process.env.PRODUCT_SCREENSHOTS || "test-results/product";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await openApplication(page, origin + "/party");
  const sheets = ["Mira Ashfall", "Bram Stoneward", "Rowan Vale"].map((name, i) => ({ ...blankSheet(), name, classes: ["Ranger", "Fighter", "Wizard"][i], level: 5, maxHp: [38,49,27][i], hp: [31,42,23][i], ac: [15,18,12][i] }));
  await page.evaluate(async (sheets) => {
    const rows = JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]");
    const active = localStorage.getItem("quire.campaign.v1");
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open(rows.find((r) => r.id === active)?.db || "quire"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["purses", "holdings", "ledger"], "readwrite");
      for (const store of ["purses", "holdings", "ledger"]) tx.objectStore(store).clear();
      sheets.forEach((sheet, i) => tx.objectStore("purses").put({ id: `demo-${i}`, name: sheet.name, kind: "character", sheet, coins: { cp: 0, sp: 5, ep: 0, gp: 40 + i * 12, pp: 0 } }));
      tx.objectStore("purses").put({ id: "party", name: "The Wayfarers’ fund", kind: "party", coins: { cp: 0, sp: 0, ep: 0, gp: 245, pp: 0 } });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); db.close();
  }, sheets);
  await reloadApplication(page);
  await page.getByRole("heading", { name: "Party", exact: true }).waitFor();
  await page.getByText("Mira Ashfall", { exact: true }).first().waitFor();
  await page.screenshot({ path: `${output}/party.png` });
  await openApplication(page, origin + "/market");
  await page.getByRole("heading", { name: /Shops|Markets|Market/ }).first().waitFor();
  await page.screenshot({ path: `${output}/market.png` });
} finally { await browser.close(); }
