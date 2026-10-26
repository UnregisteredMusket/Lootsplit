// Command palette (design D5, Q1, Q12): one search over screens, records and actions.
// Records come from the seat's own projection through the Library index, so a player only finds
// what their screens can already show. Actions only open existing flows; none of them runs a
// command, moves money or changes inventory.
import type { CloudSeat, CloudTable } from "./cloud.ts";
import { featureScreens, featureTitle, type Feature } from "./feature-navigation.ts";
import { libraryRecordHref, libraryRecords, type LibraryRecord } from "./library-records.ts";
import { canReadCharacter } from "./character-position.ts";

export type PaletteGroup = "Actions" | "Screens" | "Records";
export type PaletteEntry = {
  id: string;
  group: PaletteGroup;
  label: string;
  /** A short second line: the record kind, where an action leads, or a shortcut. */
  hint: string;
  href: string;
  /** Extra words that match but are not shown. */
  keywords?: string;
};

const screen = (label: string, href: string, keywords = ""): PaletteEntry => ({
  id: `screen:${href}`,
  group: "Screens",
  label,
  hint: "Screen",
  href,
  keywords,
});

/** Every main destination and feature screen this seat can open. */
export function paletteScreens(dm: boolean): PaletteEntry[] {
  const main = dm
    ? [
        screen("Desk", "/?view=home", "home campaign control dashboard"),
        screen("Encounters", "/encounters", "combat initiative tracker fight"),
        screen("Party", "/party", "characters inventory funds purses"),
        screen("Market", "/market", "shops trade buy sell"),
        screen("Library", "/library", "records catalog references"),
        screen("Maps", "/maps", "map places"),
      ]
    : [
        screen("Home", "/?view=home", "character"),
        screen("Character sheet", "/?view=sheet", "sheet hp stats"),
        screen("Party & inventory", "/party", "inventory funds coins items"),
        screen("Campaign", "/share", "room chat rolls alerts"),
        screen("Market", "/market", "shops trade buy sell"),
        screen("Library", "/library", "records catalog references"),
        screen("Maps", "/maps", "map places"),
      ];
  const features = (Object.keys(featureScreens) as Feature[])
    .filter((feature) => dm || !featureScreens[feature].dm)
    .map((feature) => screen(featureTitle(feature, dm), `/features/${feature}`, feature));
  const more = [
    screen("Multiplayer", "/share?tab=room", "room invite join link online"),
    screen("Messages", "/share?chat=1", "chat"),
    screen("Catalog", dm ? "/catalog?pane=goods" : "/catalog?pane=open5e", "items services"),
    screen("Settings", "/settings", "options preferences theme"),
    screen("Help", "/help", "guide manual how"),
    screen("My account", "/account", "sign in profile"),
  ];
  return [...main, ...features, ...more];
}

/** Actions open the existing screen or form for the job; they never run it. */
export function paletteActions(dm: boolean, sessionActive: boolean): PaletteEntry[] {
  const action = (label: string, hint: string, href: string, keywords = ""): PaletteEntry => ({
    id: `action:${label}`,
    group: "Actions",
    label,
    hint,
    href,
    keywords,
  });
  return dm
    ? [
        action("Award loot", "Loot review in Encounters", "/encounters?review=1", "treasure encounter reward"),
        action("Add loot", "Party → Add loot", "/party?action=add", "item coins give holding"),
        sessionActive
          ? action("End session", "Desk → session controls", "/?view=home#sessions", "end start next session")
          : action("Start session", "Desk → session controls", "/?view=home#sessions", "begin new session"),
        action("Advance 8 h", "Session Time, 8 hours entered", "/features/time?hours=8", "time rest long rest clock advance"),
        action("New quest", "Quests → New quest", "/features/quests?quest=new", "quest objective"),
        action("Review Inbox", "Approve or deny requests", "/features/review", "approve pending requests"),
        action("Split the party", "Party → Split the party", "/party?action=split", "groups"),
        action("Invite players", "Multiplayer → Room", "/share?tab=room", "invite link host"),
      ]
    : [
        action("Request a payment", "Bank", "/features/bank", "pay spend coins"),
        action("Open my character sheet", "Character sheet", "/?view=sheet", "sheet"),
        action("Roll dice", "Character → Dice", "/characters#dice", "roll d20"),
        action("Open quest log", "Quest log", "/features/quests", "quests"),
      ];
}

const recordParts = (record: LibraryRecord) =>
  JSON.parse(record.key.slice("record:".length)) as string[];

/** Where a record opens: its own screen when it has one, else its Library card. */
function recordHref(record: LibraryRecord): string {
  const parts = recordParts(record);
  const [kind, id] = parts;
  if (kind === "character") return `/characters?id=${encodeURIComponent(`party:${id}`)}`;
  if (kind === "npc") return `/features/npcs?npc=${encodeURIComponent(id)}`;
  if (kind === "shop") return `/shop/${encodeURIComponent(id)}`;
  if (kind === "map" || kind === "marker") return `/maps?map=${encodeURIComponent(id)}`;
  return libraryRecordHref(...parts);
}

const RECORD_KINDS = new Set([
  "Location",
  "NPC",
  "Character",
  "Shop",
  "Black market",
  "Property",
  "Map",
  "Map marker",
]);

/**
 * Characters, NPCs, shops, places, maps and items from this seat's projection. The Library index
 * applies the visibility rules (hidden NPCs, closed-off shops, DM-only maps and pins, characters
 * a player may not read); items are limited to purses the seat may read.
 */
export function paletteRecords(
  table: Pick<CloudTable, "journal" | "purses" | "holdings" | "shops">,
  seat: Pick<CloudSeat, "role" | "purseIds">,
): PaletteEntry[] {
  const dm = seat.role === "dm";
  const all = libraryRecords(table, seat).filter((r) => RECORD_KINDS.has(r.kind));
  // An NPC is listed once, as the NPC (its account also appears as a character record).
  const npcIds = new Set(all.filter((r) => r.kind === "NPC").map((r) => recordParts(r)[1]));
  const records = all
    .filter((r) => r.kind !== "Character" || !npcIds.has(recordParts(r)[1]))
    .map(
      (r): PaletteEntry => ({
        id: r.key,
        group: "Records",
        label: r.name,
        hint: r.kind === "Location" ? "Place" : r.kind,
        href: recordHref(r),
        keywords: r.fields.map(([, v]) => v).join(" "),
      }),
    );
  const readable = new Map(
    table.purses
      .filter(
        (p) =>
          dm ||
          seat.purseIds.includes(p.id) ||
          p.kind === "party" ||
          (p.kind === "character" && canReadCharacter(table, p, seat)),
      )
      .map((p) => [p.id, p]),
  );
  const items = new Map<string, PaletteEntry>();
  for (const h of table.holdings) {
    if (h.kind === "property" || h.quantity <= 0) continue;
    // Players: their own purses and the party's; another character's pack stays private.
    const purse = readable.get(h.purseId);
    if (!purse || (!dm && purse.kind === "character" && !seat.purseIds.includes(purse.id)))
      continue;
    const key = `${h.name.toLocaleLowerCase()}|${purse.id}`;
    const known = items.get(key);
    if (known) continue;
    items.set(key, {
      id: `item:${h.id}`,
      group: "Records",
      label: h.name,
      hint: `Item · ${purse.name}`,
      href: "/party?section=funds",
      keywords: "item inventory",
    });
  }
  return [...records, ...items.values()];
}

const normalize = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();

/**
 * Every query word must appear in the label, hint or keywords. Label matches rank first
 * (whole label, then start of the label, then start of a word), then actions, screens, records.
 */
export function searchPalette(entries: PaletteEntry[], query: string, limit = 40): PaletteEntry[] {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const groupRank: Record<PaletteGroup, number> = { Actions: 0, Screens: 1, Records: 2 };
  if (!terms.length)
    return entries.filter((e) => e.group !== "Records").slice(0, limit);
  const scored: { entry: PaletteEntry; score: number }[] = [];
  for (const entry of entries) {
    const label = normalize(entry.label);
    const haystack = `${label} ${normalize(entry.hint)} ${normalize(entry.keywords ?? "")}`;
    if (!terms.every((t) => haystack.includes(t))) continue;
    const phrase = terms.join(" ");
    let score = 0;
    if (label === phrase) score += 100;
    else if (label.startsWith(phrase)) score += 60;
    else if (label.split(/[\s·,/&-]+/).some((w) => w.startsWith(terms[0]))) score += 30;
    else if (label.includes(terms[0])) score += 15;
    score -= groupRank[entry.group] * 2;
    scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label))
    .slice(0, limit)
    .map((s) => s.entry);
}

/** `g` then a letter goes to a main screen (Q12). */
export const GO_SHORTCUTS: Record<string, { href: string; label: (dm: boolean) => string }> = {
  d: { href: "/?view=home", label: (dm) => (dm ? "Desk" : "Home") },
  p: { href: "/party", label: (dm) => (dm ? "Party" : "Party & inventory") },
  m: { href: "/maps", label: () => "Maps" },
  k: { href: "/market", label: () => "Market" },
  l: { href: "/library", label: () => "Library" },
};

/**
 * Single-key shortcuts never fire while typing, with a modifier held, inside a dialog, or on
 * Maps (whose tools own the letter keys and "/").
 */
export function singleKeyShortcutsAllowed(
  target: { closest?: (selector: string) => unknown } | null,
  pathname: string,
  modifiers: { ctrlKey: boolean; metaKey: boolean; altKey: boolean },
): boolean {
  if (modifiers.ctrlKey || modifiers.metaKey || modifiers.altKey) return false;
  if (pathname === "/maps") return false;
  if (
    target?.closest?.(
      'input,textarea,select,[contenteditable=""],[contenteditable="true"],[role="dialog"],[role="alertdialog"],[role="textbox"],[role="combobox"]',
    )
  )
    return false;
  return true;
}
