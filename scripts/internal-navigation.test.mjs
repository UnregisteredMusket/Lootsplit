import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

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
