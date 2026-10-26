/**
 * Per-device conveniences for the shop counter and the Market (design plan D6, DM QoL 3,
 * player QoL 6): the last "Paying from" purse per shop per campaign, and whether the Market's
 * trade exchange section was left open. Browser storage only; every read and write tolerates
 * blocked storage, and nothing here is campaign data.
 */
type Store = Pick<Storage, "getItem" | "setItem">;

const PAYER_KEY = "lootsplit.shop-payer.v1";
const PAYER_LIMIT = 200;
export const EXCHANGE_OPEN_KEY = "lootsplit.market.exchange-open.v1";

function store(given?: Store | null): Store | null {
  if (given !== undefined) return given;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function payers(storage: Store | null): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(PAYER_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

export function rememberedPayer(campaignId: string, shopId: string, given?: Store | null): string {
  return payers(store(given))[`${campaignId}|${shopId}`] ?? "";
}

export function rememberPayer(campaignId: string, shopId: string, purseId: string, given?: Store | null) {
  const storage = store(given);
  if (!storage || !purseId) return;
  const key = `${campaignId}|${shopId}`;
  const current = payers(storage);
  delete current[key];
  // Newest last; the oldest shops are forgotten first so the entry stays small.
  const next = Object.entries({ ...current, [key]: purseId }).slice(-PAYER_LIMIT);
  try {
    storage.setItem(PAYER_KEY, JSON.stringify(Object.fromEntries(next)));
  } catch {
    /* The choice still applies on this page. */
  }
}

/** The remembered purse when this seat may still spend it, else the party purse, else the first. */
export function initialPayer(
  spendable: readonly { id: string; kind: string }[],
  remembered: string,
): string {
  if (remembered && spendable.some((purse) => purse.id === remembered)) return remembered;
  return spendable.find((purse) => purse.kind === "party")?.id ?? spendable[0]?.id ?? "";
}

export function readDeviceFlag(key: string, fallback: boolean, given?: Store | null): boolean {
  try {
    const raw = store(given)?.getItem(key);
    return raw === "1" ? true : raw === "0" ? false : fallback;
  } catch {
    return fallback;
  }
}

export function writeDeviceFlag(key: string, value: boolean, given?: Store | null) {
  try {
    store(given)?.setItem(key, value ? "1" : "0");
  } catch {
    /* Remembered for this page only. */
  }
}
