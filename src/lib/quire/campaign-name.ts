/**
 * Shared campaign names (plan P2, Q17). The DM's campaign name travels with the room so players
 * see "The Wayfarers" instead of the device default. Pure helpers, used by the server, the Worker
 * (account library) and the client.
 */

export const CAMPAIGN_NAME_LIMIT = 60;

/** Names a device gives a campaign nobody named; they never travel to players. */
const DEFAULT_NAMES = new Set(["party overview", "campaign", "new campaign", "dungeon master"]);

export function isDefaultCampaignName(name: string | undefined | null): boolean {
  const clean = (name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  // The display fallback ("Shared campaign · CODE") is never a name either, even if a library
  // entry or device campaign was saved with it.
  return !clean || DEFAULT_NAMES.has(clean) || /^shared campaign( · [a-z0-9]+)?$/.test(clean);
}

/** The name stored on a room: trimmed, at most 60 characters, never a device default. */
export function roomCampaignName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = Array.from(value, (c) => (c.charCodeAt(0) < 32 || c === "\u007f" ? " " : c))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CAMPAIGN_NAME_LIMIT)
    .trim();
  return clean && !isDefaultCampaignName(clean) ? clean : undefined;
}

/** The fallback for a shared campaign the DM has not named. */
export function sharedCampaignFallback(code: string | undefined): string {
  return code ? `Shared campaign · ${code}` : "Shared campaign";
}

/**
 * The name the header, membership card and tab title show.
 * - Not in a shared room: the device campaign's own name, unchanged.
 * - A player in a shared room: the DM's name for it; an account library name the player chose;
 *   otherwise "Shared campaign · CODE".
 * - The DM in a shared room: their device name, or the fallback when it is a device default.
 */
export function campaignDisplayName(input: {
  deviceName: string | undefined;
  joined: boolean;
  role: "dm" | "player";
  code?: string;
  roomName?: string;
  /** Player seats resumed from an account library keep the name chosen there. */
  libraryName?: string;
}): string {
  const deviceName = input.deviceName?.trim() || "Campaign";
  if (!input.joined || !input.code) return deviceName;
  const roomName = roomCampaignName(input.roomName);
  if (input.role === "player") {
    if (roomName) return roomName;
    const library = roomCampaignName(input.libraryName);
    return library ?? sharedCampaignFallback(input.code);
  }
  return isDefaultCampaignName(deviceName) ? (roomName ?? sharedCampaignFallback(input.code)) : deviceName;
}

/** "Mira · The Wayfarers" for a player with a character; the campaign alone otherwise. */
export function campaignTabTitle(campaign: string, character?: string): string {
  return character ? `${character} · ${campaign}` : `${campaign} · Lootsplitter`;
}

/**
 * The membership card title on My account (its eyebrow already shows the code): the name chosen
 * in the account library, unless it is a device default ("Campaign", "Party overview"), then the
 * DM's name, then "Unnamed campaign".
 */
export function membershipDisplayName(member: { name: string; campaignName?: string }): string {
  return roomCampaignName(member.name) ?? roomCampaignName(member.campaignName) ?? "Unnamed campaign";
}
