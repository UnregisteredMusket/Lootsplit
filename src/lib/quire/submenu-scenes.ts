/** Decorative scenery only; campaign/location uploads always remain separate. */
export function submenuScene(pathname: string): string | undefined {
  if (pathname.startsWith("/shop/")) return "market-street";
  if (pathname.startsWith("/book/")) return "ancient-library";
  const scenes: Record<string, string> = {
    "/market": "market-street",
    "/catalog": "blacksmith",
    "/encounters": "dungeon-corridor",
    "/characters": "tavern",
    "/party": "tavern",
    "/share": "village-square",
    "/books": "ancient-library",
    "/library": "ancient-library",
    "/settings": "mage-tower-study",
    "/features/bank": "throne-room",
    "/features/finances": "throne-room",
    "/features/financial": "throne-room",
    "/features/reports": "ancient-library",
    "/features/review": "mage-tower-study",
    "/features/journal": "ancient-library",
    "/features/downtime": "tavern",
    "/features/properties": "village-square",
    "/features/economy": "market-street",
    "/features/shops": "market-street",
  };
  return scenes[pathname];
}
