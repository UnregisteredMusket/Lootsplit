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
