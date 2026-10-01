import { writeFileSync } from "node:fs";
writeFileSync("dist/server/index.js", 'export { default } from "./index.mjs";\n');
