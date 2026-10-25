// The development map-tiles audit runs as two CI steps so each keeps headroom under its 240 s
// bound (one step took 214-240 s on 2026-10-24/25). The parts are disjoint and together are the
// complete audit; unset runs everything (local runs and the packaged Worker step).
export const MAP_TILES_WIDTHS = [1280, 390];
const PARTS = {
  "1/2": { widths: [1280], connected: false },
  "2/2": { widths: [390], connected: true },
};

export function mapTilesPart(value) {
  if (!value) return { part: null, widths: [...MAP_TILES_WIDTHS], connected: true };
  const selected = PARTS[value];
  if (!selected) throw new Error(`MAP_TILES_PART must be ${Object.keys(PARTS).join(" or ")}.`);
  return { part: value, widths: [...selected.widths], connected: selected.connected };
}

/** One `::notice` line with each phase's duration, readable through the check-run annotations API. */
export function phaseNotice(part, phases) {
  const text = phases.map(({ name, ms }) => `${name}: ${(ms / 1000).toFixed(1)}s`).join("\n");
  const escape = (v) => v.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const title = `Map tiles phases${part ? ` part ${part}` : ""}`;
  return `::notice title=${escape(title).replace(/[:,]/g, " ")}::${escape(text)}`;
}
