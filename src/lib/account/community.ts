import { accountRequest } from "./client";

export type CommunityVisibility = "off" | "members" | "public";
export type PlayRole = "" | "dm" | "player" | "both";
export type LookingFor = "" | "players" | "group";

/** A community profile as other people see it. Never carries an email address. */
export type CommunityProfile = {
  handle: string;
  name: string;
  member_since: string | number;
  introduction: string;
  portrait: string;
  play_role: PlayRole;
  games: string[];
  time_zone: string;
  play_times: string;
  discord: string;
  lfg: LookingFor;
  lfg_note: string;
  updated_at: number | null;
};

/** The signed-in member's own community settings. */
export type OwnCommunityProfile = {
  visibility: CommunityVisibility;
  handle: string;
  play_role: PlayRole;
  games: string[];
  time_zone: string;
  play_times: string;
  discord: string;
  lfg: LookingFor;
  lfg_note: string;
  hidden_by_staff: boolean;
  revision: number;
};

export type CommunityDirectory = {
  profiles: CommunityProfile[];
  total: number;
  offset: number;
  page: number;
  signedIn: boolean;
};

export type CommunityFilters = {
  role?: "" | "dm" | "player";
  lfg?: LookingFor;
  game?: string;
  tz?: string;
  q?: string;
  offset?: number;
};

export const PLAY_ROLE_LABEL: Record<PlayRole, string> = {
  "": "",
  dm: "Dungeon Master",
  player: "Player",
  both: "DM & player",
};
export const LOOKING_FOR_LABEL: Record<LookingFor, string> = {
  "": "",
  players: "Looking for players",
  group: "Looking for a group",
};

/** Suggestions only; members can type any game. */
export const GAME_SUGGESTIONS = [
  "D&D 5e",
  "D&D 2024",
  "Pathfinder 2e",
  "Pathfinder 1e",
  "Starfinder",
  "Call of Cthulhu",
  "OSR",
  "Shadowdark",
  "Daggerheart",
  "Other",
];

export function directoryQuery(filters: CommunityFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && value !== "" && !(key === "offset" && value === 0))
      params.set(key, String(value));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const loadDirectory = (filters: CommunityFilters, signal?: AbortSignal) =>
  accountRequest<CommunityDirectory>(`community/directory${directoryQuery(filters)}`, undefined, signal);
export const loadCommunityProfile = (handle: string, signal?: AbortSignal) =>
  accountRequest<{ profile: CommunityProfile; self: boolean; signedIn: boolean }>(
    `community/profile/${encodeURIComponent(handle)}`,
    undefined,
    signal,
  );
export const loadOwnCommunity = () => accountRequest<OwnCommunityProfile>("community");
export const saveOwnCommunity = (profile: OwnCommunityProfile) =>
  accountRequest<OwnCommunityProfile>("community", profile);
export const reportProfile = (handle: string, reason: string) =>
  accountRequest<{ reported: true }>("community-report", { handle, reason });

/** Every IANA time zone the browser knows, with the visitor's own first. */
export function timeZones(): string[] {
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  return [...new Set([own, ...all].filter(Boolean))];
}

/** "Fri 8:30 PM" style local time in a member's zone, or "" if the zone is unknown. */
export function localTimeIn(zone: string, now = new Date()) {
  if (!zone) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(now);
  } catch {
    return "";
  }
}
