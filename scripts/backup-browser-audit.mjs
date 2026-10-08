import { openApplication, navigateApplication } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { expect } from "playwright/test";
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
  await page.context().route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === new URL(origin).origin ? route.continue() : route.abort();
  });
  await page.context().addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  await openApplication(page, origin + "/");
  // Keep a private reference and its full extracted text in this disposable DM copy.
  await page.evaluate(async () => {
    const db = await (await import("/src/lib/quire/db.ts")).quireDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["books", "articles"], "readwrite");
      tx.objectStore("books").put({
        id: "private-backup-reference",
        title: "Private audit reference",
        fileName: "private-reference.pdf",
        pageCount: 1,
        articleCount: 1,
        importedAt: 1,
      });
      tx.objectStore("articles").put({
        id: "private-backup-article",
        bookId: "private-backup-reference",
        title: "Private extracted reference",
        text: "Complete private extracted text remains on the DM device.",
        pageStart: 1,
        pageEnd: 1,
        favorite: true,
      });
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
  });
  await page.getByRole("button", { name: /^Activity & balances/ }).click();
  await page.getByRole("button", { name: /^Campaign tools/ }).click();
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download copy", exact: true }).click();
  const completeCopy = JSON.parse(await readFile(await (await exported).path(), "utf8"));
  const durableRows = () =>
    page.evaluate(async () => {
      const registry = JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]");
      const active = localStorage.getItem("quire.campaign.v1");
      const name = registry.find((row) => row.id === active)?.db || "quire";
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const stores = [
        "books",
        "articles",
        "purses",
        "holdings",
        "shops",
        "stock",
        "ledger",
        "catalog",
        "lexicon",
        "meta",
      ];
      const tx = db.transaction(stores);
      const result = await Promise.all(
        stores.map(
          (store) =>
            new Promise((resolve, reject) => {
              const r = tx.objectStore(store).getAll();
              r.onsuccess = () => resolve([store, r.result]);
              r.onerror = () => reject(r.error);
            }),
        ),
      );
      db.close();
      return Object.fromEntries(result);
    });
  const beforeInvalidRestore = await durableRows();
  const savedRows = () =>
    page.evaluate(async () => (await import("/src/lib/quire/saves.ts")).listSaves());
  for (const field of ["books", "catalog", "lexicon"]) {
    const malformed = { ...completeCopy, purses: [], [field]: [{}] };
    await page
      .getByText("Restore a copy", { exact: true })
      .locator("input")
      .setInputFiles({
        name: `malformed-${field}.json`,
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(malformed)),
      });
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Restore", exact: true })
      .click();
    await page
      .getByText(
        `The ${field} contain invalid or missing data. The current campaign was not changed.`,
        { exact: true },
      )
      .waitFor();
    assert.deepEqual(
      await durableRows(),
      beforeInvalidRestore,
      `Rejected ${field} restore changed native IndexedDB rows`,
    );
  }
  await navigateApplication(page, origin + "/settings");
  await page.waitForTimeout(1800);
  const skip = page.getByRole("button", { name: "Not now", exact: true });
  if (await skip.isVisible()) await skip.click();
  const backupFolder = page
    .locator(".loot-fold")
    .filter({ has: page.getByRole("button", { name: /^Device backups/ }) })
    .first();
  const beforePlainImport = await durableRows(),
    beforeImportSaves = await savedRows();
  await backupFolder
    .getByText("Import", { exact: true })
    .locator("input")
    .setInputFiles({
      name: "plain-reviewed-copy.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(completeCopy)),
    });
  let preview = page.getByRole("alertdialog", { name: "Import this backup?", exact: true });
  await expect(preview).toContainText("add a separate named backup");
  await expect(preview.getByText("Private PDFs", { exact: true }).locator("..")).toContainText("1");
  await expect(
    preview.getByText("Extracted articles", { exact: true }).locator(".."),
  ).toContainText("1");
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(await durableRows(), beforePlainImport);
  assert.deepEqual(
    await savedRows(),
    beforeImportSaves,
    "Cancelling an import must not store a backup",
  );
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
  const beforePreview = await durableRows(),
    beforePreviewSaves = await savedRows();
  await savedBackup.getByRole("button", { name: "Preview contents", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Password", { exact: true }).fill("changed-password");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  const contents = page.getByRole("dialog", { name: "Device backup contents", exact: true });
  await expect(contents).toContainText("encrypted source unlocked for this preview");
  await expect(contents.getByText("Private PDFs", { exact: true }).locator("..")).toContainText(
    "1",
  );
  await contents.getByRole("button", { name: "Close contents preview", exact: true }).click();
  assert.deepEqual(await durableRows(), beforePreview);
  assert.deepEqual(
    await savedRows(),
    beforePreviewSaves,
    "Contents inspection must not rewrite encrypted backups",
  );
  await savedBackup.getByRole("button", { name: "Load", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Password", { exact: true }).fill("changed-password");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  preview = page.getByRole("alertdialog", { name: "Replace the current campaign?", exact: true });
  await expect(preview).toContainText("replace the contents of the current device campaign");
  await expect(
    preview.getByText("Extracted articles", { exact: true }).locator(".."),
  ).toContainText("1");
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(
    await durableRows(),
    beforePreview,
    "Cancelling a validated load must preserve every private native store",
  );
  assert.deepEqual(await savedRows(), beforePreviewSaves);
  await savedBackup.getByRole("button", { name: "Load", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Password", { exact: true }).fill("changed-password");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Replace the current campaign?", exact: true })
    .getByRole("button", { name: "Load backup", exact: true })
    .click();
  await page.getByText("Copy restored on this device.", { exact: true }).waitFor();
  assert.deepEqual((await durableRows()).books, completeCopy.books);
  assert.deepEqual((await durableRows()).articles, completeCopy.articles);
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
    const registry = JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]"),
      active = localStorage.getItem("quire.campaign.v1");
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(registry.find((x) => x.id === active)?.db || "quire");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["meta", "ledger"], "readwrite"),
        store = tx.objectStore("meta"),
        get = store.get("journal");
      get.onsuccess = () => {
        const journal = get.result?.value || { sessions: [], requests: [], events: [] };
        const archivedLedger = [
          {
            id: "old-income",
            purseId: "former-character",
            shopId: null,
            at: 20,
            copper: 100,
            summary: "Archived income",
          },
          {
            id: "old-transfer",
            purseId: "former-character",
            shopId: null,
            at: 20,
            copper: 50,
            summary: "Transfer received",
            transactionType: "transfer",
          },
        ];
        const archived = {
          purses: [],
          holdings: [],
          shops: [],
          stock: [],
          ledger: archivedLedger,
          notes: [
            {
              id: "old-party-message",
              at: 20,
              from: "dm",
              to: "party",
              purseId: "",
              text: "The complete shared archive message. Final message marker.",
            },
            {
              id: "old-private-conversation",
              at: 20,
              from: "player",
              to: "player",
              purseId: "former-character",
              recipientId: "other-player",
              text: "Unrelated private player conversation must stay hidden.",
            },
          ],
          sheets: [],
          loans: [],
          listings: [],
          journal: {
            sessions: [],
            requests: [],
            events: [],
            entries: [
              {
                id: "archived-note",
                at: 20,
                authorId: "dm",
                purseId: "",
                visibility: "dm",
                title: "Original DM entry",
                text: "The archived DM entry remains readable.",
                reportIds: [],
              },
              {
                id: "other-private-note",
                at: 20,
                authorId: "other-player",
                purseId: "former-character",
                visibility: "player",
                title: "Unrelated private entry",
                text: "Private player entry must stay hidden.",
                reportIds: [],
              },
            ],
          },
        };
        journal.reports = [
          ...(journal.reports || []),
          {
            id: "damaged-old",
            name: "Unreadable older session",
            at: 1,
            snapshot: "stored private corrupted bytes",
          },
          {
            id: "readable-old",
            name: "Readable older session",
            at: 2,
            snapshot: JSON.stringify(archived),
          },
        ];
        journal.sessions = [
          ...(journal.sessions || []),
          { id: "damaged-old", name: "Unreadable older session", startedAt: 10, endedAt: 30 },
          { id: "readable-old", name: "Readable older session", startedAt: 10, endedAt: 30 },
        ];
        journal.entries = [
          ...(journal.entries || []),
          {
            id: "linked-archive",
            at: 40,
            authorId: "dm",
            purseId: "",
            visibility: "dm",
            title: "Linked archive chapter",
            text: "The attachment opens the original authorized record.",
            reportIds: ["readable-old"],
          },
        ];
        tx.objectStore("ledger").put({
          id: "unrelated-live-income",
          purseId: "former-character",
          shopId: null,
          at: 20,
          copper: 999999,
          summary: "Unrelated current ledger",
        });
        store.put({ id: "journal", value: journal });
      };
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await openApplication(page, origin + "/features/reports");
  const damagedSummary = page
    .locator(".journal-entry")
    .filter({ has: page.getByRole("heading", { name: "Unreadable older session", exact: true }) });
  await expect(damagedSummary).toContainText("Totals are unavailable");
  await expect(damagedSummary).not.toContainText("Received");
  const validSummary = page
    .locator(".journal-entry")
    .filter({ has: page.getByRole("heading", { name: "Readable older session", exact: true }) });
  await expect(validSummary).toContainText("Received 1 gp · Spent 0 cp · Net 1 gp, 5 sp");
  await expect(validSummary).not.toContainText("9,999");
  await page.getByLabel("Search campaign report sessions", { exact: true }).fill("Unreadable");
  await expect(validSummary).toHaveCount(0);
  await page.getByLabel("Search campaign report sessions", { exact: true }).clear();
  await page.getByRole("button", { name: /^Archived session reports/ }).click();
  const archivedReports = page
    .locator(".loot-fold")
    .filter({ has: page.getByRole("button", { name: /^Archived session reports/ }) })
    .first();
  const damaged = archivedReports
    .locator(".journal-entry")
    .filter({ has: page.getByText("Unreadable older session", { exact: true }) });
  await damaged.getByRole("alert").filter({ hasText: "cannot be read" }).waitFor();
  assert.equal(
    await damaged
      .getByRole("button", { name: "Download session report", exact: true })
      .isDisabled(),
    true,
  );
  await damaged.getByRole("button", { name: "Read session report", exact: true }).click();
  let reader = page.getByRole("dialog");
  await expect(reader).toContainText("Totals are unavailable");
  await expect(
    reader.getByRole("button", { name: "Download session report", exact: true }),
  ).toBeDisabled();
  await reader.getByRole("button", { name: "Return to previous view", exact: true }).click();
  const readable = archivedReports
    .locator(".journal-entry")
    .filter({ has: page.getByText("Readable older session", { exact: true }) });
  await readable.getByRole("button", { name: "Read session report", exact: true }).click();
  reader = page.getByRole("dialog");
  await expect(reader).toContainText("Financial activity · 2 records");
  await expect(reader).toContainText("Final message marker.");
  await expect(reader).not.toContainText("Unrelated private player conversation");
  await reader.getByText("Journal entries · 1", { exact: true }).click();
  await expect(reader).toContainText("The archived DM entry remains readable.");
  await expect(reader).not.toContainText("Private player entry must stay hidden.");
  await reader.getByRole("button", { name: "Return to previous view", exact: true }).click();
  await expect(archivedReports).toBeVisible();
  const [readableDownload] = await Promise.all([
    page.waitForEvent("download"),
    readable.getByRole("button", { name: "Download session report", exact: true }).click(),
  ]);
  const readableBody = JSON.parse(await readFile(await readableDownload.path(), "utf8"));
  assert.deepEqual(readableBody.purses, []);
  assert.equal(readableBody.ledger.length, 2);
  assert.equal(readableBody.notes.length, 1);
  assert.equal(readableBody.journal.entries.length, 1);
  await page.getByLabel("Report availability", { exact: true }).selectOption("readable");
  await expect(damaged).toHaveCount(0);
  await expect(readable).toBeVisible();
  await page.getByLabel("Report availability", { exact: true }).selectOption("recovery");
  await expect(readable).toHaveCount(0);
  await expect(damaged).toBeVisible();
  await page.getByLabel("Report availability", { exact: true }).selectOption("all");
  // "Readable" is also a substring of "Unreadable"; use the distinct title here.
  await page
    .getByLabel("Search archived session reports", { exact: true })
    .fill("Unreadable older");
  await expect(readable).toHaveCount(0);
  await expect(damaged).toBeVisible();
  await page.getByLabel("Search archived session reports", { exact: true }).clear();
  await expect(readable).toBeVisible();
  await expect(damaged).toBeVisible();
  const storedJournal = (await durableRows()).meta.find((row) => row.id === "journal").value;
  assert.equal(
    storedJournal.reports.find((row) => row.id === "damaged-old").snapshot,
    "stored private corrupted bytes",
  );
  await page.screenshot({ path: output + "/unreadable-record.png" });
  await navigateApplication(page, origin + "/features/journal");
  await page.getByLabel("Search journal entries", { exact: true }).fill("Linked archive");
  await page
    .getByRole("button", { name: "Read attached report · Readable older session", exact: true })
    .click();
  reader = page.getByRole("dialog");
  await expect(reader).toContainText("Final message marker.");
  await expect(reader).not.toContainText("Unrelated private player conversation");
  await reader.getByRole("button", { name: "Return to previous view", exact: true }).click();
  await expect(page.locator(".journal-reading")).toContainText("Linked archive chapter");
  await expect(page.getByLabel("Search journal entries", { exact: true })).toHaveValue(
    "Linked archive",
  );
  await page.screenshot({ path: output + "/attached-record-reader.png" });
  await openApplication(page, origin + "/?view=overview");
  const sessions = page.locator("#sessions");
  await sessions.locator(":scope > div > button").first().click();
  await sessions.getByLabel("Session name", { exact: true }).fill("Preserved next session");
  await page.evaluate(() => {
    window.sessionDraftDocument = "same-document";
  });
  const leaveWarning = page.waitForEvent("dialog");
  const attemptedLeave = page
    .locator('nav[aria-label="Sections"]:visible')
    .getByRole("link", { name: "Party", exact: true })
    .click();
  const warning = await leaveWarning;
  assert.match(warning.message(), /Discard unsaved session name/);
  await warning.dismiss();
  await attemptedLeave;
  await expect(sessions.getByLabel("Session name", { exact: true })).toHaveValue(
    "Preserved next session",
  );
  assert.equal(
    await page.evaluate(
      () => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ),
    true,
  );
  await sessions.getByRole("button", { name: "Start session", exact: true }).click();
  const downtime = page.getByRole("dialog", {
    name: "Set downtime before this session",
    exact: true,
  });
  await downtime.getByLabel("Downtime days", { exact: true }).fill("3");
  await downtime
    .getByRole("button", { name: "Preview downtime calculations", exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === "/features/downtime");
  assert.equal(await page.evaluate(() => window.sessionDraftDocument), "same-document");
  assert.equal(await page.locator(".loot-opening").count(), 0);
  await sessions.locator(":scope > div > button").first().click();
  await expect(sessions.getByLabel("Session name", { exact: true })).toHaveValue(
    "Preserved next session",
  );
  await sessions.getByRole("checkbox", { name: /I approve the downtime plan/ }).check();
  await sessions
    .getByRole("button", { name: "Approve downtime & start session", exact: true })
    .click();
  await expect(sessions.getByLabel("Session name", { exact: true })).toHaveValue("");
  assert.equal(
    (await durableRows()).meta
      .find((row) => row.id === "journal")
      .value.sessions.some((row) => row.name === "Preserved next session" && !row.endedAt),
    true,
  );
  assert.equal(
    (await durableRows()).meta
      .find((row) => row.id === "journal")
      .value.reports.find((row) => row.id === "damaged-old").snapshot,
    "stored private corrupted bytes",
  );
  await page.screenshot({ path: output + "/session-name-handoff.png" });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "malformed restore leaves every native IndexedDB store unchanged",
        "damaged archive summaries are unavailable and cannot borrow live ledger totals",
        "valid neighboring archived summaries retain original transfer accounting",
        "full archive reader and download enforce current campaign message/journal privacy",
        "journal attachment opens full authorized archive and Return preserves its selection/search",
        "archive/session filters do not erase original saved report bytes",
        "session name survives cancelled navigation and explicit downtime handoff in this document",
        "create protected backup",
        "plain import and unlocked encrypted load previews show contents and destination before commit",
        "cancel and read-only contents preview preserve all native data and exact encrypted saved files",
        "private PDF references and full extracted articles survive validated encrypted load",
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
