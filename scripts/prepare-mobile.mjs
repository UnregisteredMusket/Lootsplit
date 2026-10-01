import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

const candidates = ["dist/mobile-build/client", "dist/client", "dist"];
const source = candidates.find((dir) => existsSync(join(dir, "index.html")) || existsSync(join(dir, "_shell.html")));
if (!source) {
  console.error("[mobile] no client shell was built");
  process.exit(1);
}
rmSync("dist/mobile", { recursive: true, force: true });
mkdirSync("dist/mobile", { recursive: true });
for (const name of readdirSync(source)) {
  if (name === "server" || name === "mobile") continue;
  cpSync(join(source, name), join("dist/mobile", name), { recursive: true });
}
if (!existsSync("dist/mobile/index.html") && existsSync("dist/mobile/_shell.html")) {
  renameSync("dist/mobile/_shell.html", "dist/mobile/index.html");
}
if (!existsSync("dist/mobile/index.html")) {
  console.error("[mobile] index.html is missing");
  process.exit(1);
}
console.log("[mobile] packaged client at dist/mobile");
