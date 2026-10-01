import { getCloudWatch } from "./cloud-turn.ts";
import { closeQuireDb, deleteQuireDatabase } from "./db.ts";
import { getSeat, reloadSeat } from "./table.ts";

export type Campaign = { id: string; name: string; db: string; blank?: boolean };

const REGISTRY = "quire.campaigns.v1";
const ACTIVE = "quire.campaign.v1";
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
  const id = crypto.randomUUID();
  const campaign: Campaign = { id, name: cleanName(name), db: `quire-${id}`, blank: true };
  state = { campaigns: [...state.campaigns, campaign], activeId: state.activeId };
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
  localStorage.setItem("quire.deletion.v1", JSON.stringify({ target, next }));
  deleting = true;
  try {
    await deleteQuireDatabase(target.db);
  } catch (error) {
    localStorage.removeItem("quire.deletion.v1");
    deleting = false;
    throw error;
  }
  state = next;
  persist();
  localStorage.removeItem("quire.deletion.v1");
  deleting = false;
  closeQuireDb();
  reloadSeat();
  publish();
}

function playersCannotChangeCampaigns() {
  if (deleting)
    throw new Error(
      "A campaign deletion is still finishing. Close other Lootsplit tabs if it is waiting.",
    );
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
  const pending = window.localStorage.getItem("quire.deletion.v1");
  if (pending) {
    try {
      const intent = JSON.parse(pending) as { target: Campaign; next: CampaignState };
      if (
        readCampaign(intent.target) &&
        Array.isArray(intent.next.campaigns) &&
        intent.next.campaigns.every((c) => readCampaign(c))
      ) {
        void deleteQuireDatabase(intent.target.db)
          .then(() => {
            state = intent.next;
            persist();
            localStorage.removeItem("quire.deletion.v1");
            reloadSeat();
            publish();
          })
          .catch(() => {});
      }
    } catch {
      /* Retain the existing registry if the intent cannot be read. */
    }
  }
  persist();
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
