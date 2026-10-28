// Design tokens ratchet (design plan, dm-mobile "Systemic issues"): colours come from tokens and
// breakpoints from the four breakpoint tokens. Existing violations are recorded per file in
// scripts/design-tokens-baseline.json; a file may only lower its count, and new files start at 0.
//
//   node scripts/design-tokens.mjs                   report, exit 1 on a new violation
//   node scripts/design-tokens.mjs --write-baseline  record the current counts (after removing
//                                                    violations, or with a reason in the PR)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
export const BASELINE = join(root, "scripts/design-tokens-baseline.json");

/** Where raw colours are allowed: the theme token sources. */
const COLOUR_SOURCES = new Set(["src/lib/quire/theme.ts"]);
const SKIP = /(\.test\.tsx?$|\.gen\.ts$|^src\/lib\/quire\/test-fixtures\/)/;

/** `--bp-*` tokens from the `@theme` block of src/styles.css, in px. */
export function breakpointTokens(css) {
  const theme = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  return Object.fromEntries(
    [...theme.matchAll(/--bp-([a-z-]+):\s*([\d.]+)px;/g)].map((m) => [m[1], Number(m[2])]),
  );
}

/** `--text-*` type scale tokens from the `@theme` block, in px (1rem = 16px). */
export function typeScale(css) {
  const theme = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  return Object.fromEntries(
    [...theme.matchAll(/--text-([a-z]+):\s*([\d.]+)rem;/g)].map((m) => [m[1], Number(m[2]) * 16]),
  );
}

/** Raw hex colours (#rgb, #rgba, #rrggbb, #rrggbbaa) outside comments. */
export function hexColours(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "");
  return [
    ...code.matchAll(/(?<![\w&$/-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi),
  ].map((m) => m[0]);
}

/**
 * Width/height conditions in `@media` rules that are neither a `theme(--bp-*)` token nor one of
 * the token values (component CSS files cannot use `theme()`, so they may repeat the value).
 */
export function arbitraryBreakpoints(css, tokens) {
  const widths = new Set(),
    heights = new Set();
  for (const [name, px] of Object.entries(tokens)) {
    (name.includes("height") ? heights : widths).add(px);
  }
  // Inclusive/exclusive pairs: max-width: 650px pairs with min-width: 651px, and so on.
  for (const px of [...widths])
    widths
      .add(px + 1)
      .add(px - 1)
      .add(px - 0.02);
  const out = [];
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const media of code.matchAll(/@media([^{]*)\{/g)) {
    for (const m of media[1].matchAll(
      /\((min|max)-(width|height)\s*:\s*(theme\([^)]*\)|[^)]+)\)/g,
    )) {
      const value = m[3].trim();
      if (/^theme\(--bp-[a-z-]+\)$/.test(value)) continue;
      const px = /^([\d.]+)px$/.exec(value);
      const allowed = m[2] === "width" ? widths : heights;
      if (px && allowed.has(Number(px[1]))) continue;
      out.push(`${m[1]}-${m[2]}: ${value}`);
    }
  }
  return out;
}

function files(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory()) return files(path);
    return /\.(css|tsx?)$/.test(e.name) && !SKIP.test(path) ? [path] : [];
  });
}

/** Current counts per file: `{ hex: {file: n}, breakpoints: {file: n} }`. */
export function collect() {
  const tokens = breakpointTokens(readFileSync(join(root, "src/styles.css"), "utf8"));
  const hex = {},
    breakpoints = {};
  for (const file of files("src").sort()) {
    const text = readFileSync(join(root, file), "utf8");
    const colours = COLOUR_SOURCES.has(file) ? [] : hexColours(text);
    if (colours.length) hex[file] = colours.length;
    if (file.endsWith(".css")) {
      const found = arbitraryBreakpoints(text, tokens);
      if (found.length) breakpoints[file] = found.length;
    }
  }
  return { hex, breakpoints };
}

/** Files whose count rose above the baseline (new files have a baseline of 0). */
export function regressions(current, baseline) {
  const out = [];
  for (const kind of ["hex", "breakpoints"]) {
    for (const [file, count] of Object.entries(current[kind])) {
      const allowed = baseline[kind]?.[file] ?? 0;
      if (count > allowed) out.push({ kind, file, count, allowed });
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const current = collect();
  if (process.argv.includes("--write-baseline")) {
    writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
    console.log(`Wrote ${relative(root, BASELINE)}.`);
  } else {
    const found = regressions(current, JSON.parse(readFileSync(BASELINE, "utf8")));
    for (const r of found)
      console.error(
        `${r.file}: ${r.count} ${r.kind === "hex" ? "raw hex colours" : "arbitrary breakpoints"} (baseline ${r.allowed})`,
      );
    process.exitCode = found.length ? 1 : 0;
  }
}
