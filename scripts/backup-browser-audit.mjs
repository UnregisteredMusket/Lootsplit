import { openApplication, navigateApplication } from "./title-screen-navigation.mjs";
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
  if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
    throw Error("Destructive backup fixtures require a disposable local server.");
  await page.context().route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === new URL(origin).origin ? route.continue() : route.abort();
  });
  await page.context().addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  await openApplication(page, origin + "/");
  await page.getByRole("button", { name: /^Activity & balances/ }).click();
  await page.getByRole("button", { name: /^Campaign tools/ }).click();
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download copy", exact: true }).click();
  const completeCopy = JSON.parse(await readFile(await (await exported).path(), "utf8"));
  const durableRows = () => page.evaluate(async () => {
    const registry = JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]");
    const active = localStorage.getItem("quire.campaign.v1");
    const name = registry.find(row => row.id === active)?.db || "quire";
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const stores = ["books", "articles", "purses", "holdings", "shops", "stock", "ledger", "catalog", "lexicon", "meta"];
    const tx = db.transaction(stores);
    const result = await Promise.all(stores.map(store => new Promise((resolve, reject) => {
      const r = tx.objectStore(store).getAll(); r.onsuccess = () => resolve([store, r.result]); r.onerror = () => reject(r.error);
    })));
    db.close(); return Object.fromEntries(result);
  });
  const beforeInvalidRestore = await durableRows();
  for (const field of ["books", "catalog", "lexicon"]) {
    const malformed = { ...completeCopy, purses: [], [field]: [{}] };
    await page.getByText("Restore a copy", { exact: true }).locator("input").setInputFiles({
      name: `malformed-${field}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(malformed)),
    });
    await page.getByRole("alertdialog").getByRole("button", { name: "Restore", exact: true }).click();
    await page.getByText(`The ${field} contain invalid or missing data. The current campaign was not changed.`, { exact: true }).waitFor();
    assert.deepEqual(await durableRows(), beforeInvalidRestore, `Rejected ${field} restore changed native IndexedDB rows`);
  }
  await navigateApplication(page, origin + "/settings");
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
  // Seed a pre-existing damaged archive directly in this disposable native database.
  // New imports still reject it; existing play and the other records must remain usable.
  await page.evaluate(async () => {
    const registry=JSON.parse(localStorage.getItem("quire.campaigns.v1")||"[]"), active=localStorage.getItem("quire.campaign.v1");
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(registry.find(x=>x.id===active)?.db||"quire");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise((resolve,reject)=>{
      const tx=db.transaction("meta","readwrite"),store=tx.objectStore("meta"),get=store.get("journal");
      get.onsuccess=()=>{const journal=get.result?.value||{sessions:[],requests:[],events:[]};
        journal.reports=[...(journal.reports||[]),
          {id:"damaged-old",name:"Unreadable older session",at:1,snapshot:"stored private corrupted bytes"},
          {id:"readable-old",name:"Readable older session",at:2,snapshot:JSON.stringify({purses:[],holdings:[],shops:[],stock:[],ledger:[],notes:[],sheets:[],loans:[],listings:[]})}];
        store.put({id:"journal",value:journal});};
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
    });db.close();
  });
  await openApplication(page, origin + "/features/reports");
  await page.getByRole("button", {name:/^Archived session reports/}).click();
  const damaged=page.locator(".journal-entry").filter({has:page.getByText("Unreadable older session",{exact:true})});
  await damaged.getByRole("alert").filter({hasText:"cannot be read"}).waitFor();
  assert.equal(await damaged.getByRole("button",{name:"Download session report",exact:true}).isDisabled(),true);
  const readable=page.locator(".journal-entry").filter({has:page.getByText("Readable older session",{exact:true})});
  const [readableDownload]=await Promise.all([
    page.waitForEvent("download"),
    readable.getByRole("button",{name:"Download session report",exact:true}).click(),
  ]);
  assert.deepEqual(JSON.parse(await readFile(await readableDownload.path(),"utf8")).purses,[]);
  const storedJournal=(await durableRows()).meta.find(row=>row.id==="journal").value;
  assert.equal(storedJournal.reports.find(row=>row.id==="damaged-old").snapshot,"stored private corrupted bytes");
  await page.screenshot({path:output+"/unreadable-record.png"});
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "malformed restore leaves every native IndexedDB store unchanged",
        "older unreadable archive is diagnosed while a valid report still downloads",
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
