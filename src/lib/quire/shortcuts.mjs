export const shortcutDestinations = [
  ...[["bank","Bank","coins"],["finances","My Finances","coins"],["properties","Properties","store"],["downtime","Downtime","scroll"],["financial","Financial Settings","coins"],["reports","Review Reports","book"],["review","Review Inbox","gift"],["journal","Journal","scroll"],["shops","Shop Management","store"]].map(([id,label,icon])=>({id,label,icon,href:`/features/${id}`})),
  {id:"character",label:"Character Sheet",href:"/?view=sheet",icon:"users"},
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
    href: "/features/journal",
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

];
export const defaultShortcuts = shortcutDestinations
  .filter(x=>["encounter","loot","funds","market","session","roll"].includes(x.id))
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
export function destinationsFor(role = "dm") {
  return shortcutDestinations.filter(x=>role === "dm" || !["encounter","loot","funds","downtime","financial","reports","review","shops","backup"].includes(x.id));
}
/** @param {unknown} raw */
export function normalizeShortcuts(raw, role = "dm") {
  const available = destinationsFor(role);
  const defaults = role === "player" ? ["character","bank","finances","properties","journal","chat"].map(id=>{const x=available.find(x=>x.id===id);return {destination:id,label:x?.label || id,icon:x?.icon || "book"};}) : defaultShortcuts;
  return defaults.map((fallback, i) => {
    const x = Array.isArray(raw) ? raw[i] : null;
    const target = available.find((d) => d.id === x?.destination);
    if (!target) return { ...fallback };
    return {
      destination: target.id,
      label:
        typeof x.label === "string" && x.label.trim() ? x.label.trim().slice(0, 32) : target.label,
      icon: shortcutIcons.includes(x.icon) ? x.icon : target.icon,
    };
  });
}
