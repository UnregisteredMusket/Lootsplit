/** Use the same recoveries as the existing sheet buttons. Hit dice/conditions stay DM-managed. */
/** @param {import("./model.mjs").PlaySheet} sheet @param {"short"|"long"} rest */
export function restedSheet(sheet, rest) {
  return {
    ...sheet,
    ...(rest === "long"
      ? {
          hp: sheet.maxHp,
          deathSuccesses: 0,
          deathFailures: 0,
          slots: sheet.slots.map((s) => ({ ...s, used: 0 })),
        }
      : {}),
    resources: sheet.resources.map((r) =>
      r.recovery === "short" || (rest === "long" && r.recovery === "long")
        ? { ...r, current: r.max }
        : r,
    ),
  };
}
