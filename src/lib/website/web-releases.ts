import audiences from "./web-audiences.json" with { type: "json" };
import history from "./web-releases.json" with { type: "json" };

/** Who a change is for; the Changelog groups a release's changes in this order. */
export const webAudiences: readonly { key: string; label: string }[] = audiences;
export const DEFAULT_WEB_AUDIENCE = "everyone";

/** One pull request's note inside a release (src/lib/website/web-changes/*.json). */
export type WebChange = {
  title: string;
  summary: string;
  items: readonly string[];
  audience?: string;
};

export type WebRelease = {
  id: string;
  status: "published" | "planned";
  date: string;
  commit: string;
  title: string;
  summary: string;
  improvements: readonly string[];
  /** Each note on its own, in audience order. Entries published before notes were kept
   * separately have none and render from `summary` and `improvements`. */
  changes?: readonly WebChange[];
  evidence: { label: string; url: string }[];
};

/** A release's changes in groups by audience, keeping their order; unknown or missing
 * audiences go to the default group. */
export function groupWebChanges(changes: readonly WebChange[]) {
  const keyOf = (change: WebChange) =>
    webAudiences.some((a) => a.key === change.audience) ? change.audience! : DEFAULT_WEB_AUDIENCE;
  return webAudiences
    .map((audience) => ({
      ...audience,
      changes: changes.filter((change) => keyOf(change) === audience.key),
    }))
    .filter((group) => group.changes.length);
}

// Entries stamped at build time from src/lib/website/web-changes/*.json by
// scripts/web-changelog-plugin.mjs; only the main verification build defines any.
// They leave out `improvements` when `changes` holds the same items (forPage).
type StampedRelease = Omit<WebRelease, "improvements"> & { improvements?: readonly string[] };
declare const __LOOTSPLIT_WEB_CHANGES__: StampedRelease[] | undefined;
const stamped: readonly WebRelease[] = (
  typeof __LOOTSPLIT_WEB_CHANGES__ === "undefined" ? [] : __LOOTSPLIT_WEB_CHANGES__
).map((entry) => ({
  ...entry,
  improvements: entry.improvements ?? entry.changes?.flatMap((change) => change.items) ?? [],
}));

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
