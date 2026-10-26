export const featureScreens = {
  economy: { title: "Trade Exchanges", dm: false },
  npcs: { title: "People & NPCs", dm: false },
  trading: { title: "Trading & Barter", dm: false },
  time: { title: "Session Time", dm: true },
  bank: { title: "Bank", dm: false },
  finances: { title: "My Finances", dm: false },
  downtime: { title: "Downtime", dm: false },
  financial: { title: "Financial Settings", dm: true },
  properties: { title: "Property Management", dm: false },
  reports: { title: "Review Reports", dm: true },
  review: { title: "Review Inbox", dm: true },
  journal: { title: "Journal", dm: false },
  /** Owner decision D1: "Quests" for the DM, "Quest log" for players. */
  quests: { title: "Quests", playerTitle: "Quest log", dm: false },
  shops: { title: "Shop Management", dm: true },
  music: { title: "Music & Ambience", dm: true },
};
export type Feature = keyof typeof featureScreens;
/** The title this seat sees (players read "Quest log"). */
export function featureTitle(feature: Feature, dm: boolean): string {
  const screen: { title: string; playerTitle?: string } = featureScreens[feature];
  return !dm && screen.playerTitle ? screen.playerTitle : screen.title;
}
export function safeReturn(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 600 ||
    !value.startsWith("/") ||
    value.includes("\\") ||
    value.startsWith("//")
  )
    return "/?view=home";
  const url = new URL(value, "https://lootsplit.invalid");
  if (url.origin !== "https://lootsplit.invalid") return "/?view=home";
  if (
    !/^\/(?:party|maps|market|share|settings|characters|library|encounters|account|books|catalog|favorites|welcome|features|help|resources|donate|downloads|updates|(?:shop|book|read)\/[^/]+|features\/(?:economy|bank|finances|downtime|financial|properties|reports|review|journal|quests|shops|music|npcs|trading|time))?$/.test(
      url.pathname,
    )
  )
    return "/?view=home";
  url.searchParams.delete("from");
  // A split-view pane belongs to the window layout, not to a return destination.
  url.searchParams.delete("beside");
  return url.pathname + url.search + url.hash;
}

/** Preserve same-page hashes and supply the real origin for feature return links. */
export function appLinkDestination(href: string, currentHref: string, includeOrigin = true) {
  const base = new URL(currentHref, "https://lootsplit.invalid");
  const url = new URL(href, base);
  const feature = url.pathname.split("/")[2] as Feature;
  if (
    includeOrigin &&
    url.pathname.startsWith("/features/") &&
    featureScreens[feature] &&
    !url.searchParams.has("from")
  )
    url.searchParams.set("from", safeReturn(currentHref));
  return url;
}
export function screenName(href: string, dm: boolean) {
  const url = new URL(href, "https://lootsplit.invalid");
  const feature = url.pathname.split("/")[2] as Feature;
  if (url.pathname.startsWith("/features/") && featureScreens[feature])
    return featureTitle(feature, dm);
  if (url.pathname === "/")
    return dm
      ? "Desk"
      : url.searchParams.get("view") === "overview"
        ? "Campaign overview"
        : url.searchParams.get("view") === "sheet"
          ? "Character"
          : "Home";
  return (
    (
      {
        "/maps": "Maps",
        "/party": dm ? "Party" : "Party & inventory",
        "/market": "Market",
        "/share": "Campaign",
        "/settings": "Settings",
        "/characters": "Character",
        "/library": "Library",
        "/encounters": "Encounters",
        "/account": "Account",
        "/books": "Books",
        "/catalog": "Catalog",
        "/favorites": "Favorites",
        "/welcome": "Website",
        "/features": "Features",
        "/help": "Help",
        "/resources": "Resources",
        "/donate": "Donate",
        "/privacy": "Privacy",
        "/community": "Community",
        "/downloads": "Downloads",
        "/updates": "Changelog",
      } as Record<string, string>
    )[url.pathname] ||
    (url.pathname.startsWith("/shop/")
      ? "Shop"
      : url.pathname.startsWith("/book/")
        ? "Book"
        : url.pathname.startsWith("/read/")
          ? "Reading"
          : "Home")
  );
}
