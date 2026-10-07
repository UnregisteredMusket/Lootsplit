import { getCloudWatch } from "./cloud-turn.ts";
import { closeQuireDb, deleteQuireDatabase } from "./db.ts";
import { getSeat, reloadSeat } from "./table.ts";

export type Campaign = { id: string; name: string; db: string; blank?: boolean };

const REGISTRY = "quire.campaigns.v1";
const ACTIVE = "quire.campaign.v1";
const DELETION = "quire.deletion.v1";
export const FIRST_CAMPAIGN: Campaign = { id: "main", name: "Party overview", db: "quire" };

type CampaignState = { campaigns: Campaign[]; activeId: string };

const listeners = new Set<() => void>();
let booted = false;
let deleting = false;
let state: CampaignState = { campaigns: [FIRST_CAMPAIGN], activeId: FIRST_CAMPAIGN.id };
const SERVER_CAMPAIGNS: CampaignState = state;

export function serverCampaigns(): CampaignState {
  return SERVER_CAMPAIGNS;
}

export function resolveDatabaseName(activeId: string | null, list: Campaign[]): string {
  return list.find((campaign) => campaign.id === activeId)?.db || list[0]?.db || FIRST_CAMPAIGN.db;
}

export function getCampaigns(): CampaignState {
  boot();
  return state;
}

export function subscribeCampaigns(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function createCampaign(name: string) {
  boot();
  playersCannotChangeCampaigns();
  const owner = sessionStorage.getItem("lootsplit.verified-account");
  if (!owner) throw Error("Sign in before creating a campaign.");
  const id = crypto.randomUUID();
  const campaign: Campaign = { id, name: cleanName(name), db: `quire-${id}`, blank: true };
  state = { campaigns: [...state.campaigns, campaign], activeId: state.activeId };
  localStorage.setItem(`quire.owner.${id}`, owner);
  persist();
  switchCampaign(id);
}

export function renameCampaign(id: string, name: string) {
  boot();
  playersCannotChangeCampaigns();
  const next = cleanName(name);
  state = {
    ...state,
    campaigns: state.campaigns.map((campaign) =>
      campaign.id === id ? { ...campaign, name: next } : campaign,
    ),
  };
  persist();
  publish();
}

export function switchCampaign(id: string) {
  boot();
  playersCannotChangeCampaigns();
  if (!state.campaigns.some((campaign) => campaign.id === id) || id === state.activeId) return;
  const owner = localStorage.getItem(`quire.owner.${id}`);
  if (owner && owner !== sessionStorage.getItem("lootsplit.verified-account")) throw Error("Sign in to the account that owns this campaign.");
  if (!owner) throw Error("Claim this device campaign after signing in before opening it.");
  state = { ...state, activeId: id };
  persist();
  closeQuireDb();
  reloadSeat();
  publish();
}

export async function deleteCampaign(id: string) {
  boot();
  playersCannotChangeCampaigns();
  const target = state.campaigns.find((c) => c.id === id);
  if (!target) return;
  const remaining = state.campaigns.filter((c) => c.id !== id);
  if (!remaining.length) {
    const fresh = crypto.randomUUID();
    remaining.push({ id: fresh, name: "New campaign", db: `quire-${fresh}`, blank: true });
  }
  const next = {
    campaigns: remaining,
    activeId: state.activeId === id ? remaining[0]!.id : state.activeId,
  };
  // Durable intent permits recovery if the browser closes between IDB deletion and registry commit.
  localStorage.setItem(DELETION, JSON.stringify({ target, next }));
  deleting = true;
  try {
    await deleteQuireDatabase(target.db);
  } catch (error) {
    localStorage.removeItem(DELETION);
    deleting = false;
    throw error;
  }
  completeDeletion(target, next);
}

function assertNoDeletion() {
  if (deleting || (typeof window !== "undefined" && window.localStorage.getItem(DELETION)))
    throw new Error(
      "A campaign deletion is still finishing. Close other Lootsplit tabs if it is waiting.",
    );
}

function playersCannotChangeCampaigns() {
  assertNoDeletion();
  refreshRegistry();
  if (getCloudWatch().joined) throw new Error("Return to Local Mode before changing campaigns.");
  if (getSeat().role === "player")
    throw new Error("A player link cannot create, change, or delete campaigns.");
}

function boot() {
  if (booted || typeof window === "undefined") return;
  booted = true;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REGISTRY) || "null") as unknown;
    const campaigns = Array.isArray(parsed)
      ? parsed.map(readCampaign).filter((campaign): campaign is Campaign => campaign !== null)
      : [];
    const list = campaigns.length > 0 ? campaigns : [FIRST_CAMPAIGN];
    const stored = window.localStorage.getItem(ACTIVE);
    const activeId = list.some((campaign) => campaign.id === stored) ? stored! : list[0]!.id;
    state = { campaigns: list, activeId };
  } catch {
    state = { campaigns: [FIRST_CAMPAIGN], activeId: FIRST_CAMPAIGN.id };
  }
  const pending = window.localStorage.getItem(DELETION);
  if (pending) {
    try {
      const intent = JSON.parse(pending) as { target: Campaign; next: CampaignState };
      if (
        readCampaign(intent.target) &&
        Array.isArray(intent.next.campaigns) &&
        intent.next.campaigns.length > 0 &&
        intent.next.campaigns.every((c) => readCampaign(c))
      ) {
        deleting = true;
        void deleteQuireDatabase(intent.target.db)
          .then(() => completeDeletion(intent.target, intent.next))
          .catch(() => {});
      }
    } catch {
      /* Retain the existing registry if the intent cannot be read. */
    }
  }
  persist();
}

function refreshRegistry() {
  if (typeof window === "undefined") return;
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(REGISTRY) || "null");
    if (!Array.isArray(raw)) return;
    const campaigns = raw.map(readCampaign).filter((c): c is Campaign => c !== null);
    if (!campaigns.length) return;
    const active = window.localStorage.getItem(ACTIVE);
    // Registry reconciliation must not silently switch this tab into another tab's seat.
    const activeId = campaigns.some(c => c.id === state.activeId) ? state.activeId
      : campaigns.some(c => c.id === active) ? active! : campaigns[0]!.id;
    state = { campaigns, activeId };
  } catch { /* Preserve the last readable registry. */ }
}

function completeDeletion(target: Campaign, fallback: CampaignState) {
  // The durable intent is a recovery hint, not an authoritative replacement registry.
  // Another tab (including an older client) may have committed newer metadata while IDB was blocked.
  refreshRegistry();
  const campaigns = state.campaigns.filter(c => c.id !== target.id);
  if (!campaigns.length) campaigns.push(...fallback.campaigns.filter(c => c.id !== target.id));
  const latestActive = localStorage.getItem(ACTIVE);
  const activeId = campaigns.some(c => c.id === state.activeId) ? state.activeId
    : campaigns.some(c => c.id === latestActive) ? latestActive!
    : campaigns.some(c => c.id === fallback.activeId) ? fallback.activeId : campaigns[0]!.id;
  state = { campaigns, activeId };
  persist();
  localStorage.removeItem(DELETION);
  deleting = false;
  closeQuireDb();
  reloadSeat();
  publish();
}

function persist() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REGISTRY, JSON.stringify(state.campaigns));
  window.localStorage.setItem(ACTIVE, state.activeId);
}

function publish() {
  for (const listener of listeners) listener();
}

function cleanName(name: string) {
  const next = name.replace(/\s+/g, " ").trim();
  return next.slice(0, 60) || "New campaign";
}

function readCampaign(value: unknown): Campaign | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Partial<Campaign>;
  if (typeof row.id !== "string" || typeof row.db !== "string" || !row.db.startsWith("quire"))
    return null;
  return {
    id: row.id,
    name: cleanName(row.name || "Campaign"),
    db: row.db,
    ...(row.blank ? { blank: true } : {}),
  };
}

/** Account resume selects a separate device database; it never promotes the old player copy. */
export function selectAccountCampaign(id: string, name: string, seat: import('./table.ts').Seat) {
  boot();
  assertNoDeletion();
  refreshRegistry();
  if (!/^account-[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid account campaign.');
  const existing = state.campaigns.find(c => c.id === id);
  localStorage.setItem(`quire.seat.v1.${id}`, JSON.stringify(seat));
  state = { campaigns: existing ? state.campaigns : [...state.campaigns, { id, name: cleanName(name), db: `quire-${id}`, blank: true }], activeId: id };
  persist();
  closeQuireDb();
  reloadSeat();
  // The caller reloads once credentials have been written. No intermediate DM render.
}
