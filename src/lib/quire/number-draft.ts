/**
 * Parse the text of a numeric input. Returns null while the text is not yet a number
 * (empty, "-", or a browser-reported bad input) so the field can keep what the user typed.
 */
export function parseNumberDraft(text: string): number | null {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
