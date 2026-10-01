import { getCloudWatch } from "./cloud-turn.ts";
import { closeQuireDb, deleteQuireDatabase } from "./db.ts";
import { getSeat, reloadSeat } from "./table.ts";

export type Campaign = { id: string; name: string; db: string };

const REGISTRY = "quire.campaigns.v1";
const ACTIVE = "quire.campaign.v1";
export const FIRST_CAMPAIGN: Campaign = { id: "main", name: "Party overview", db: "quire" };

type CampaignState = { campaigns: Campaign[]; activeId: string };

const listeners = new Set<() => void>();
let booted = false;
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
  const campaign: Campaign = { id, name: cleanName(name), db: `quire-${id}` };
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
    campaigns: state.campaigns.map((campaign) => (campaign.id === id ? { ...campaign, name: next } : campaign)),
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
  if (state.campaigns.length < 2) throw new Error("Keep at least one campaign.");
  const target = state.campaigns.find((campaign) => campaign.id === id);
  if (!target) return;
  const remaining = state.campaigns.filter((campaign) => campaign.id !== id);
  if (state.activeId === id) {
    state = { campaigns: remaining, activeId: remaining[0]!.id };
    persist();
    closeQuireDb();
    reloadSeat();
    publish();
  } else {
    state = { ...state, campaigns: remaining };
    persist();
    publish();
  }
  await deleteQuireDatabase(target.db);
}

function playersCannotChangeCampaigns() {
  if (getCloudWatch().joined) throw new Error("Return to Local Mode before changing campaigns.");
  if (getSeat().role === "player") throw new Error("A player link cannot create, change, or delete campaigns.");
}

function boot() {
  if (booted || typeof window === "undefined") return;
  booted = true;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REGISTRY) || "null") as unknown;
    const campaigns = Array.isArray(parsed) ? parsed.map(readCampaign).filter((campaign): campaign is Campaign => campaign !== null) : [];
    const list = campaigns.length > 0 ? campaigns : [FIRST_CAMPAIGN];
    const stored = window.localStorage.getItem(ACTIVE);
    const activeId = list.some((campaign) => campaign.id === stored) ? stored! : list[0]!.id;
    state = { campaigns: list, activeId };
  } catch {
    state = { campaigns: [FIRST_CAMPAIGN], activeId: FIRST_CAMPAIGN.id };
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
  if (typeof row.id !== "string" || typeof row.db !== "string" || !row.db.startsWith("quire")) return null;
  return { id: row.id, name: cleanName(row.name || "Campaign"), db: row.db };
}
