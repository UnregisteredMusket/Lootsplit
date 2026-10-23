import { collectEntries, readNotes, withoutBookkeeping } from "./web-changelog.mjs";

/**
 * Compiles stamped website changelog entries into the build as __LOOTSPLIT_WEB_CHANGES__.
 * LOOTSPLIT_WEB_CHANGELOG=release (main verification build only) stamps notes with their
 * deployed commit and runs and fails the build on any error; =preview stamps every note as if
 * HEAD were live, for local review. Otherwise notes are only validated and nothing is added,
 * so development and pull request builds never show unreleased notes.
 */
export function webChangelogPlugin() {
  return {
    name: "lootsplit-web-changelog",
    async config() {
      const mode = process.env.LOOTSPLIT_WEB_CHANGELOG || "";
      readNotes(); // Invalid notes fail every build, not just main.
      const entries = (await collectEntries({ mode })).map(withoutBookkeeping);
      if (mode) console.log(`Website changelog (${mode}): ${entries.length} stamped entries.`);
      return { define: { __LOOTSPLIT_WEB_CHANGES__: JSON.stringify(entries) } };
    },
  };
}
