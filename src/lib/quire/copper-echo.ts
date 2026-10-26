import { formatCopper } from "./money.ts";

/**
 * The live gold echo under a copper input (design plan D8): "25000" → "= 250 gp". Zero, empty,
 * partial or invalid text has no echo, so the field never shows a misleading amount.
 */
export function copperEcho(value: string | number): string {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return "";
  const copper = Number(text);
  return Number.isSafeInteger(copper) && copper > 0 ? `= ${formatCopper(copper)}` : "";
}
