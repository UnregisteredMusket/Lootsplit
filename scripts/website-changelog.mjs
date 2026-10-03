const categories = ["features", "improvements", "fixes"];

export function validateWebsiteChangelog(entries, requiredVersion) {
  if (!Array.isArray(entries) || !entries.length) throw Error("Website changelog is empty.");
  const versions = new Set();
  for (const entry of entries) {
    if (!entry || !/^\d+\.\d+\.\d+$/.test(entry.version) || versions.has(entry.version))
      throw Error("Website changelog versions must be valid and unique.");
    versions.add(entry.version);
    const date = new Date(`${entry.date}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== entry.date ||
      typeof entry.summary !== "string" ||
      !entry.summary.trim()
    )
      throw Error(`Website changelog ${entry.version} needs a date and summary.`);
    for (const category of categories) {
      if (
        !Array.isArray(entry[category]) ||
        !entry[category].length ||
        entry[category].some((item) => typeof item !== "string" || !item.trim())
      )
        throw Error(
          `Website changelog ${entry.version} needs ${category}; say "None in this release" when applicable.`,
        );
    }
  }
  if (!versions.has(requiredVersion))
    throw Error(`Add the website changelog for Android ${requiredVersion} before publishing.`);
}
