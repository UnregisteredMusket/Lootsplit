import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { controlInventory } from "./control-inventory.mjs";

// A document reload resets the intentional per-launch title gate. Enforce routing
// at the source boundary, including links added outside the current browser audit.
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : entry.name.endsWith(".tsx")
        ? [join(dir, entry.name)]
        : [],
  );
}
test("app-owned navigation uses Link/AppLink instead of full-document anchors", () => {
  const violations = [];
  for (const file of files("src")) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node) {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(source) === "a"
      ) {
        const href = node.attributes.properties.find(
          (p) => p.name?.getText(source) === "href",
        )?.initializer;
        let prefix = "";
        if (href && ts.isStringLiteral(href)) prefix = href.text;
        if (href && ts.isJsxExpression(href) && href.expression) {
          if (ts.isTemplateExpression(href.expression)) prefix = href.expression.head.text;
          if (ts.isStringLiteral(href.expression)) prefix = href.expression.text;
          // These menus contain only app destinations; dynamic links must route too.
          if (file.includes("control-panel/")) violations.push(`${file}: dynamic raw menu anchor`);
        }
        if (
          prefix.startsWith("/") &&
          !prefix.startsWith("//") &&
          !prefix.startsWith("/download/") &&
          !prefix.startsWith("/api/")
        )
          violations.push(`${file}: ${prefix}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(
    violations,
    [],
    "Use AppLink for internal URLs; plain anchors are for hash-only, external, or file/API downloads.",
  );
});

test("literal app destinations resolve to an existing page or download", () => {
  const routes = files("src/routes").map((file) => readFileSync(file, "utf8"))
    .flatMap((text) => [...text.matchAll(/createFileRoute\("([^"]+)"\)/g)].map((m) => m[1]));
  // Index routes such as "/features/" serve "/features" (trailing slash optional).
  const known = routes.map(
    (route) =>
      new RegExp("^" + route.replace(/\$[^/]+/g, "[^/]+").replace(/(.)\/$/, "$1/?") + "$"),
  );
  const violations = [];
  for (const control of controlInventory()) {
    for (const attribute of ["href", "to"]) {
      const text = control.attributes[attribute];
      if (!text || !/^"\//.test(text)) continue;
      const href = JSON.parse(text);
      if (href.startsWith("//") || href.startsWith("/api/")) continue;
      const path = new URL(href, "https://lootsplit.invalid").pathname;
      if (path.startsWith("/download/") || known.some((r) => r.test(path))) continue;
      violations.push(`${control.file}:${control.line}: ${href}`);
    }
  }
  assert.deepEqual(violations, []);
});
