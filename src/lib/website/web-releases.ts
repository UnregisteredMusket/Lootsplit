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

// Publication evidence is deliberately separate from Android release metadata.
// An unverified source candidate must never be added as a published release.
export const webReleases: readonly WebRelease[] = [
  {
    id: "2026-10-07-campaign-integrity",
    status: "published",
    date: "2026-10-07",
    commit: "fb776325721f940143bc0c1bd3aadb3e147aa95d",
    title: "Safer campaign access, recovery and shared actions",
    summary:
      "The website and backend received campaign integrity repairs after the Android 1.6.0 release. Installed APK clients retain their own bundled interface and local behavior.",
    improvements: [
      "Campaign actions recheck current membership, restrictions and permissions when they commit.",
      "Interrupted shared actions and conflicting drafts retain scoped recovery and retry protection.",
      "Purchases, reversals and loans preserve financial and inventory integrity.",
      "Validated restores preserve complete campaign records; server-produced deletion backups support fresh, DM-only view-only recovery.",
      "Full shared handouts, paused-player controls and failed chat recovery are retained.",
    ],
    evidence: [
      { label: "Release details", url: "https://github.com/UnregisteredMusket/Lootsplit/pull/67" },
      {
        label: "Complete main verification",
        url: "https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37661353259",
      },
      {
        label: "Publication and live checks",
        url: "https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37661998263",
      },
    ],
  },
];

export function publishedWebReleases(entries: readonly WebRelease[]) {
  return entries
    .filter((entry) => entry.status === "published")
    .sort((a, b) => b.date.localeCompare(a.date));
}
