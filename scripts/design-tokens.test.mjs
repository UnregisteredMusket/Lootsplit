import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  BASELINE,
  arbitraryBreakpoints,
  breakpointTokens,
  collect,
  hexColours,
  regressions,
  typeScale,
} from "./design-tokens.mjs";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const tokens = breakpointTokens(styles);

test("the breakpoint tokens and type scale are the design plan's", () => {
  assert.deepEqual(tokens, {
    phone: 430,
    tablet: 650,
    "tablet-up": 651,
    "wide-down": 1023.98,
    wide: 1024,
    "landscape-height": 500,
  });
  assert.deepEqual(Object.values(typeScale(styles)), [12, 14, 16, 20, 24, 32]);
});

test("hex colours are found outside comments, not in ids or entities", () => {
  assert.deepEqual(hexColours(".a{color:#fff;background:#12345678} /* #abcdef */"), [
    "#fff",
    "#12345678",
  ]);
  assert.deepEqual(hexColours('href="#purse-1" &#123; color: #12345'), []);
});

// Audit I3 (2026-11-10): issue numbers in comments and prose and a fragment link counted as
// colours and failed the ratchet three times in 13 days.
test("in scripts, comments, prose references and link targets are not colours", () => {
  const script = { script: true };
  for (const text of [
    "// Regression for #465",
    "const a = 1; // Regression for #465",
    'const note = "see #456";',
    '<a href="#add">Add</a>',
    "<Link to='#bad' />",
    'navigate({ hash: "#fee" });',
    'text: "Merged #138 · Widget redesign"',
  ])
    assert.deepEqual(hexColours(text, script), [], text);
  // Real colours still count, and the // of a URL does not hide the rest of the line.
  assert.deepEqual(
    hexColours(
      [
        'const box = { background: "#f3ead7", border: "1px solid #ccc" };',
        'const css = ".deed{fill:#795438}";',
        "const shadow = `0 0 4px #000, inset 0 0 0 1px #12345678`;",
        'const src = "https://example.com/a.png"; const ink = "#2b2118";',
        '<div className="bg-[#1d1d22]" style={{ color: "#fff" }} />',
        "const gradient = 'linear-gradient(to right, #abc, #def)';",
      ].join("\n"),
      script,
    ),
    [
      "#f3ead7",
      "#ccc",
      "#795438",
      "#000",
      "#12345678",
      "#2b2118",
      "#1d1d22",
      "#fff",
      "#abc",
      "#def",
    ],
  );
});

test("breakpoints must be a token or a token value", () => {
  const css = `@media (max-width: theme(--bp-phone)) {} @media (min-width: 651px) {}
    @media (max-width: 1023.98px) {} @media (orientation: landscape) and (max-height: 500px) {}
    @media (max-width: 700px) and (min-width: 48rem) {} @media (max-height: 550px) {}`;
  assert.deepEqual(arbitraryBreakpoints(css, tokens), [
    "max-width: 700px",
    "min-width: 48rem",
    "max-height: 550px",
  ]);
});

test("a file may lower its count but never raise it, and new files start at zero", () => {
  const baseline = { hex: { "a.css": 2 }, breakpoints: {} };
  assert.deepEqual(regressions({ hex: { "a.css": 1 }, breakpoints: {} }, baseline), []);
  assert.deepEqual(
    regressions({ hex: { "a.css": 3, "b.tsx": 1 }, breakpoints: { "c.css": 1 } }, baseline).map(
      (r) => `${r.kind}:${r.file}`,
    ),
    ["hex:a.css", "hex:b.tsx", "breakpoints:c.css"],
  );
});

test("no new raw hex colour or arbitrary breakpoint (ratchet against the baseline)", () => {
  const found = regressions(collect(), JSON.parse(readFileSync(BASELINE, "utf8")));
  assert.deepEqual(
    found.map((r) => `${r.file}: ${r.count} ${r.kind} (baseline ${r.allowed})`),
    [],
    "Use a --color-* token (src/lib/quire/theme.ts, @theme in src/styles.css) and the --bp-* " +
      "breakpoints. Only when a raw value is unavoidable, run node scripts/design-tokens.mjs " +
      "--write-baseline and say why in the PR.",
  );
});
