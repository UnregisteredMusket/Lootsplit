export const featureScreens = {
  bank: { title: "Bank", dm: false },
  finances: { title: "My Finances", dm: false },
  downtime: { title: "Downtime", dm: true },
  financial: { title: "Financial Settings", dm: true },
  properties: { title: "Property Management", dm: false },
  reports: { title: "Review Reports", dm: true },
  review: { title: "Review Inbox", dm: true },
  journal: { title: "Journal", dm: false },
  shops: { title: "Shop Management", dm: true },
  music: { title: "Music & Ambience", dm: true },
};
export type Feature = keyof typeof featureScreens;
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
    !/^\/(?:party|market|share|settings|characters|library|shop\/[^/]+|features\/(?:bank|finances|downtime|financial|properties|reports|review|journal|shops|music))?$/.test(
      url.pathname,
    )
  )
    return "/?view=home";
  url.searchParams.delete("from");
  return url.pathname + url.search + url.hash;
}
export function screenName(href: string, dm: boolean) {
  const url = new URL(href, "https://lootsplit.invalid");
  const feature = url.pathname.split("/")[2] as Feature;
  if (url.pathname.startsWith("/features/") && featureScreens[feature])
    return featureScreens[feature].title;
  if (url.pathname === "/")
    return dm
      ? "Desk"
      : url.searchParams.get("view") === "overview"
        ? "Campaign overview"
        : url.searchParams.get("view") === "sheet"
          ? "Character"
          : dm
            ? "Desk"
            : "Home";
  return (
    (
      {
        "/party": dm ? "Party" : "Inventory",
        "/market": "Market",
        "/share": "Campaign",
        "/settings": "Settings",
        "/characters": "Character",
        "/library": "Library",
      } as Record<string, string>
    )[url.pathname] || "Market"
  );
}
