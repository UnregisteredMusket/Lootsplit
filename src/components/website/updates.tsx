import { Link } from "@tanstack/react-router";
import { ArrowDownToLine, ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import changelog from "@/lib/website/changelog.json";
import { formatReleaseDate } from "@/lib/website/format";
import release from "@/lib/website/release.json";
import { publishedWebReleases, webReleases, type WebRelease } from "@/lib/website/web-releases";
import { PageHero } from "./parts";
import { Website } from "./site";

type AndroidEntry = (typeof changelog)[number];
type Entry = { kind: "android"; entry: AndroidEntry } | { kind: "web"; entry: WebRelease };
type Filter = "all" | "android" | "web";

const changeCategories = [
  ["features", "Added features"],
  ["improvements", "Improvements"],
  ["fixes", "Bug fixes"],
] as const;

const publishedAndroid = changelog
  .filter(
    (entry) => entry.version.localeCompare(release.version, undefined, { numeric: true }) <= 0,
  )
  .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));

// Newest first; on the same day Android versions keep their own order before web notes.
const entries: Entry[] = [
  ...publishedAndroid.map((entry) => ({ kind: "android" as const, entry })),
  ...publishedWebReleases(webReleases).map((entry) => ({ kind: "web" as const, entry })),
].sort((a, b) => b.entry.date.localeCompare(a.entry.date));

const latestWebId = publishedWebReleases(webReleases)[0]?.id;

const filters: [Filter, string][] = [
  ["all", "All releases"],
  ["android", "Android"],
  ["web", "Website and backend"],
];

/** #android-releases and #web-backend links open the matching filter. */
function filterFromHash(hash: string): Filter | null {
  if (hash === "#android-releases" || hash.startsWith("#android-")) return "android";
  if (hash === "#web-backend" || hash.startsWith("#web-")) return "web";
  return null;
}

function DateMargin({ date, label }: { date: string; label: string }) {
  const [month, day, year] = formatReleaseDate(date, "short").replace(",", "").split(" ");
  return (
    <div className="ls-entry-margin">
      <time dateTime={date} className="ls-entry-date">
        {month} {day}
        <span>{year}</span>
      </time>
      <p className="ls-sc">{label}</p>
    </div>
  );
}

function ChangeLists({ entry }: { entry: AndroidEntry }) {
  return (
    <div className="ls-change-lists">
      {changeCategories.map(([category, heading]) =>
        entry[category].length ? (
          <div key={category}>
            <h3 className="ls-sc">{heading}</h3>
            <ul>
              {entry[category].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}

function AndroidRelease({ entry, hidden }: { entry: AndroidEntry; hidden: boolean }) {
  const latest = entry.version === release.version;
  return (
    <article
      className="ls-entry ls-release ls-anchor"
      id={`android-${entry.version}`}
      hidden={hidden}
      aria-labelledby={`android-${entry.version}-title`}
    >
      <DateMargin date={entry.date} label="Android" />
      <div className={`ls-entry-body${latest ? " ls-card ls-card-raised" : ""}`}>
        <div className="ls-entry-head">
          <div>
            <p className="ls-sc ls-latest">
              {latest ? "Latest Android release" : "Android release"}
            </p>
            <h2 id={`android-${entry.version}-title`}>Version {entry.version}</h2>
          </div>
          {latest && (
            <Link className="ls-btn ls-btn-ink" to="/downloads">
              Get version {entry.version} <ArrowDownToLine size={17} aria-hidden="true" />
            </Link>
          )}
        </div>
        <p className="ls-entry-summary">{entry.summary}</p>
        {latest ? (
          <ChangeLists entry={entry} />
        ) : (
          <details className="ls-entry-details">
            <summary>Show changes in {entry.version}</summary>
            <ChangeLists entry={entry} />
          </details>
        )}
        {!latest && (
          <p className="ls-fine">
            <a
              href={`https://github.com/UnregisteredMusket/Lootsplit/releases/tag/android-v${entry.version}`}
            >
              View this release on GitHub ↗
            </a>
          </p>
        )}
      </div>
    </article>
  );
}

function WebReleaseEntry({ entry, hidden }: { entry: WebRelease; hidden: boolean }) {
  const lists = (
    <ul className="ls-plain-list">
      {entry.improvements.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
  return (
    <article
      className="ls-entry ls-release ls-anchor"
      id={`web-${entry.id}`}
      hidden={hidden}
      aria-labelledby={`web-${entry.id}-title`}
    >
      <DateMargin date={entry.date} label="Website and backend" />
      <div className="ls-entry-body">
        <p className="ls-sc ls-web-tag">Published web & backend</p>
        <h2 id={`web-${entry.id}-title`}>{entry.title}</h2>
        <p className="ls-entry-summary">{entry.summary}</p>
        {entry.id === latestWebId ? (
          lists
        ) : (
          <details className="ls-entry-details">
            <summary>Show changes</summary>
            {lists}
          </details>
        )}
        <p className="ls-fine">
          Published source:{" "}
          <a href={`https://github.com/UnregisteredMusket/Lootsplit/commit/${entry.commit}`}>
            <code>{entry.commit.slice(0, 12)}</code>
          </a>
          {entry.evidence.map((item) => (
            <span key={item.url}>
              {" · "}
              <a href={item.url}>{item.label}</a>
            </span>
          ))}
        </p>
      </div>
    </article>
  );
}

export function UpdatesPage() {
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => {
    const apply = () => {
      const next = filterFromHash(window.location.hash);
      if (!next) return;
      setFilter(next);
      // The target may have been hidden by an earlier filter; scroll once it shows.
      requestAnimationFrame(() =>
        document.getElementById(window.location.hash.slice(1))?.scrollIntoView(),
      );
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  const shown = entries.filter((item) => filter === "all" || item.kind === filter);
  return (
    <Website footer="ink">
      <PageHero kicker="From the Lootsplitter ledger" title="Changelog">
        <p className="ls-lead ls-measure">
          New releases, practical improvements, and what changed at the table. Every published
          website and Android release, newest first.
        </p>
      </PageHero>
      <section className="ls-paper ls-section ls-section-tight" aria-label="Releases">
        <div className="ls-wrap">
          <div className="ls-changelog-notes">
            <p>
              <strong>Android</strong> notes describe the separately published APKs; each installs
              over the previous version. All earlier release notes and downloads remain available.
            </p>
            <p>
              <strong>Website and backend</strong> changes have their own history. These notes do
              not change the Android download or promise that an installed APK contains newer
              client features.
            </p>
          </div>
          <div className="ls-filters" role="group" aria-label="Show releases">
            {filters.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="ls-seg"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="ls-fine ls-filter-status" role="status">
            Showing {shown.length} of {entries.length} releases
          </p>
          <span id="android-releases" className="ls-anchor" />
          <span id="web-backend" className="ls-anchor" />
          {entries.map((item) =>
            item.kind === "android" ? (
              <AndroidRelease
                key={`android-${item.entry.version}`}
                entry={item.entry}
                hidden={filter === "web"}
              />
            ) : (
              <WebReleaseEntry
                key={`web-${item.entry.id}`}
                entry={item.entry}
                hidden={filter === "android"}
              />
            ),
          )}
          <div className="ls-entries-end">
            <a href={release.historyUrl}>
              Browse earlier releases on GitHub <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
    </Website>
  );
}
