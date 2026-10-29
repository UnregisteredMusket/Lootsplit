import type { MapToken } from "./world-schema.ts";
import { tokenBox, tokenCentre, tokenFootprint } from "./tabletop-geometry.ts";

/** Whether a token is drawn as a footprint disc (characters, creatures and custom tokens). */
export const discToken = (token: Pick<MapToken, "kind">) => token.kind !== "ship";

/** "Large 2×2", "Medium", "Tiny" or "Custom 5×5" for labels and the inspector. */
export function tokenSizeText(token: Pick<MapToken, "sizeClass" | "footprint">) {
  const n = tokenFootprint(token);
  const name = token.footprint
    ? "Custom"
    : token.sizeClass
      ? token.sizeClass[0].toUpperCase() + token.sizeClass.slice(1)
      : "Medium";
  return n > 1 ? `${name} ${n}×${n}` : name;
}

/**
 * The token with a new size or custom squares (the inspector and the token menu): wider tokens
 * are stored by their top-left square, kept on the square the token's footprint starts on and
 * inside the grid; Tiny takes the top-left quadrant of its square. Nothing is saved here.
 */
export function resizedToken(
  token: MapToken,
  next: { sizeClass?: MapToken["sizeClass"]; footprint?: MapToken["footprint"] },
  grid: { columns: number; rows: number },
): MapToken {
  const box = tokenBox(token),
    result: MapToken = { ...token };
  delete result.sizeClass;
  delete result.footprint;
  delete result.anchor;
  delete result.offsetX;
  delete result.offsetY;
  if (next.sizeClass) result.sizeClass = next.sizeClass;
  if (next.footprint !== undefined) result.footprint = next.footprint;
  const n = tokenFootprint(result);
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
  if (n < 1) {
    const centre = tokenCentre(token);
    return {
      ...result,
      column: clamp(Math.floor(centre.x), grid.columns - 1),
      row: clamp(Math.floor(centre.y), grid.rows - 1),
      offsetX: -0.25,
      offsetY: -0.25,
    };
  }
  if (n > 1 || next.sizeClass || next.footprint !== undefined) result.anchor = "corner";
  return {
    ...result,
    column: clamp(Math.floor(box.left + 1e-9), grid.columns - n),
    row: clamp(Math.floor(box.top + 1e-9), grid.rows - n),
  };
}
