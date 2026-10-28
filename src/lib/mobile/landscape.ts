/**
 * Phone landscape (design M2): below 500 px tall the bottom tab bar becomes a 56 px icon rail on
 * the left, and the header slides away while scrolling down (it returns on any upward scroll,
 * near the top, or when focus enters it). The map has its own rails and keeps its layout.
 */
export const LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 500px)";

/** Scroll distance (px) that counts as a direction change; smaller jitter keeps the state. */
const SLACK = 8;

/** Whether the header is hidden after a scroll from `lastY` to `y`. */
export function headerHiddenAfterScroll(
  state: { hidden: boolean; lastY: number; header: number },
  y: number,
): boolean {
  if (y <= state.header) return false;
  if (y > state.lastY + SLACK) return true;
  if (y < state.lastY - SLACK) return false;
  return state.hidden;
}
