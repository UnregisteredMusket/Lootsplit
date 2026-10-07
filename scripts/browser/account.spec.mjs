import assert from "node:assert/strict";
import {
  test,
  expect,
  visit as visitPage,
  credentials,
  signedInDevices,
  accountPost,
  createAndSaveRoom,
  endSession,
} from "./account-fixtures.mjs";
import {
  continueIntoApp,
  prepareDmFixture,
} from "../title-screen-navigation.mjs";

test("layout", async ({ devices, baseURL: origin }, testInfo) => {
  const { page } = devices;
  const visit = (p, path) => visitPage(p, origin, path);
  await visit(page, "/welcome");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      "/welcome",
      "/downloads",
      "/help",
      "/updates",
      "/account",
    ]) {
      await visit(page, path);
      assert.ok((await page.locator("body").innerText()).length > 200);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `Overflow ${path} ${width}`,
      );
      await page.screenshot({
        path: testInfo.outputPath(`website-${path.slice(1)}-${width}.png`),
        fullPage: true,
      });
    }
  }
  // Exercise client-side route transitions as well as direct navigation. Providers
  // must stay mounted while the router renders the previous page during a lazy load.
  await page
    .getByRole("link", { name: "Downloads", exact: true })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "One party. Your platform.", exact: true })
    .waitFor();
  await page
    .getByRole("link", { name: "My account", exact: true })
    .first()
    .click();
  await continueIntoApp(page);
  await page
    .getByRole("heading", { name: "Good to see you again", exact: true })
    .waitFor();
});

test("library", async ({ devices, baseURL: origin }, testInfo) => {
  const { page } = devices;
  const visit = (p, path) => visitPage(p, origin, path);
  await page.setViewportSize({ width: 390, height: 900 });
  await visit(page, "/account");
  console.log("Account audit: sign up");
  const email = credentials().email,
    password = "browser testing password 2026";
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Display name").fill("Test adventurer");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .last()
    .click();
  await page
    .getByRole("heading", { name: "Test adventurer’s library" })
    .waitFor();
  await page
    .getByRole("heading", { name: "Keep this recovery key somewhere safe" })
    .waitFor();
  const key = await page.locator(".portal-key code").innerText();
  assert.equal(key.length, 64);
  await page.getByRole("button", { name: "I have saved it" }).click();
  await prepareDmFixture(page, origin);
  await visit(page, "/account");
  console.log("Account audit: character and backup");
  await page
    .getByLabel("Character name", { exact: true })
    .fill("Browser test hero");
  await page.getByLabel("Notes", { exact: true }).fill("A reusable hero.");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page
    .getByRole("heading", { name: "Browser test hero", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Add to campaign", exact: true })
    .click();
  await page.getByRole("status").filter({ hasText: "was added" }).waitFor();
  await page
    .getByRole("button", { name: "Save current campaign", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore as new", exact: true })
    .waitFor();
  await page.screenshot({
    path: testInfo.outputPath("account-library-mobile.png"),
    fullPage: true,
  });
  // A second browser/device sees the same private library, with an independent local campaign.
  const { page: other } = await devices.newDevice();
  await visit(other, "/account");
  await other.getByLabel("Email", { exact: true }).fill(email);
  await other.getByLabel("Password", { exact: true }).fill(password);
  await other
    .getByRole("button", { name: "Sign in", exact: true })
    .last()
    .click();
  await other
    .getByRole("heading", { name: "Browser test hero", exact: true })
    .waitFor();
  await other
    .getByRole("button", { name: "Restore as new", exact: true })
    .waitFor();
  await other.screenshot({
    path: testInfo.outputPath("account-library-desktop.png"),
    fullPage: true,
  });
  await prepareDmFixture(other, origin);
  await visit(other, "/account");
  console.log("Account audit: restore into new campaign");
  other.on("dialog", (d) => d.accept());
  await other
    .getByRole("button", { name: "Restore as new", exact: true })
    .click();
  await other.waitForURL(
    (url) => url.origin === origin && url.pathname === "/",
  );
  await continueIntoApp(other);
  await other.getByText("Campaign control", { exact: true }).waitFor();
  assert.ok(
    await other.evaluate(
      () => JSON.parse(localStorage.getItem("quire.campaigns.v1")).length >= 2,
    ),
  );
  await visit(other, "/account");
  console.log("Account audit: shared membership resumes on another device");
  await visit(other, "/share");
  const skip = other.getByRole("button", { name: "Not now", exact: true });
  if (await skip.isVisible()) await skip.click();
  await other
    .getByRole("button", { name: "Start a room", exact: true })
    .click();
  await other.getByRole("button", { name: "Create room", exact: true }).click();
  await other
    .getByRole("button", { name: "Share join link", exact: true })
    .waitFor();
  await visit(other, "/account");
  await other
    .getByRole("button", { name: "Save current membership", exact: true })
    .click();
  await other.getByRole("button", { name: "Resume", exact: true }).waitFor();
  await visit(page, "/account");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.waitForURL((url) => url.origin === origin && url.pathname === "/");
  await continueIntoApp(page);
  await page.getByText("Campaign control", { exact: true }).waitFor();
  assert.ok(
    await page.evaluate(() =>
      localStorage.getItem("quire.campaign.v1").startsWith("account-"),
    ),
  );
  assert.ok(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("quire.campaigns.v1")).some(
        (c) => c.id === "main",
      ),
    ),
  );
});

test("dm-resume", async ({ devices, baseURL: origin }, testInfo) => {
  const { page } = devices;
  const visit = (p, path) => visitPage(p, origin, path);
  const { other } = await signedInDevices(devices, origin);
  const firstCode = (await createAndSaveRoom(other, origin))[0].code;
  await visit(page, "/account");
  // Simulate navigation/storage interruption during the first account campaign
  // hydration. Its durable revision must remain old so a reload repairs the copy.
  await page.addInitScript(() => {
    const clear = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.clear = function (...args) {
      const result = clear.apply(this, args);
      if (
        this.name === "purses" &&
        localStorage.getItem("quire.campaign.v1")?.startsWith("account-") &&
        !sessionStorage.getItem("audit-allow-hydration")
      ) {
        sessionStorage.setItem("audit-interrupted-hydration", "yes");
        queueMicrotask(() => this.transaction.abort());
      }
      return result;
    };
  });
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.waitForFunction(
    () => sessionStorage.getItem("audit-interrupted-hydration") === "yes",
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const id = localStorage.getItem("quire.campaign.v1");
        return JSON.parse(localStorage.getItem(`quire.cloud.v2.${id}`))
          .revision;
      }),
    )
    .toBe(0);
  await page.evaluate(() =>
    sessionStorage.setItem("audit-allow-hydration", "yes"),
  );
  await visit(page, "/share");
  await expect(
    page.getByRole("button", {
      name: "Dungeon master. Change role.",
      exact: true,
    }),
  ).toBeVisible();
  await endSession(page, origin);
  const saved = await createAndSaveRoom(page, origin);
  assert.equal(saved.length, 2);
  const secondCode = saved.find((m) => m.code !== firstCode).code;
  await endSession(page, origin);
  for (const [p, width] of [
    [page, 390],
    [other, 1360],
  ]) {
    await p.setViewportSize({ width, height: 900 });
    await visit(p, "/account");
    await p
      .getByRole("button", { name: "Reopen as DM", exact: true })
      .nth(1)
      .waitFor();
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await p.screenshot({
      path: testInfo.outputPath(`dm-resume-closed-${width}.png`),
      fullPage: true,
    });
  }
  async function resumeFromAccount(p, code, label) {
    await visit(p, "/account");
    const card = p.locator("article.portal-card").filter({ hasText: code });
    const acceptSeparate = (dialog) => dialog.accept();
    p.on("dialog", acceptSeparate);
    await card.getByRole("button", { name: label, exact: true }).click();
    await p.waitForURL((url) => url.origin === origin && url.pathname === "/");
    p.off("dialog", acceptSeparate);
    await p
      .getByRole("button", {
        name: "Dungeon master. Change role.",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await p.locator(".loot-opening").count(),
      0,
      "Account resume must not replay startup",
    );
    const active = await p.evaluate(() => {
      const id = localStorage.getItem("quire.campaign.v1");
      const session = JSON.parse(localStorage.getItem(`quire.cloud.v2.${id}`));
      return { code: session.code, role: session.role };
    });
    assert.deepEqual(active, { code, role: "dm" });
  }
  await resumeFromAccount(other, secondCode, "Reopen as DM");
  await resumeFromAccount(page, firstCode, "Reopen as DM");
  // Both saved campaigns also remain resumable after the first reopen, on either device.
  await resumeFromAccount(page, secondCode, "Resume");
  await resumeFromAccount(other, firstCode, "Resume");
});

test("resume-queue", async ({ devices, baseURL: origin }, testInfo) => {
  // This profile must exercise the real startup selector. The shared gameplay
  // navigation helper otherwise claims its local DM campaign automatically.
  devices.page.guestAccessAudit = true;
  const { other: device } = await signedInDevices(devices, origin);
  const visit = (p, path) => visitPage(p, origin, path);
  const firstCode = (await createAndSaveRoom(device, origin))[0].code;
  async function resumeSaved() {
    await visit(device, "/account");
    const card = device
      .locator("article.portal-card")
      .filter({ hasText: firstCode });
    await card.getByRole("button", { name: "Resume", exact: true }).click();
    await device.waitForURL(
      (url) => url.origin === origin && url.pathname === "/",
    );
    await device
      .getByRole("button", {
        name: "Dungeon master. Change role.",
        exact: true,
      })
      .waitFor();
    expect(await device.locator(".loot-opening").count()).toBe(0);
  }
  await resumeSaved();
  // A lost Live response must remain recoverable, then an acknowledged stale
  // queue must open from both account cards and the startup selector.
  await visit(device, "/account");
  const original = await device.evaluate(() => {
    const key = `quire.cloud.v2.${localStorage.getItem("quire.campaign.v1")}`;
    return { key, session: JSON.parse(localStorage.getItem(key)) };
  });
  const queued = {
    ...original.session,
    pending: [{ id: "audit-resume-noop", kind: "patch", changes: [] }],
    batchId: "audit-original-batch",
  };
  await device.evaluate(
    ({ key, queued }) => localStorage.setItem(key, JSON.stringify(queued)),
    { key: original.key, queued },
  );
  await resumeSaved();
  await visit(device, "/share");
  await device.getByRole("button", { name: /^Connection & recovery/ }).click();
  await expect(device.getByText(/1 unsynced Live change/)).toBeVisible();
  const download = device.waitForEvent("download");
  await device
    .getByRole("button", { name: "Export pending actions", exact: true })
    .click();
  const exported = JSON.parse(
    await (
      await import("node:fs/promises")
    ).readFile(await (await download).path(), "utf8"),
  );
  expect(exported.commands[0].id).toBe("audit-resume-noop");
  await device.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    device
      .getByRole("status")
      .filter({ hasText: "Connected · All changes saved" }),
  ).toBeVisible();

  for (const [entry, width] of [
    ["account", 1360],
    ["startup", 390],
  ]) {
    const target = entry === "startup" ? devices.page : device;
    await visit(target, "/account");
    await target.evaluate(
      ({ key, queued }) => {
        localStorage.setItem(key, JSON.stringify(queued));
        localStorage.setItem("quire.guide.offer.v3", "seen");
      },
      { key: original.key, queued },
    );
    await target.setViewportSize({ width, height: 900 });
    if (entry === "account") await resumeSaved();
    else {
      await visit(target, "/");
      await target
        .getByRole("heading", { name: "Choose your campaign" })
        .waitFor();
      await target
        .locator("section.ledger-card")
        .filter({ hasText: firstCode })
        .getByRole("button", { name: "Resume", exact: true })
        .click();
      await expect(
        target.getByText("Campaign control", { exact: true }),
      ).toBeVisible();
    }
    await expect
      .poll(() =>
        target.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)).pending.length,
          original.key,
        ),
      )
      .toBe(0);
    expect(await target.locator(".loot-opening").count()).toBe(0);
    await target.screenshot({
      path: testInfo.outputPath(`dm-stale-queue-${entry}-${width}.png`),
      fullPage: true,
    });
  }

  // Changed-seat work is exported separately; never submitted as the new seat.
  await visit(device, "/account");
  await device.evaluate(
    ({ key, queued }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          ...queued,
          seatId: "audit-old-seat",
          batchId: "audit-old-seat-batch",
          pending: [
            { id: "audit-old-seat-action", kind: "patch", changes: [] },
          ],
        }),
      );
    },
    { key: original.key, queued },
  );
  await visit(device, "/account");
  await resumeSaved();
  await visit(device, "/account");
  await expect(
    device.getByRole("heading", { name: "Device recovery copies" }),
  ).toBeVisible();
  const recoveryDownload = device.waitForEvent("download");
  await device
    .getByRole("button", { name: "Export device recovery copy" })
    .click();
  const recovery = JSON.parse(
    await (
      await import("node:fs/promises")
    ).readFile(await (await recoveryDownload).path(), "utf8"),
  );
  expect(recovery.seatId).toBe("audit-old-seat");
  expect(recovery.commands[0].id).toBe("audit-old-seat-action");
  expect(recovery.token).toBeUndefined();
});

test("recovery", async ({ devices, baseURL: origin }) => {
  const { context, page } = devices;
  const visit = (p, path) => visitPage(p, origin, path);
  const { email, other } = await signedInDevices(devices, origin);
  const { key } = await accountPost(context, origin, "recovery-key", {});
  assert.equal(key.length, 64);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("button", { name: "Forgot your password? Use a recovery key" })
    .click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Recovery key", { exact: true }).fill(key);
  await page
    .getByLabel("New password", { exact: true })
    .fill("new browser testing password 2026");
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Password changed" })
    .waitFor();
  await visit(other, "/account");
  await other
    .getByRole("button", { name: "Sign in", exact: true })
    .last()
    .waitFor();
});

test("portrait-resume", async ({ devices, baseURL: origin }) => {
  const desktop = devices.page;
  const { other: phone } = await signedInDevices(devices, origin);
  await phone.setViewportSize({ width: 390, height: 844 });
  await visitPage(phone, origin, "/party?section=funds");
  const card = phone.locator('details[id^="purse-"]').first();
  await card.locator(":scope > summary").click();
  const id = await card.getAttribute("id");
  const picture = await phone.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#d93025";
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = "#1a73e8";
    ctx.fillRect(0, 0, 16, 16);
    return c.toDataURL("image/png").split(",")[1];
  });
  await card.locator('.portrait-picker input[type="file"]').setInputFiles({
    name: "synthetic-portrait.png",
    mimeType: "image/png",
    buffer: Buffer.from(picture, "base64"),
  });
  await expect(
    phone.getByText("Portrait saved on this device", { exact: true }),
  ).toBeVisible();
  let portrait = await card.locator(".portrait-picker img").getAttribute("src");
  expect(portrait).toMatch(/^data:image/);
  const sheetPath = `/characters?id=${encodeURIComponent(`party:${id.slice(6)}`)}`;
  async function expectPartyPortrait(page, expected) {
    await visitPage(page, origin, "/party?section=characters");
    const profile = page.locator("article.party-profile").filter({
      has: page
        .getByRole("link", { name: "Open sheet", exact: true })
        .and(page.locator(`a[href="${sheetPath}"]`)),
    });
    const image = profile.locator("img");
    await expect(image).toHaveAttribute("src", expected);
    await expect
      .poll(() => image.evaluate((img) => img.naturalWidth))
      .toBeGreaterThan(0);
  }
  await expectPartyPortrait(phone, portrait);
  const [member] = await createAndSaveRoom(phone, origin);

  await visitPage(desktop, origin, "/account");
  await desktop.getByRole("button", { name: "Resume", exact: true }).click();
  await desktop.waitForURL((url) => url.pathname === "/");
  await continueIntoApp(desktop);
  await expectPartyPortrait(desktop, portrait);

  // The full character sheet has a separate upload/save path. Verify its saved
  // portrait in the actual Party cards on both devices and the server readout.
  await visitPage(phone, origin, sheetPath);
  await phone.getByRole("button", { name: "Edit sheet", exact: true }).click();
  await phone
    .getByRole("button", { name: "Character details", exact: true })
    .click();
  await phone.getByLabel("Character portrait", { exact: true }).setInputFiles({
    name: "synthetic-sheet-portrait.png",
    mimeType: "image/png",
    buffer: Buffer.from(picture, "base64"),
  });
  await phone
    .getByRole("button", { name: "Save character", exact: true })
    .click();
  await expect(
    phone.getByRole("button", { name: "Save character", exact: true }),
  ).toBeDisabled();
  portrait = `data:image/png;base64,${picture}`;
  await expectPartyPortrait(phone, portrait);
  const sheetSaved = await accountPost(
    desktop.context(),
    origin,
    "sheets/detail",
    {
      id: `campaign:${member.code}:${id.slice(6)}`,
    },
  );
  expect(sheetSaved.body.portrait).toBe(portrait);
  await expectPartyPortrait(desktop, portrait);
  await visitPage(desktop, origin, "/party?section=funds");
  const restored = desktop.locator(`#${id}`);
  await restored.locator(":scope > summary").click();
  await expect(restored.locator(".portrait-picker img")).toHaveAttribute(
    "src",
    portrait,
  );
  await expect
    .poll(() =>
      restored
        .locator(".portrait-picker img")
        .evaluate((img) => img.naturalWidth),
    )
    .toBeGreaterThan(0);

  // A phone can render its optimistic local portrait even when the upload fails.
  // Account linking must not promise another device can see those pending edits.
  await visitPage(phone, origin, "/party?section=funds");
  await phone.locator(`#${id} > summary`).click();
  const replacement = await phone.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#188038";
    ctx.fillRect(0, 0, 32, 32);
    return c.toDataURL("image/png").split(",")[1];
  });
  let blocked = 0;
  const rejectPortrait = async (route) => {
    if (route.request().postData()?.includes('"portrait"')) {
      blocked++;
      return route.abort("failed");
    }
    return route.continue();
  };
  await phone.route("**/_serverFn/**", rejectPortrait);
  await phone
    .locator(`#${id} .portrait-picker input[type=file]`)
    .setInputFiles({
      name: "replacement-portrait.png",
      mimeType: "image/png",
      buffer: Buffer.from(replacement, "base64"),
    });
  await expect.poll(() => blocked).toBeGreaterThan(0);
  await expect(phone.getByText("Portrait saved", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    phone.getByText(/Portrait kept on this device.*not synced/),
  ).toBeVisible();
  const pendingPortrait = await phone
    .locator(`#${id} .portrait-picker img`)
    .getAttribute("src");
  expect(pendingPortrait).not.toBe(portrait);
  await expect(restored.locator(".portrait-picker img")).toHaveAttribute(
    "src",
    portrait,
  );
  portrait = pendingPortrait;
  await visitPage(phone, origin, "/account");
  await phone
    .getByRole("button", { name: "Save current membership", exact: true })
    .click();
  await expect(
    phone.getByText(/Campaign changes have not synced/),
  ).toBeVisible();
  await expect(
    phone.getByRole("status").filter({ hasText: "This membership is saved" }),
  ).toHaveCount(0);
  await phone.unroute("**/_serverFn/**", rejectPortrait);
  await phone
    .getByRole("button", { name: "Save current membership", exact: true })
    .click();
  await expect(
    phone.getByRole("status").filter({ hasText: "This membership is saved" }),
  ).toBeVisible();

  await expect(restored.locator(".portrait-picker img")).toHaveAttribute(
    "src",
    portrait,
  );
  await endSession(desktop, origin);
  await visitPage(desktop, origin, "/account");
  await desktop
    .getByRole("button", { name: "Reopen as DM", exact: true })
    .click();
  await desktop.waitForURL((url) => url.pathname === "/");
  await continueIntoApp(desktop);
  await visitPage(desktop, origin, "/party?section=funds");
  await desktop.locator(`#${id} > summary`).click();
  await expect(desktop.locator(`#${id} .portrait-picker img`)).toHaveAttribute(
    "src",
    portrait,
  );
  expect(member.role).toBe("dm");

  // Saving account membership must not silently commit or end a turn.
  await visitPage(desktop, origin, "/share");
  await expect(
    desktop.getByRole("button", { name: "Live", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await desktop
    .getByRole("button", { name: "Turn-based", exact: true })
    .click();
  await desktop
    .getByRole("alertdialog")
    .getByRole("button", { name: "Change mode", exact: true })
    .click();
  await expect(
    desktop.getByRole("button", { name: "Turn-based", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await visitPage(desktop, origin, "/party?section=funds");
  await desktop.locator(`#${id} > summary`).click();
  await desktop
    .locator(`#${id} .portrait-picker input[type=file]`)
    .setInputFiles({
      name: "turn-portrait.png",
      mimeType: "image/png",
      buffer: Buffer.from(picture, "base64"),
    });
  await expect(
    desktop.getByText(
      "Portrait queued for your turn. Submit the turn to sync it.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await visitPage(desktop, origin, "/account");
  await desktop
    .getByRole("button", { name: "Save current membership", exact: true })
    .click();
  await expect(
    desktop
      .getByRole("status")
      .filter({ hasText: "Your turn still has pending changes" }),
  ).toBeVisible();
  const saved = await accountPost(desktop.context(), origin, "sheets/detail", {
    id: `campaign:${member.code}:${id.slice(6)}`,
  });
  expect(saved.body.portrait).toBe(portrait);
});

test("campaign-choice", async ({ devices, baseURL: origin }, testInfo) => {
  const desktop = devices.page;
  const { other: phone } = await signedInDevices(devices, origin);
  await phone.setViewportSize({ width: 390, height: 844 });
  const members = async () => {
    const response = await desktop
      .context()
      .request.get(`${origin}/api/account/library`);
    expect(response.ok()).toBeTruthy();
    return (await response.json()).members;
  };
  await visitPage(phone, origin, "/share");
  await phone
    .getByRole("button", { name: "Start a room", exact: true })
    .click();
  await phone.getByRole("button", { name: "Create room", exact: true }).click();
  await phone
    .getByRole("button", { name: "Share join link", exact: true })
    .waitFor();
  // No manual trip to My account: the new room must be available on device two.
  await expect.poll(async () => (await members()).length).toBe(1);
  const firstCode = (await members())[0].code;

  await visitPage(desktop, origin, "/share");
  await desktop
    .getByRole("button", { name: "Start a room", exact: true })
    .click();
  await expect(
    desktop.getByRole("link", { name: "Resume a saved campaign", exact: true }),
  ).toBeVisible();
  await expect(
    desktop.getByRole("heading", {
      name: "You already have saved campaigns",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    desktop.getByRole("button", { name: "Create room", exact: true }),
  ).toBeDisabled();
  await desktop.screenshot({
    path: testInfo.outputPath("saved-campaign-choice.png"),
    fullPage: true,
  });
  await desktop
    .getByRole("checkbox", {
      name: "Create a separate room from this device’s copy",
      exact: true,
    })
    .check();

  let blocked = 0;
  const rejectLink = (route) => {
    blocked++;
    return route.abort("failed");
  };
  await desktop.route("**/api/account/link", rejectLink);
  await desktop
    .getByRole("button", { name: "Create room", exact: true })
    .click();
  await expect.poll(() => blocked).toBe(1);
  await expect(
    desktop.getByRole("alert").filter({
      hasText:
        "Room saved to your account, but its display name could not be updated",
    }),
  ).toBeVisible();
  const secondCode = await desktop.locator(".room-code").innerText();
  expect(secondCode).not.toBe(firstCode);
  expect((await members()).length).toBe(2);
  await desktop.unroute("**/api/account/link", rejectLink);
  await desktop
    .getByRole("button", { name: "Retry account save", exact: true })
    .click();
  await expect.poll(async () => (await members()).length).toBe(2);
  await expect(desktop.locator(".room-code")).toHaveText(secondCode);

  await visitPage(phone, origin, "/account");
  const old = phone
    .locator("article.portal-card")
    .filter({ hasText: firstCode });
  await expect(
    old.getByText("Open on this device", { exact: true }),
  ).toBeVisible();
  let warning = "";
  phone.once("dialog", async (dialog) => {
    warning = dialog.message();
    await dialog.dismiss();
  });
  await old.getByRole("button", { name: "Resume", exact: true }).click();
  await expect.poll(() => warning).toContain("separate rooms");
  expect(new URL(phone.url()).pathname).toBe("/account");
  phone.once("dialog", (dialog) => dialog.accept());
  await old.getByRole("button", { name: "Resume", exact: true }).click();
  await phone.waitForURL((url) => url.pathname === "/");
  await visitPage(phone, origin, "/share");
  await expect(phone.locator(".room-code")).toHaveText(firstCode);
  expect((await members()).length).toBe(2);
});

test("invitations", async ({ devices, baseURL: origin }, testInfo) => {
  async function openGuest(page) {
    await visitPage(page, origin, "/share");
    const guide = page.getByRole("button", { name: "Not now", exact: true });
    if (await guide.isVisible()) await guide.click();
    await expect(page.locator(".role-chip:enabled")).toBeVisible();
  }
  async function host(page) {
    await openGuest(page);
    await page
      .getByRole("button", { name: "Start a room", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Create room", exact: true })
      .click();
    await expect(page.locator(".room-code")).toBeVisible();
    await expect(
      page.locator('.multiplayer-hub[aria-busy="false"]'),
    ).toBeVisible();
    return page.locator(".room-code").innerText();
  }
  const dm = devices.page;
  const target = await host(dm);
  await dm.evaluate(() =>
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data) => {
        window.auditSharedLink = data.url;
      },
    }),
  );
  await dm
    .getByRole("button", { name: "Share join link", exact: true })
    .click();
  await expect
    .poll(() => dm.evaluate(() => window.auditSharedLink || ""))
    .not.toBe("");
  expect(
    new URL(await dm.evaluate(() => window.auditSharedLink)).searchParams.get(
      "join",
    ),
  ).toBe(target);
  // Exercise the actual player-specific copy control, not a hand-built URL.
  await dm.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.auditCopiedLink = text;
        },
      },
    }),
  );
  await dm.getByText("Manual sharing & files", { exact: true }).click();
  await dm
    .getByRole("button", { name: "Copy link", exact: true })
    .first()
    .click();
  await expect
    .poll(() => dm.evaluate(() => window.auditCopiedLink || ""))
    .not.toBe("");
  const invite = new URL(await dm.evaluate(() => window.auditCopiedLink));
  expect(invite.pathname).toBe("/share");
  expect(invite.searchParams.get("join")).toBe(target);
  expect(invite.searchParams.get("character")).toBeTruthy();
  expect(invite.hash).toBe("");
  await expect(
    dm.getByRole("button", { name: "Copy offline snapshot link", exact: true }),
  ).toHaveCount(0);
  await expect(
    dm.getByRole("button", { name: "Download file", exact: true }),
  ).toHaveCount(0);
  const { page: otherDm } = await devices.newDevice();
  const previous = await host(otherDm);
  expect(previous).not.toBe(target);
  const { page: player } = await devices.newDevice(390);
  await openGuest(player);
  await otherDm.evaluate(() =>
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data) => {
        window.auditSharedLink = data.url;
      },
    }),
  );
  await otherDm
    .getByRole("button", { name: "Share join link", exact: true })
    .click();
  const previousSession = new URL(
    await otherDm.evaluate(() => window.auditSharedLink),
  ).searchParams.get("session");
  await visitPage(
    player,
    origin,
    `/share?join=${previous}&session=${previousSession}`,
  );
  await player
    .getByRole("button", { name: "Find characters", exact: true })
    .click();
  await player
    .getByPlaceholder("What should the party call you?")
    .fill("Invitation player");
  await player.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(player.locator(".room-code")).toHaveText(previous);

  // Same-document navigation must update invitation state, including browser back/forward.
  await player.evaluate(
    (url) => history.pushState(null, "", url),
    invite.href + "&tab=chat",
  );
  const choice = player.getByRole("alertdialog", {
    name: "Invitation to a different room",
  });
  await expect(choice).toBeVisible();
  await expect(choice).toContainText(target);
  await expect(choice).toContainText(previous);
  await expect(
    player.locator('[role="tab"]').filter({ hasText: /^Room$/ }),
  ).toHaveAttribute("aria-selected", "true");
  await player.screenshot({
    path: testInfo.outputPath("invite-conflict-mobile.png"),
    fullPage: true,
  });
  await choice
    .getByRole("button", { name: "Stay in this room", exact: true })
    .click();
  await expect
    .poll(() => new URL(player.url()).searchParams.has("join"))
    .toBe(false);
  await expect(player.locator(".room-code")).toHaveText(previous);
  const unavailable = new URL(invite);
  unavailable.searchParams.set("character", "unavailable-character");
  await player.evaluate(
    (url) => history.pushState(null, "", url),
    unavailable.href,
  );
  await choice
    .getByRole("button", { name: "Switch rooms…", exact: true })
    .click();
  await player
    .getByRole("alertdialog", { name: "Switch to the invited room?" })
    .getByRole("button", { name: "Back up and continue", exact: true })
    .click();
  await expect(
    player
      .locator("[data-sonner-toast]")
      .filter({ hasText: "The invited character is unavailable" }),
  ).toBeVisible();
  await expect(player.locator(".room-code")).toHaveText(previous);
  await choice
    .getByRole("button", { name: "Stay in this room", exact: true })
    .click();
  await expect
    .poll(() => new URL(player.url()).searchParams.has("join"))
    .toBe(false);
  await player.evaluate((url) => history.pushState(null, "", url), invite.href);
  await expect(choice).toBeVisible();
  await player.goBack();
  await expect(choice).toBeHidden();
  await player.goForward();
  await expect(choice).toBeVisible();
  await choice
    .getByRole("button", { name: "Switch rooms…", exact: true })
    .click();
  await player
    .getByRole("alertdialog", { name: "Switch to the invited room?" })
    .getByRole("button", { name: "Back up and continue", exact: true })
    .click();
  await expect(player.getByPlaceholder("Enter your code")).toHaveValue(target);
  await player
    .getByRole("button", { name: "Find characters", exact: true })
    .click();
  await expect(
    player.getByRole("combobox", {
      name: "Choose your character",
      exact: true,
    }),
  ).toHaveValue(invite.searchParams.get("character"));
  await player.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(player.locator(".room-code")).toHaveText(target);
  await expect(dm.locator(".room-code")).toHaveText(target);
  await expect(otherDm.locator(".room-code")).toHaveText(previous);
  await expect(
    player
      .getByRole("status")
      .filter({ hasText: "Connected · All changes saved" }),
  ).toBeVisible();
  await expect
    .poll(() => new URL(player.url()).searchParams.has("join"))
    .toBe(false);
});

test("ownership", async ({ devices, baseURL: origin }, testInfo) => {
  const dm = devices.page;
  dm.guestAccessAudit = true;
  await visitPage(dm, origin, "/");
  await expect(
    dm.getByText(
      "Create an account or sign in to proceed as a Dungeon Master in your own campaign",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    await dm.evaluate(async () => (await indexedDB.databases()).length),
  ).toBe(0);
  // A pre-account device save must survive the migration gate unchanged.
  await dm.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open("quire", 3);
      open.onupgradeneeded = () => {
        for (const name of [
          "books",
          "articles",
          "purses",
          "holdings",
          "shops",
          "stock",
          "ledger",
          "meta",
          "catalog",
          "lexicon",
        ]) {
          const store = open.result.createObjectStore(name, { keyPath: "id" });
          if (name === "articles") store.createIndex("bookId", "bookId");
          if (name === "holdings") store.createIndex("purseId", "purseId");
          if (name === "stock") store.createIndex("shopId", "shopId");
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["purses", "meta"], "readwrite");
      tx.objectStore("purses").put({
        id: "legacy-hero",
        name: "Preserved legacy hero",
        kind: "character",
        control: "player",
        coins: { cp: 3, sp: 2, ep: 0, gp: 37, pp: 0 },
      });
      tx.objectStore("meta").put({ id: "seeded" });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  const owner = credentials();
  await accountPost(devices.context, origin, "auth/sign-up/email", owner);
  await visitPage(dm, origin, "/");
  await dm
    .getByRole("button", {
      name: "Claim this device’s existing DM campaign",
      exact: true,
    })
    .click();
  await expect(dm.getByText("Campaign control", { exact: true })).toBeVisible();
  const guide = dm.getByRole("button", { name: "Not now", exact: true });
  if (await guide.isVisible()) await guide.click();
  await visitPage(dm, origin, "/party");
  await expect(
    dm.getByText("Preserved legacy hero", { exact: true }).first(),
  ).toBeVisible();
  const members = await createAndSaveRoom(dm, origin);
  const code = members[0].code;
  await visitPage(dm, origin, "/share");
  await dm.evaluate(() =>
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data) => {
        window.invitationForTest = data.url;
      },
    }),
  );
  await dm
    .getByRole("button", { name: "Share join link", exact: true })
    .click();
  const link = await dm.evaluate(() => window.invitationForTest);
  expect(new URL(link).searchParams.get("session")).toBeTruthy();
  const { page: guest } = await devices.newDevice(390);
  await visitPage(guest, origin, new URL(link).pathname + new URL(link).search);
  await guest
    .getByRole("button", { name: "Find characters", exact: true })
    .click();
  await guest
    .getByPlaceholder("What should the party call you?")
    .fill("Guest adventurer");
  await guest.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(guest.locator(".room-code")).toHaveText(code);
  expect(
    await guest.evaluate(async () => (await indexedDB.databases()).length),
  ).toBe(0);
  expect(
    await guest.evaluate(() =>
      Object.keys(localStorage).some((k) => k.startsWith("quire.cloud")),
    ),
  ).toBe(false);
  await guest.reload();
  await continueIntoApp(guest);
  await expect(guest.locator(".room-code")).toHaveText(code);
  await guest.screenshot({
    path: testInfo.outputPath("guest-memory-mobile.png"),
    fullPage: true,
  });
  await endSession(dm, origin);
  await expect(guest.locator(".room-code")).toBeHidden();
  expect(
    await guest.evaluate(() =>
      sessionStorage.getItem("lootsplit.player.reconnect.v1"),
    ),
  ).toBeNull();
  await visitPage(dm, origin, "/account");
  await dm.getByRole("button", { name: "Reopen as DM", exact: true }).click();
  await dm.waitForURL((u) => u.pathname === "/");
  await continueIntoApp(dm);
  await visitPage(guest, origin, new URL(link).pathname + new URL(link).search);
  await guest
    .getByRole("button", { name: "Find characters", exact: true })
    .click();
  await expect(
    guest
      .locator("[data-sonner-toast]")
      .filter({ hasText: "invitation has expired" }),
  ).toBeVisible();
  const returning = credentials();
  await accountPost(guest.context(), origin, "auth/sign-up/email", returning);
  await visitPage(dm, origin, "/share");
  await dm.evaluate(() =>
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data) => {
        window.invitationForTest = data.url;
      },
    }),
  );
  await dm
    .getByRole("button", { name: "Share join link", exact: true })
    .click();
  const freshLink = new URL(await dm.evaluate(() => window.invitationForTest));
  await visitPage(guest, origin, freshLink.pathname + freshLink.search);
  await guest
    .getByRole("button", { name: "Find characters", exact: true })
    .click();
  await guest
    .getByPlaceholder("What should the party call you?")
    .fill("Returning player");
  await guest.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(guest.locator(".room-code")).toHaveText(code);
  const { page: secondPlayer, context: playerContext } =
    await devices.newDevice();
  await accountPost(playerContext, origin, "auth/sign-in/email", returning);
  await visitPage(secondPlayer, origin, "/account");
  await secondPlayer
    .getByRole("button", { name: "Resume", exact: true })
    .click();
  await secondPlayer.waitForURL((u) => u.pathname === "/");
  await continueIntoApp(secondPlayer);
  await visitPage(secondPlayer, origin, "/share");
  await expect(secondPlayer.locator(".room-code")).toHaveText(code);
  expect(
    await secondPlayer.evaluate(
      async () => (await indexedDB.databases()).length,
    ),
  ).toBe(0);
  // Closing the DM's tab is not End session; a fresh player reload still reconnects.
  await dm.close();
  await secondPlayer.reload();
  await continueIntoApp(secondPlayer);
  await expect(secondPlayer.locator(".room-code")).toHaveText(code);
});
