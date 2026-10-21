import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Files that cannot change application behavior. A pull request touching only these skips the
// browser audits; the build job (unit tests, typecheck, lint, builds) still runs, and main
// always runs every group before anything is deployed.
const DOCUMENTATION = [/\.md$/i, /^docs\//, /^performance\//, /^LICENSE$/];

export function changesCode(files) {
  // An empty or unreadable change list is treated as code: never skip checks on uncertainty.
  if (!files.length) return true;
  return files.some((file) => !DOCUMENTATION.some((pattern) => pattern.test(file)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let code = true;
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    try {
      // A pull_request checkout is the test merge commit; its first parent is the base branch.
      const files = execFileSync("git", ["diff", "--name-only", "HEAD^1", "HEAD"], {
        encoding: "utf8",
      })
        .split("\n")
        .filter(Boolean);
      code = changesCode(files);
      console.log(`${files.length} changed files; ${code ? "code" : "documentation only"}.`);
    } catch (error) {
      console.log(`Change list unavailable (${error.message}); running every check.`);
    }
  } else console.log(`${process.env.GITHUB_EVENT_NAME || "local"} run: every check runs.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `code=${code}\n`);
}
