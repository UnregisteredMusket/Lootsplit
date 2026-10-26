/**
 * Map toolbars (docs/MAP-TILES.md, "Map controls"): layout by viewport, roving keyboard focus and
 * the per-device "Show tool names" preference.
 */

/** desktop: vertical rails; short: desktop under 720 px tall (the rail's lower groups fold into
 * More); phone: today's bottom hotbar (650 px wide or less); landscape: side rails (550 px tall
 * or less, landscape). */
export type MapLayout = "desktop" | "short" | "phone" | "landscape";
export function mapLayout(width: number, height: number): MapLayout {
  if (height <= 550 && width > height) return "landscape";
  if (width <= 650) return "phone";
  return height < 720 ? "short" : "desktop";
}
export const isRailLayout = (layout: MapLayout) => layout !== "phone";

/** Arrow keys move along a toolbar (Up/Down when vertical, Left/Right when horizontal), Home/End
 * jump to the ends; anything else leaves focus where it is (returns undefined). */
export function nextRovingIndex(
  count: number,
  current: number,
  key: string,
  orientation: "vertical" | "horizontal",
): number | undefined {
  if (count <= 0) return undefined;
  const [back, forward] =
    orientation === "vertical" ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === forward) return (Math.max(0, current) + 1) % count;
  if (key === back) return (Math.max(0, current) - 1 + count) % count;
  return undefined;
}

/** "Show tool names": shown at first use until dismissed (D5). Stored per device only. */
export type ToolNames = "first-use" | "shown" | "hidden";
export const TOOL_NAMES_KEY = "lootsplit.map.toolNames.v1";
export function readToolNames(raw: string | null | undefined): ToolNames {
  return raw === "shown" || raw === "hidden" ? raw : "first-use";
}
export const toolNamesVisible = (value: ToolNames) => value !== "hidden";
