// Browser-audit helpers for the themed confirmations and prompts that replace window.confirm and
// window.prompt (src/lib/quire/confirm-store.ts, rendered by src/components/confirm-dialog.tsx).
// Playwright's page.on("dialog") still sees native beforeunload warnings, never these dialogs.
// Unlike native dialogs (auto-dismissed when nothing listens), a themed dialog stays open until
// it is answered, so an audit that triggers one must answer it.

const SELECTOR = "[data-themed-dialog]";

/** The open themed dialog (role alertdialog for confirmations, dialog for prompts). */
export const themedDialog = (page) => page.locator(SELECTOR).first();

/**
 * Wait for the next themed dialog and answer it: the confirm button (accept) or Cancel / Keep
 * editing. `value` is typed into a prompt first. Returns the dialog's text, like dialog.message().
 */
export async function answerThemedDialog(page, { accept = true, value, timeout = 15000 } = {}) {
  const dialog = themedDialog(page);
  await dialog.waitFor({ state: "visible", timeout });
  const handle = await dialog.elementHandle();
  const message = (await dialog.innerText()).trim();
  if (value !== undefined) await dialog.locator("input").fill(value);
  await dialog.locator(accept ? "[data-dialog-confirm]" : "[data-dialog-cancel]").click();
  await handle?.waitForElementState("hidden").catch(() => {});
  return message;
}

/**
 * The themed counterpart of page.on("dialog", (d) => d.accept()): every themed dialog in this page
 * (now and after reloads) is answered as it appears. `stop()` turns it off for this tab;
 * `messages()` lists what was asked since the current document loaded.
 */
export async function autoAnswerThemedDialogs(page, { accept = true } = {}) {
  const install = ({ selector, accept: yes }) => {
    try {
      if (sessionStorage.getItem("audit.themedDialogs") === "off") return;
    } catch {
      /* about:blank has no storage */
    }
    const state = (window.__themedDialogs ??= { accept: yes, log: [], installed: false });
    state.accept = yes;
    if (state.installed) return;
    state.installed = true;
    const answer = () => {
      if (state.accept === null) return;
      for (const dialog of document.querySelectorAll(selector)) {
        if (dialog.hasAttribute("data-audit-answered")) continue;
        dialog.setAttribute("data-audit-answered", "");
        state.log.push(dialog.textContent?.trim() ?? "");
        // Let the dialog finish mounting (focus trap, listeners) before answering it.
        setTimeout(() =>
          dialog
            .querySelector(state.accept ? "[data-dialog-confirm]" : "[data-dialog-cancel]")
            ?.click(),
        50);
      }
    };
    const start = () =>
      new MutationObserver(answer).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    if (document.documentElement) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  };
  const config = { selector: SELECTOR, accept };
  await page.addInitScript(install, config);
  await page.evaluate(() => {
    try {
      sessionStorage.removeItem("audit.themedDialogs");
    } catch {
      /* about:blank */
    }
  });
  await page.evaluate(install, config).catch(() => {});
  return {
    messages: () => page.evaluate(() => window.__themedDialogs?.log ?? []),
    stop: () =>
      page.evaluate(() => {
        if (window.__themedDialogs) window.__themedDialogs.accept = null;
        try {
          sessionStorage.setItem("audit.themedDialogs", "off");
        } catch {
          /* about:blank */
        }
      }),
  };
}
