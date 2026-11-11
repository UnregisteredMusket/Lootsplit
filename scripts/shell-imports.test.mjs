import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Every page, public ones included, loads the root route's static import graph (the shell). The
// audit of 2026-11-10 (F5) found the Help guide, the 427 KB icon catalogue and the home and help
// page content in it. This walks static imports (dynamic import() is a separate chunk) and keeps
// them out; a build is not needed.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensions = ["", ".ts", ".tsx", ".mjs", ".js", ".json", "/index.ts", "/index.tsx"];
function resolveImport(from, specifier) {
  let base;
  if (specifier.startsWith("@/")) base = join(root, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return null;
  base = base.replace(/\?.*$/, "");
  for (const extension of extensions) {
    const file = base + extension;
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}
/** Static (non-type) imports and re-exports reachable from `entry`, each with who imported it. */
function staticGraph(entry) {
  const start = join(root, entry);
  const parents = new Map([[start, null]]);
  for (const file of parents.keys()) {
    if (!/\.(tsx?|mjs|js)$/.test(file)) continue;
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const pattern = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/g;
    for (const match of source.matchAll(pattern)) {
      const target = resolveImport(file, match[1]);
      if (target && !parents.has(target)) parents.set(target, file);
    }
  }
  return parents;
}
const chain = (parents, file) => {
  const steps = [];
  for (let at = file; at; at = parents.get(at)) steps.push(relative(root, at));
  return steps.join(" <- ");
};

test("the shell leaves out the Help guide, the icon catalogue and the home and help pages", () => {
  const shell = staticGraph("src/routes/__root.tsx");
  assert.ok(shell.size > 50, "the walker follows the root route's imports");
  for (const kept of ["src/lib/help/descriptions.ts", "src/lib/icons/resolve.ts", "src/components/website/site.tsx"])
    assert.ok(shell.has(join(root, kept)), `${kept} is expected in the shell`);
  for (const heavy of [
    "src/lib/help/content.ts",
    "src/lib/help/player-content.ts",
    "src/components/help-content.tsx",
    "src/lib/icons/catalog.json",
    "src/lib/icons/catalog-lookup.ts",
    "src/components/website/welcome-page.tsx",
    "src/components/website/help-page.tsx",
  ]) {
    const file = join(root, heavy);
    assert.ok(existsSync(file), heavy);
    assert.equal(shell.has(file), false, `${heavy} is in the shell: ${shell.has(file) ? chain(shell, file) : ""}`);
  }
});

test("the help and home routes still reach their own content", () => {
  assert.ok(staticGraph("src/routes/help.tsx").has(join(root, "src/lib/help/content.ts")));
  assert.ok(staticGraph("src/routes/welcome.tsx").has(join(root, "src/components/website/welcome-page.tsx")));
});
