import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { mkdir, copyFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const output = "public/ocr/v7";
await mkdir(output, { recursive: true });
const root = (name) => dirname(require.resolve(name + "/package.json"));
const files = [
  [join(root("tesseract.js"), "dist/worker.min.js"), "worker.min.js"],
  [join(root("@tesseract.js-data/eng"), "4.0.0/eng.traineddata.gz"), "eng.traineddata.gz"],
  [join(root("tesseract.js-core"), "LICENSE"), "LICENSE-core.txt"],
  [join(root("tesseract.js"), "LICENSE.md"), "LICENSE-tesseract.txt"],
  ...["lstm", "simd-lstm", "relaxedsimd-lstm"].map((name) => [
    join(root("tesseract.js-core"), `tesseract-core-${name}.wasm.js`),
    `tesseract-core-${name}.wasm.js`,
  ]),
];
await Promise.all(files.map(([source, name]) => copyFile(source, join(output, name))));
console.log("Prepared local OCR worker, language data and compatible WASM cores.");
