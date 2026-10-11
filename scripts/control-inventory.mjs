import ts from "typescript";
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : /\.tsx$/.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  );

/** Source declarations, including conditional/generated controls. Runtime instances vary with data. */
export function controlInventory() {
  const controls = [];
  for (const file of files("src")) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        if (["button", "Button", "a", "Link", "AppLink", "form"].includes(tag)) {
          const attrs = Object.fromEntries(
            node.attributes.properties
              .filter(ts.isJsxAttribute)
              .map((attr) => [
                attr.name.getText(source),
                attr.initializer?.getText(source) ?? "true",
              ]),
          );
          controls.push({
            file,
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            tag,
            attributes: attrs,
            spread: node.attributes.properties.some(ts.isJsxSpreadAttribute),
            label: node.parent.getText(source).replace(/\s+/g, " ").slice(0, 300),
          });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return controls;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controls = controlInventory();
  mkdirSync("test-results/navigation", { recursive: true });
  writeFileSync("test-results/navigation/source-controls.json", JSON.stringify(controls, null, 2));
  console.log(
    JSON.stringify({
      declarations: controls.length,
      byTag: Object.fromEntries(
        ["button", "Button", "a", "Link", "AppLink", "form"].map((tag) => [
          tag,
          controls.filter((c) => c.tag === tag).length,
        ]),
      ),
    }),
  );
}
