import { expect } from "playwright/test";
/** Exercise the actual search menu when a data picker replaces a native select. */
export async function chooseOption(picker, choice) {
  if (await picker.evaluate((el) => el.tagName === "SELECT")) return picker.selectOption(choice);
  let option;
  await expect
    .poll(
      async () => {
        option = await picker.evaluate((el, wanted) => {
          const options = [...el.closest(".record-select").querySelector("select").options];
          const found = options.find((o, i) =>
            typeof wanted === "string"
              ? o.value === wanted
              : typeof wanted === "number"
                ? i === wanted
                : wanted.value !== undefined
                  ? o.value === wanted.value
                  : wanted.label !== undefined
                    ? o.label === wanted.label
                    : i === wanted.index,
          );
          return found ? { value: found.value, label: found.label } : null;
        }, choice);
        return option;
      },
      { timeout: 20000, message: `Record option ${JSON.stringify(choice)} becomes available` },
    )
    .not.toBeNull();
  await picker.click();
  const menu = picker.page().locator(".record-select-menu:visible");
  await menu.getByRole("combobox").fill(option.label);
  await menu.locator(`[role="option"][data-value=${JSON.stringify(option.value)}]`).click();
}
