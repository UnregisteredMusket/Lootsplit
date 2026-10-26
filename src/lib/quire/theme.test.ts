import assert from "node:assert/strict";
import test from "node:test";
import { luminance, themeVars } from "./theme.ts";

test("dark glass keeps cream ink and the chosen ground", () => {
  const vars = themeVars("dark", "#e0a04a", "#10182c");
  assert.equal(vars["--color-bg"], "#10182c");
  assert.equal(vars["--color-fg"], "#f6f1e6");
  assert.equal(vars["--color-accent"], "#e0a04a");
  assert.equal(vars["--color-lead"], "#e0a04a");
});

test("a light page uses dark ink", () => {
  const vars = themeVars("light", "#8d2436", "#f6f1e6");
  assert.equal(vars["--color-fg"], "#1c1422");
  assert.ok(luminance(vars["--color-bg"] ?? "#000") > luminance(vars["--color-fg"] ?? "#fff"));
});

test("gold accent text remains readable on a light page without losing the chosen accent", () => {
  const vars = themeVars("light", "#c8a96b", "#f6f1e6");
  assert.equal(vars["--color-accent"], "#c8a96b");
  const a = luminance(vars["--color-lead"]!);
  for (const key of ["--color-bg", "--color-elevated"]) {
    const b = luminance(vars[key]!);
    assert.ok((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05) >= 4.5);
  }
});

// Both approved palettes must keep ordinary and secondary copy readable on app surfaces.
test("fantasy modes keep text contrast and preserve legacy/custom choices", async () => {
  const { FANTASY_LOOKS, fantasyLook } = await import("./theme.ts");
  for (const look of Object.values(FANTASY_LOOKS)) {
    assert.equal(fantasyLook(look.appearance, look.accent, look.ground)?.id, look.id);
    const vars = themeVars(look.appearance, look.accent, look.ground);
    for (const ink of ["--color-fg", "--color-muted", "--color-faint", "--color-lead"]) {
      for (const surface of ["--color-bg", "--color-elevated", "--color-subtle"]) {
        const a = luminance(vars[ink]!); const b = luminance(vars[surface]!);
        assert.ok((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05) >= 4.5, `${look.id}: ${ink} on ${surface}`);
      }
    }
  }
  assert.equal(fantasyLook("dark", "#c8a96b", "#0b1720"), undefined);
  assert.equal(fantasyLook("light", "#123456", "#f6f1e6"), undefined);
});

// Status text (`text-positive`, `text-negative`) on Market, shops and ledgers: every built-in look
// and a spread of custom accents/grounds must read at 4.5:1 on each app surface (axe color-contrast).
test("positive and negative text tokens pass 4.5:1 in every theme", async () => {
  const { LOOKS } = await import("./theme.ts");
  const ratio = (x: string, y: string) => {
    const a = luminance(x), b = luminance(y);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const custom = [
    { appearance: "dark" as const, accent: "#c8a96b", ground: "#0b1720" },
    { appearance: "dark" as const, accent: "#ff4040", ground: "#3a3a3a" },
    { appearance: "light" as const, accent: "#123456", ground: "#ffffff" },
    { appearance: "light" as const, accent: "#c8a96b", ground: "#d8d0c0" },
  ];
  for (const look of [...LOOKS, ...custom]) {
    const vars = themeVars(look.appearance, look.accent, look.ground);
    for (const ink of ["--color-positive", "--color-negative", "--color-lead"])
      for (const surface of ["--color-bg", "--color-elevated", "--color-subtle"])
        assert.ok(
          ratio(vars[ink]!, vars[surface]!) >= 4.5,
          `${look.appearance} ${look.accent}/${look.ground}: ${ink} ${vars[ink]} on ${surface} ${vars[surface]}`,
        );
  }
});
