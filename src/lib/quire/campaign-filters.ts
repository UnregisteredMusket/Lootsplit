/**
 * Remembered list filters per campaign (design QoL 3): Review Inbox's type chip and the
 * inventory's holder, category and Equipped filters come back when you reopen that campaign on
 * this device. A per-viewer convenience in localStorage: every access is in try/catch, a stored
 * value that no longer applies is ignored, and guest (in-memory) campaigns are not remembered.
 */
const PREFIX = "lootsplit.filters.v1.";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function local(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function filterStorageItem(campaignId: string, list: string): string {
  return `${PREFIX}${campaignId}.${list}`;
}

export function readFilters<T extends Record<string, unknown>>(
  campaignId: string,
  list: string,
  defaults: T,
  storage: Store | null = local(),
): T {
  try {
    const raw = JSON.parse(storage?.getItem(filterStorageItem(campaignId, list)) || "null");
    if (!raw || typeof raw !== "object") return defaults;
    const out = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof T)[])
      if (typeof raw[key] === typeof defaults[key]) out[key] = raw[key];
    return out;
  } catch {
    return defaults;
  }
}

/** Saves the filters; the defaults themselves are stored as "nothing remembered". */
export function writeFilters<T extends Record<string, unknown>>(
  campaignId: string,
  list: string,
  value: T,
  defaults: T,
  storage: Store | null = local(),
): void {
  try {
    const item = filterStorageItem(campaignId, list);
    if (Object.keys(defaults).every((k) => value[k] === defaults[k])) storage?.removeItem(item);
    else storage?.setItem(item, JSON.stringify(value));
  } catch {
    /* Storage blocked or full: the filters last until the page closes. */
  }
}
