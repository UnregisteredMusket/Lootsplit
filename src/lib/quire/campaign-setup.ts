// Desk "Set up your campaign" checklist (design D4 / dm #16). Every step is computed from the
// campaign's own data, so it ticks itself as the DM works and never stores progress.
import type { Journal } from "./journal.ts";

export type SetupStep = {
  id: "party" | "place" | "shop" | "map" | "players";
  label: string;
  hint: string;
  href: string;
  action: string;
  done: boolean;
};

export function campaignSetupSteps(input: {
  purses: { kind: string }[];
  shops: unknown[];
  journal: Pick<Journal, "market" | "world">;
  online: boolean;
}): SetupStep[] {
  const places = input.journal.market?.locations?.length ?? 0;
  const maps = input.journal.world?.maps?.length ?? 0;
  return [
    {
      id: "party",
      label: "Add your party",
      hint: "One character per player, with their coins.",
      href: "/party",
      action: "Add characters",
      done: input.purses.some((p) => p.kind === "character"),
    },
    {
      id: "place",
      label: "Add a first place",
      hint: "A town or region where the party starts.",
      href: "/maps",
      action: "Add a place",
      done: places > 0,
    },
    {
      id: "shop",
      label: "Open a shop",
      hint: "Something the party can buy from.",
      href: "/market",
      action: "Add a shop",
      done: input.shops.length > 0,
    },
    {
      id: "map",
      label: "Import a map",
      hint: "Any image works; add a grid later.",
      href: "/maps",
      action: "Import a map",
      done: maps > 0,
    },
    {
      id: "players",
      label: "Invite your players",
      hint: "Host an online room and share its link.",
      href: "/share?tab=room",
      action: "Host a room",
      done: input.online,
    },
  ];
}

/**
 * The checklist belongs to a new campaign: it shows until every step is done or the DM dismisses
 * it, and never once a play session has been completed.
 */
export function showCampaignSetup(
  steps: SetupStep[],
  journal: Pick<Journal, "sessions">,
  dismissed: boolean,
): boolean {
  if (dismissed) return false;
  if (journal.sessions.some((s) => s.endedAt)) return false;
  return steps.some((s) => !s.done);
}

export function setupDismissKey(campaign: string): string {
  return `lootsplit.desk.setup-dismissed.v1.${campaign}`;
}
