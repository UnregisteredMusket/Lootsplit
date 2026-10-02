export const shortcutDestinations = [
  {
    id: "encounter",
    label: "Resume encounter",
    href: "/encounters?resume=1",
    icon: "swords",
  },
  {
    id: "loot",
    label: "Review loot",
    href: "/encounters?review=1",
    icon: "gift",
  },
  {
    id: "funds",
    label: "Party funds",
    href: "/party?section=funds",
    icon: "coins",
  },
  { id: "market", label: "Open shop", href: "/market", icon: "store" },
  {
    id: "session",
    label: "Session notes",
    href: "/?view=overview#journal",
    icon: "scroll",
  },
  { id: "roll", label: "Roll dice", href: "/characters#dice", icon: "dice" },
  { id: "party", label: "Party sheets", href: "/party", icon: "users" },
  { id: "chat", label: "Party chat", href: "/share?chat=1", icon: "message" },
  { id: "library", label: "Library", href: "/library", icon: "book" },
  { id: "catalog", label: "Catalog", href: "/catalog", icon: "book" },
  {
    id: "backup",
    label: "Device backups",
    href: "/settings#backups",
    icon: "save",
  },
  {
    id: "review",
    label: "Review requests",
    href: "/?view=overview#review",
    icon: "gift",
  },
];
export const defaultShortcuts = shortcutDestinations
  .slice(0, 6)
  .map((x) => ({ destination: x.id, label: x.label, icon: x.icon }));
export const shortcutIcons = [
  "swords",
  "gift",
  "coins",
  "store",
  "scroll",
  "dice",
  "users",
  "message",
  "book",
  "save",
];
/** @param {unknown} raw */
export function normalizeShortcuts(raw) {
  return defaultShortcuts.map((fallback, i) => {
    const x = Array.isArray(raw) ? raw[i] : null;
    const target = shortcutDestinations.find((d) => d.id === x?.destination);
    if (!target) return { ...fallback };
    return {
      destination: target.id,
      label:
        typeof x.label === "string" && x.label.trim() ? x.label.trim().slice(0, 32) : target.label,
      icon: shortcutIcons.includes(x.icon) ? x.icon : target.icon,
    };
  });
}
