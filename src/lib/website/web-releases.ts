import history from "./web-releases.json" with { type: "json" };

export type WebRelease = {
  id: string;
  status: "published" | "planned";
  date: string;
  commit: string;
  title: string;
  summary: string;
  improvements: readonly string[];
  evidence: { label: string; url: string }[];
};

// Entries stamped at build time from src/lib/website/web-changes/*.json by
// scripts/web-changelog-plugin.mjs; only the main verification build defines any.
declare const __LOOTSPLIT_WEB_CHANGES__: WebRelease[] | undefined;
const stamped: readonly WebRelease[] =
  typeof __LOOTSPLIT_WEB_CHANGES__ === "undefined" ? [] : __LOOTSPLIT_WEB_CHANGES__;

// Publication evidence is deliberately separate from Android release metadata.
// An unverified source candidate must never be added as a published release:
// web-releases.json holds deployed history; pending notes are stamped only when they deploy.
export const webReleases: readonly WebRelease[] = [
  ...(history as WebRelease[]),
  ...stamped.filter((entry) => !history.some((known) => known.id === entry.id)),
];

/** Newest first; entries on the same day keep the later release first. */
export function publishedWebReleases(entries: readonly WebRelease[]) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.status === "published")
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date) || b.index - a.index)
    .map(({ entry }) => entry);
}
