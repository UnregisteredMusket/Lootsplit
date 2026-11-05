/**
 * "What players can see" (owner-approved 2026-11-05; docs/FEATURE-INVENTORY.md): one DM page that
 * gathers every player-visibility setting and counts every kind of record currently hidden from
 * players. Read-only over the DM's own table, computed on the device, never stored or sent.
 *
 * - Simple switches are built here once and used by both their original control and this page,
 *   so the page sends exactly the existing command with the same `before` check. No new command.
 * - Per-record visibility (fog, hidden NPCs, DM-only pins…) is a count and a link to where it is
 *   edited. Every original control stays where it was.
 * - Counts exist only on the DM's page (the route is DM-only); nothing here reaches a projection.
 */
import type { CloudTable } from "./cloud.ts";
import type { CommandInput } from "./commands.ts";
import type { Journal } from "./journal.ts";
import { characterPosition } from "./character-position.ts";
import { markupDisplay } from "./market-markup.ts";
import { hasMerchantPurse } from "./merchant.ts";
import { isUnidentified } from "./item-identity.ts";
import { readQuests } from "./quests-schema.ts";
import { referencePolicy, type ReferencePolicy } from "./reference-access.ts";
import { tabletopSessionSchema } from "./tabletop-schema.ts";
import { readWorld } from "./world-schema.ts";

type JournalLike = Pick<Journal, "world" | "blackMarketMarkup" | "referenceAccess"> | undefined;

/* ---- The existing commands, built once (shared with the original controls) ---- */

/** Market › Black market: "Reveal black market" / "Hide black market". */
export function blackMarketCommand(journal: JournalLike): CommandInput {
  const active = readWorld(journal?.world).blackMarketActive;
  return { kind: "black-market", before: active, active: !active };
}

/** Settings › Economic rules › Black-market markup: descriptions ⇄ percentages. */
export function markupDisplayCommand(journal: JournalLike): CommandInput {
  const display = markupDisplay(journal);
  return {
    kind: "black-market-markup",
    before: display,
    display: display === "percentages" ? "descriptions" : "percentages",
  };
}

/** People & NPCs › Party companion funds. */
export function companionFundsCommand(journal: JournalLike): CommandInput {
  const world = readWorld(journal?.world);
  return {
    kind: "companion-funds-visibility",
    before: world.companionFundsVisible ?? false,
    visible: !world.companionFundsVisible,
  };
}

export type SessionSwitch = "followView" | "playerBrowsing" | "tvEnabled";
/** The map session's switches as stored, with schema defaults. */
export const readSession = (journal: JournalLike) =>
  tabletopSessionSchema.parse(journal?.world?.tabletop ?? {});
/**
 * Maps: "Character tokens follow players' map view" (Settings › Players & display), "Restrict
 * browsing to active scene" and "Enable optional TV / player display" (map session bar).
 */
export function sessionSwitchCommand(journal: JournalLike, key: SessionSwitch): CommandInput {
  const session = readSession(journal);
  return {
    kind: "tabletop-session",
    before: journal?.world?.tabletop ?? null,
    session: { ...session, [key]: !session[key] },
  };
}

/** Library / Settings › Players & permissions › Player reference lookup. */
export function referencePolicyCommand(
  journal: JournalLike,
  change: Partial<ReferencePolicy>,
): CommandInput {
  const policy = referencePolicy(journal?.referenceAccess);
  return { kind: "reference-policy", before: policy, policy: { ...policy, ...change } };
}

/* ---- The page's list ---- */

export type VisibilitySwitch = {
  id: string;
  label: string;
  /** The current state in words ("Hidden", "On"). */
  state: string;
  on: boolean;
  /** What the button does. */
  action: string;
  /** The existing command; absent when the switch can't be changed right now (see `note`). */
  command?: CommandInput;
  note?: string;
  /** Where the original control lives. */
  href: string;
  where: string;
};
export type VisibilityCount = {
  id: string;
  label: string;
  count: number;
  /** Where these records are edited. */
  href: string;
  where: string;
  note?: string;
};
export type VisibilityArea = {
  id: string;
  title: string;
  switches: VisibilitySwitch[];
  counts: VisibilityCount[];
  /** Rules with no switch or count (derived visibility), described with a link. */
  rules: { label: string; href: string; where: string }[];
};
export type VisibilityTable = Pick<CloudTable, "journal" | "purses" | "holdings" | "shops">;

const onOff = (on: boolean) => (on ? "On" : "Off");

/** Every visibility setting and hidden-record count, grouped by area (DM's full table only). */
export function visibilityCenter(table: VisibilityTable): VisibilityArea[] {
  const journal = table.journal;
  const world = readWorld(journal?.world);
  const session = readSession(journal);
  const exchanges = journal?.tradeEconomy?.exchanges ?? [];
  const treasuries = new Set(exchanges.map((e) => e.purseId));
  const characters = table.purses.filter((p) => p.kind === "character" && !treasuries.has(p.id));
  const npcIds = new Set(world.npcs.map((n) => n.id));
  const positions = new Map(characters.map((p) => [p.id, characterPosition(table, p)]));
  const policy = referencePolicy(journal?.referenceAccess);
  const quests = readQuests(journal?.quests).quests.filter((q) => !q.archived);
  const maps = world.maps;
  const tabletops = maps.map((m) => m.tabletop);
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const markup = markupDisplay(journal);

  return [
    {
      id: "people",
      title: "People & characters",
      switches: [
        {
          id: "companion-funds",
          label: "Party can see companion NPC funds",
          state: onOff(!!world.companionFundsVisible),
          on: !!world.companionFundsVisible,
          action: world.companionFundsVisible
            ? "Keep companion funds private"
            : "Show companion funds to the party",
          command: companionFundsCommand(journal),
          href: "/features/npcs",
          where: "People & NPCs › Party companion funds",
        },
      ],
      counts: [
        {
          id: "hidden-characters",
          label: "Player characters hidden from players",
          count: characters.filter(
            (p) => p.control !== "npc" && !npcIds.has(p.id) && positions.get(p.id)?.visible === false,
          ).length,
          href: "/party?section=characters",
          where: "Party › Character locations › Visible to players",
        },
        {
          id: "hidden-npcs",
          label: "Hidden NPCs",
          count: world.npcs.filter((n) => !n.visible || positions.get(n.id)?.visible === false)
            .length,
          href: "/features/npcs",
          where: "People & NPCs › each NPC › Visible to players",
        },
        {
          id: "private-npc-sheets",
          label: "NPC sheets players can't open",
          count: characters.filter(
            (p) => p.control === "npc" && positions.get(p.id)?.sheetVisible === false,
          ).length,
          href: "/party?section=characters",
          where: "Party › Character locations › NPC sheet visible to players",
        },
        {
          id: "hidden-groups",
          label: "Hidden party groups",
          count: (world.groups ?? []).filter((g) => g.status === "active" && g.hidden).length,
          href: "/party?action=split",
          where: "Party › Split the party › Hide from other players",
          note: "Players with no character in the group see it as Elsewhere.",
        },
      ],
      rules: [],
    },
    {
      id: "market",
      title: "Shops & market",
      switches: [
        {
          id: "black-market",
          label: "Black market",
          state: world.blackMarketActive ? "Available" : "Hidden",
          on: world.blackMarketActive,
          action: world.blackMarketActive ? "Hide black market" : "Reveal black market",
          command: blackMarketCommand(journal),
          href: "/market",
          where: "Market › Black market",
        },
        {
          id: "black-market-markup",
          label: "Black-market markup players see",
          state: markup === "percentages" ? "Percentages" : "Descriptions",
          on: markup === "percentages",
          action:
            markup === "percentages" ? "Show descriptions to players" : "Show percentages to players",
          command: markupDisplayCommand(journal),
          href: "/features/financial#black-market-markup",
          where: "Settings › Economic rules › Black-market markup",
        },
      ],
      counts: [
        {
          id: "black-market-vendors",
          label: world.blackMarketActive
            ? "Black-market vendors (shown while the black market is available)"
            : "Black-market vendors hidden with the black market",
          count: table.shops.filter((s) => s.blackMarket).length,
          href: "/market",
          where: "Market › each shop › Black-market vendor",
        },
        {
          id: "hidden-merchant-purses",
          label: "Shop purses kept from players",
          count: table.shops.filter((s) => hasMerchantPurse(s) && !s.showPurse).length,
          href: "/market",
          where: "Market › each shop › Show the shop's purse to players",
        },
        {
          id: "hidden-exchanges",
          label: "Trade exchanges hidden from players",
          count: exchanges.filter((e) => !e.visible).length,
          href: "/features/economy",
          where: "Trade Exchanges › each exchange › Visible to players",
        },
      ],
      rules: [
        {
          label:
            "Places: players see the party's current place, the places above it and places they own or have a shop, NPC or map at. There is no per-place switch.",
          href: "/market",
          where: "Market › Places",
        },
      ],
    },
    {
      id: "maps",
      title: "Maps & tabletop",
      switches: [
        {
          id: "follow-view",
          label: "Character tokens follow players' map view",
          state: onOff(!!session.followView),
          on: !!session.followView,
          action: session.followView ? "Turn off token follow" : "Turn on token follow",
          command: sessionSwitchCommand(journal, "followView"),
          href: "/maps",
          where: "Maps › Settings › Players & display",
        },
        {
          id: "player-browsing",
          label: "Players may browse other shared maps during an active scene",
          state: onOff(session.playerBrowsing),
          on: session.playerBrowsing,
          action: session.playerBrowsing
            ? "Restrict browsing to active scene"
            : "Allow shared-scene browsing",
          ...(session.activeMapId
            ? { command: sessionSwitchCommand(journal, "playerBrowsing") }
            : { note: "Applies while a scene is active. Activate a scene on Maps first." }),
          href: "/maps",
          where: "Maps › session bar",
        },
        {
          id: "tv-display",
          label: "Optional TV / player display",
          state: onOff(session.tvEnabled),
          on: session.tvEnabled,
          action: session.tvEnabled
            ? "Disable TV / player display"
            : "Enable optional TV / player display",
          command: sessionSwitchCommand(journal, "tvEnabled"),
          href: "/maps",
          where: "Maps › session bar",
        },
      ],
      counts: [
        {
          id: "private-maps",
          label: "Maps kept private (DM preparation)",
          count: maps.filter((m) => !m.visible).length,
          href: "/maps",
          where: "Maps › map editor › Share with players",
        },
        {
          id: "fogged-maps",
          label: "Maps with fog of war on",
          count: tabletops.filter((t) => t?.fog?.enabled).length,
          href: "/maps",
          where: "Maps › Fog tools",
        },
        {
          id: "dm-markers",
          label: "DM-only map markers",
          count: sum(maps.map((m) => m.markers.filter((k) => k.visibility === "dm").length)),
          href: "/maps",
          where: "Maps › marker › Visibility",
        },
        {
          id: "dm-tokens",
          label: "DM-only map tokens",
          count: sum(maps.map((m) => (m.tokens ?? []).filter((k) => k.visibility === "dm").length)),
          href: "/maps",
          where: "Maps › token › Visibility",
        },
        {
          id: "dm-pins",
          label: "DM-only place pins and scene links",
          count: sum(
            maps.map(
              (m) =>
                (m.connected?.placements ?? []).filter((p) => p.visibility === "dm").length +
                (m.connected?.links ?? []).filter((l) => l.visibility === "dm").length,
            ),
          ),
          href: "/maps",
          where: "Maps › Place hub › pin › Visibility",
        },
        {
          id: "portrait-pins",
          label: "Portrait pins (players see the portrait on shared pins)",
          count: sum(
            maps.map(
              (m) => (m.connected?.placements ?? []).filter((p) => p.style === "portrait").length,
            ),
          ),
          href: "/maps",
          where: "Maps › Place hub › pin › Portrait",
        },
        {
          id: "dm-templates",
          label: "DM-only area templates",
          count: sum(
            tabletops.map((t) => (t?.templates ?? []).filter((k) => k.visibility === "dm").length),
          ),
          href: "/maps",
          where: "Maps › Templates",
        },
      ],
      rules: [
        {
          label:
            "Walls, doors and lights are never sent to players; zones reach a player only through maps they can see.",
          href: "/maps",
          where: "Maps",
        },
      ],
    },
    {
      id: "quests",
      title: "Quests & journal",
      switches: [],
      counts: [
        {
          id: "quest-drafts",
          label: "Quests not revealed yet",
          count: quests.filter((q) => q.audience.kind === "none").length,
          href: "/features/quests",
          where: "Quests › Reveal",
        },
        {
          id: "hidden-objectives",
          label: "Hidden objectives in revealed quests",
          count: sum(
            quests
              .filter((q) => q.audience.kind !== "none")
              .map((q) => q.objectives.filter((o) => o.hidden).length),
          ),
          href: "/features/quests",
          where: "Quests › objective › Reveal",
        },
        {
          id: "dm-quest-lines",
          label: "DM-only quest chronicle lines",
          count: sum(quests.map((q) => q.log.filter((l) => !l.shared).length)),
          href: "/features/quests",
          where: "Quests › Chronicle",
        },
        {
          id: "dm-journal",
          label: "DM-only journal entries",
          count: (journal?.entries ?? []).filter((e) => e.visibility === "dm").length,
          href: "/features/journal",
          where: "Journal › entry › Visibility",
        },
      ],
      rules: [],
    },
    {
      id: "items",
      title: "Items",
      switches: [],
      counts: [
        {
          id: "unidentified",
          label: "Unidentified items (players see the presented name)",
          count: table.holdings.filter((h) => h.quantity > 0 && isUnidentified(h)).length,
          href: "/party?section=funds",
          where: "Party › Funds & inventory › item › Identify",
        },
      ],
      rules: [],
    },
    {
      id: "reference",
      title: "Reference lookup",
      switches: [
        {
          id: "reference-enabled",
          label: "Player reference lookup",
          state: policy.enabled ? "Allowed" : "Off",
          on: policy.enabled,
          action: policy.enabled ? "Turn off player lookup" : "Allow player lookup",
          command: referencePolicyCommand(journal, { enabled: !policy.enabled }),
          href: "/library",
          where: "Library › Player reference lookup",
        },
        {
          id: "reference-encounters",
          label: "Reference lookup during active encounters",
          state: policy.allowDuringEncounters ? "Allowed" : "Paused",
          on: policy.allowDuringEncounters,
          action: policy.allowDuringEncounters
            ? "Pause lookup during encounters"
            : "Allow lookup during encounters",
          command: referencePolicyCommand(journal, {
            allowDuringEncounters: !policy.allowDuringEncounters,
          }),
          href: "/library",
          where: "Library › Player reference lookup",
        },
      ],
      counts: [],
      rules: [
        {
          label: `Sections players may search: ${policy.sections.length ? policy.sections.join(", ") : "none"}.`,
          href: "/library",
          where: "Library › Player reference lookup",
        },
      ],
    },
  ];
}

/** Player characters the DM can preview as (the same list as Party › Preview as player). */
export function previewCharacters(table: Pick<CloudTable, "purses">) {
  return table.purses
    .filter((p) => p.kind === "character" && p.control !== "npc")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name }));
}
