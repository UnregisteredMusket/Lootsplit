/**
 * Modern "$" prices (design decision 2, 2026-10-25): the setting stays available everywhere, but
 * until a device chooses it, DM seats show dollars and player seats do not.
 */
export type DollarPrefs = { showDollars: boolean; dollarsChosen: boolean };

/**
 * Whether stored preferences hold the person's own choice. A stored "off" can only have come
 * from the person (the old default was on), so it stays theirs; a stored "on" without the marker
 * is the old default and follows the seat.
 */
export function dollarsChoiceFrom(input: { showDollars?: unknown; dollarsChosen?: unknown } | null | undefined): boolean {
  return input?.dollarsChosen === true || input?.showDollars === false;
}

/** A patch that sets "Show dollars" records it as this device's own choice. */
export function markDollarsChoice<T extends object>(patch: T): T & { dollarsChosen?: true } {
  return Object.prototype.hasOwnProperty.call(patch, "showDollars") ? { ...patch, dollarsChosen: true } : patch;
}

/** Whether modern prices show for this seat: the device's choice, else on for DMs only. */
export function dollarsShown(prefs: DollarPrefs, role: "dm" | "player"): boolean {
  return prefs.dollarsChosen ? prefs.showDollars : role !== "player";
}

/** "≈ $12,500 modern": a comparison, never a second price. */
export function modernDollarText(dollars: string): string {
  return `≈ ${dollars} modern`;
}
