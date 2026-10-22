// Mutation testing (StrykerJS), run manually: `npm run mutation`. It changes small pieces of the
// money code (operators, conditions, constants) and checks that some test fails for each change.
// Survivors show assertions the money tests are missing. Not part of CI: a full run takes minutes.
// Widen `mutate` deliberately; each file multiplies the run time.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ["src/lib/quire/money.ts"],
  testRunner: "command",
  commandRunner: {
    command:
      "node --experimental-strip-types --test src/lib/quire/money.test.ts src/lib/quire/money-*.test.ts",
  },
  coverageAnalysis: "off",
  reporters: ["clear-text", "progress", "html"],
  htmlReporter: { fileName: "test-results/mutation/index.html" },
  tempDirName: ".stryker-tmp",
  ignorePatterns: ["android", "dist", "test-results", ".output", ".wrangler", "public/ocr"],
  concurrency: 2,
  timeoutMS: 60000,
};
