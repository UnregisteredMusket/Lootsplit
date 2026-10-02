/** Reproducible static inventory; call counts are evidence, not runtime coverage. */
import ts from "typescript";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const roots = ["src", "cloudflare", "server", "scripts", "db"];
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : path.join(dir, e.name))),
    )
  ).flat();
}
const files = [
  ...(await Promise.all(roots.map(walk))).flat(),
  ...(await readdir(".")).filter((f) => /\.(?:[cm]?js|tsx?)$/.test(f)),
  "public/notify-sw.js",
]
  .filter((f) => /\.(?:[cm]?js|tsx?)$/.test(f) && !/\.d\.[cm]?ts$|routeTree\.gen\.ts$/.test(f))
  .sort();
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd()).options;
const program = ts.createProgram(files, {
  ...options,
  allowJs: true,
  checkJs: false,
  noEmit: true,
});
const checker = program.getTypeChecker();
const functions = [],
  bySymbol = new Map();
const isFunction = (n) =>
  (ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n) ||
    ts.isConstructorDeclaration(n)) &&
  !!n.body;
const short = (n) => n?.getText().replace(/\s+/g, " ").slice(0, 140) || "";
function context(n) {
  const p = n.parent;
  if (ts.isConstructorDeclaration(n)) return "constructor";
  if (n.name) return short(n.name);
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isJsxAttribute(p))
    return short(p.name);
  if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) return short(p.parent.name);
  if (ts.isCallExpression(p))
    return `${short(p.expression)} callback ${p.arguments.indexOf(n) + 1}`;
  if (ts.isReturnStatement(p)) return "returned callback / cleanup";
  return `${ts.SyntaxKind[p.kind]} callback`;
}
function domain(file) {
  if (/\.test\.|browser-audit|worker-audit|browser-smoke|browser-guard/.test(file))
    return "Verification: assertions, fixtures and browser workflows";
  if (file.startsWith("scripts/"))
    return "Build/development tooling: environment, packaging, preview or audit";
  if (
    /cloudflare\/(accounts|members|site-owner|monitoring|bug-reports|account-campaigns)/.test(file)
  )
    return "Account service: verified identities, roles, private records and moderation";
  if (/character|party-sheet|readouts|home-sheet/.test(file))
    return "Character play: sheet ownership, assignment, stats, rolls and party integration";
  if (/encounter/.test(file))
    return "Encounter play: DM lifecycle, manual combat, loot review and atomic awards";
  if (/cloud|room-|member-access|table|share|chat|notify|push|multiplayer/.test(file))
    return "Shared campaign: seat authorization, synchronization, turns, messaging and recovery";
  if (
    /economy|money|market|gift|receipt|commands|compose|scale|shop|catalog|price-harvest/.test(file)
  )
    return "Economy: validated money, inventory, catalog, purchases and ledger operations";
  if (/campaign|saves|lock|password|save-folder/.test(file))
    return "Persistence: campaign isolation, backups, encryption and restoration";
  if (
    /book|pdf|extract|sheet-file|library|articles|handout|open5e|names|favorites|read\./.test(file)
  )
    return "Reference library: private imports, parsing, search, credits and saved references";
  if (/auth|account|app-data/.test(file))
    return "Identity/platform integration: sessions, access control and account requests";
  if (/mobile/.test(file))
    return "Native compatibility: bundled origin, file/share, network and back navigation";
  if (/website|welcome|downloads|donate|resources|updates|help/.test(file))
    return "Public website: installation, resources, help and announcements";
  if (
    /control-panel|shell|seat|prefs|theme|shortcut|styles|ui|guide|diagnostic|draft|notices|terminal/.test(
      file,
    )
  )
    return "Application controls: navigation, role context, preferences, drafts and status";
  if (file.startsWith("src/routes/"))
    return "Router entry: render page, validate search or handle request";
  if (/worker|server/.test(file))
    return "Server entry: request dispatch, environment, origin and response handling";
  return "Application support: shared utilities, initialization and presentation";
}
for (const file of files) {
  const sf = program.getSourceFile(file);
  if (!sf) throw Error(`Missing parsed source: ${file}`);
  function visit(node, parentFunction) {
    let current = parentFunction;
    if (isFunction(node)) {
      const nameNode =
        node.name || (ts.isVariableDeclaration(node.parent) ? node.parent.name : undefined);
      const symbol = nameNode && checker.getSymbolAtLocation(nameNode);
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const entry = {
        file,
        line,
        end: sf.getLineAndCharacterOfPosition(node.end).line + 1,
        name: context(node),
        parent: parentFunction?.name || "module",
        domain: domain(file),
        symbol,
        node,
        references: new Set(),
        calls: new Set(),
        returns: new Set(),
      };
      functions.push(entry);
      if (symbol) bySymbol.set(symbol, entry);
      current = entry;
    }
    ts.forEachChild(node, (n) => visit(n, current));
  }
  visit(sf, null);
}
for (const file of files) {
  const sf = program.getSourceFile(file);
  function visit(n) {
    if (ts.isIdentifier(n)) {
      let symbol = checker.getSymbolAtLocation(n);
      if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const entry = bySymbol.get(symbol);
      if (entry && n !== entry.node.name && n !== entry.node.parent.name)
        entry.references.add(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
}
for (const entry of functions) {
  function body(n) {
    if (n !== entry.node && isFunction(n)) return;
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) entry.calls.add(short(n.expression));
    if (ts.isReturnStatement(n)) entry.returns.add(short(n.expression));
    ts.forEachChild(n, body);
  }
  body(entry.node);
}
function intent(f) {
  const n = f.name;
  if (/^on[A-Z]/.test(n)) return `Handle ${n.slice(2)} interaction in ${f.parent}`;
  if (/^use[A-Z]/.test(n)) return `Maintain subscribed React state / lifecycle via ${n}`;
  if (/useEffect callback/.test(n))
    return `Synchronize component state and resources in ${f.parent}`;
  if (/returned callback/.test(n)) return `Cleanup or deferred operation returned by ${f.parent}`;
  if (/\.map callback/.test(n)) return `Transform each collection entry for ${f.parent}`;
  if (/\.(filter|find|some|every|findIndex) callback/.test(n))
    return `Select or validate collection entries for ${f.parent}`;
  if (/\.reduce callback/.test(n)) return `Aggregate values for ${f.parent}`;
  if (/\.sort callback/.test(n)) return `Order entries for ${f.parent}`;
  if (/\.catch callback/.test(n)) return `Handle rejected work in ${f.parent}`;
  if (/\.finally callback/.test(n)) return `Release/reset completion state in ${f.parent}`;
  if (/\.then callback/.test(n)) return `Consume asynchronous results in ${f.parent}`;
  if (/test callback/.test(n)) return "Exercise the named test case and its assertions";
  if (/^(setTimeout|setInterval|addEventListener|.*\.addEventListener)/.test(n))
    return `Handle timer/event registration in ${f.parent}`;
  if (/^[A-Z]/.test(n) && f.file.endsWith(".tsx")) return `Render ${n} and wire its interactions`;
  if (f.symbol)
    return `Implement ${n.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()} within ${f.domain.split(":")[0].toLowerCase()}`;
  return `Execute ${n} within ${f.parent}; see direct calls and return values`;
}
const csv = (v) => `"${String(v).replaceAll('"', '""')}"`;
const rows = functions.map((f) => {
  const node = f.node,
    parent = node.parent;
  const exported = (node.modifiers || parent.parent?.modifiers || []).some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword,
  );
  const kind =
    ts.isArrowFunction(node) || ts.isFunctionExpression(node)
      ? "callback / function value"
      : "named callable";
  const use = f.symbol
    ? f.references.size
      ? "statically referenced"
      : exported
        ? "exported boundary; dynamic consumer possible"
        : "no static symbol references; registration or retained utility requires context"
    : "inline callback registered by surrounding expression";
  return [
    f.file,
    f.line,
    f.end,
    f.name,
    f.parent,
    kind,
    f.domain,
    intent(f),
    use,
    f.references.size,
    [...f.references].join("; "),
    [...f.calls].join("; "),
    [...f.returns].slice(0, 8).join("; "),
  ];
});
await mkdir("docs/audit", { recursive: true });
await writeFile(
  "docs/audit/function-inventory.csv",
  [
    [
      "file",
      "start_line",
      "end_line",
      "function_or_registration",
      "enclosing_function",
      "kind",
      "module_responsibility",
      "inferred_intent",
      "static_use",
      "reference_locations",
      "referenced_from",
      "direct_calls",
      "return_expressions",
    ],
    ...rows,
  ]
    .map((row) => row.map(csv).join(","))
    .join("\n") + "\n",
);
const counts = Object.fromEntries(
  [...new Set(functions.map((f) => f.domain))]
    .sort()
    .map((d) => [d, functions.filter((f) => f.domain === d).length]),
);
const summary = {
  files: files.length,
  functions: functions.length,
  namedSymbols: functions.filter((f) => f.symbol).length,
  domains: counts,
  note: "Includes nested callbacks and test/build functions. Excludes declarations/generated routes/dependencies. Static registration/call evidence is not dynamic coverage or formal correctness proof.",
};
await writeFile("docs/audit/function-summary.json", JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
