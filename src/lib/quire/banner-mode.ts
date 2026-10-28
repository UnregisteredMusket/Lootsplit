/**
 * Scenery banner height (design plan dm-mobile #19): the full banner greets a screen's first
 * visit on this device; afterwards, and always in a split pane, a compact 64–96 px band keeps
 * the primary actions in the first screen. Phone landscape is compact in CSS. Device-only
 * presentation memory, never campaign data.
 */
export type BannerMode = "full" | "compact";

export const BANNER_SEEN_PREFIX = "quire.banner.seen.v1:";

/** One remembered key per screen; shop and book pages share one key per kind. */
export function bannerKey(pathname: string): string {
  const path = pathname.startsWith("/shop/")
    ? "/shop"
    : pathname.startsWith("/book/")
      ? "/book"
      : pathname.replace(/\/+$/, "") || "/";
  return BANNER_SEEN_PREFIX + path;
}

export function bannerMode({
  seenBefore,
  splitPane,
}: {
  seenBefore: boolean;
  splitPane: boolean;
}): BannerMode {
  return seenBefore || splitPane ? "compact" : "full";
}
