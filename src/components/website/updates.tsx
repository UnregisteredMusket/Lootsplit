import { Link } from "@tanstack/react-router";
import { ArrowDownToLine, ArrowRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
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

/** The newest releases shown in full; older ones fold to their summary line (W-7). */
const EXPANDED_RELEASES = 2;

const entryId = (item: Entry) =>
  item.kind === "android" ? `android-${item.entry.version}` : `web-${item.entry.id}`;

type Shape = {
  id: string;
  hidden: boolean;
  /** Folded to one summary line inside a disclosure. */
  folded: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
};

/** One release: in full, or folded to its date, title and summary line. Every release keeps
 * its `#android-x.y.z` / `#web-…` anchor on the article either way. */
function ReleaseShell({
  id,
  hidden,
  folded,
  open,
  onToggle,
  date,
  label,
  tag,
  title,
  summary,
  head,
  card = false,
  children,
}: Shape & {
  date: string;
  label: string;
  tag: ReactNode;
  title: string;
  summary: string;
  head?: ReactNode;
  card?: boolean;
  children: ReactNode;
}) {
  const titleId = `${id}-title`;
  if (folded)
    return (
      <article
        className="ls-entry ls-entry-folded ls-release ls-anchor"
        id={id}
        hidden={hidden}
        aria-labelledby={titleId}
      >
        <details
          className="ls-fold"
          open={open}
          onToggle={(event) => onToggle(event.currentTarget.open)}
        >
          <summary>
            <span className="ls-fold-meta">
              <time dateTime={date}>{formatReleaseDate(date, "short")}</time>
              <span className="ls-sc">{label}</span>
            </span>
            <span className="ls-fold-title">
              <h2 id={titleId}>{title}</h2>
              <span className="ls-fold-line">{summary}</span>
            </span>
          </summary>
          <div className="ls-entry-body ls-fold-body">{children}</div>
        </details>
      </article>
    );
  return (
    <article className="ls-entry ls-release ls-anchor" id={id} hidden={hidden} aria-labelledby={titleId}>
      <DateMargin date={date} label={label} />
      <div className={`ls-entry-body${card ? " ls-card ls-card-raised" : ""}`}>
        <div className="ls-entry-head">
          <div>
            {tag}
            <h2 id={titleId}>{title}</h2>
          </div>
          {head}
        </div>
        <p className="ls-entry-summary">{summary}</p>
        {children}
      </div>
    </article>
  );
}

function AndroidRelease({ entry, ...shape }: Shape & { entry: AndroidEntry }) {
  const latest = entry.version === release.version;
  return (
    <ReleaseShell
      {...shape}
      date={entry.date}
      label="Android"
      tag={<p className="ls-sc ls-latest">{latest ? "Latest Android release" : "Android release"}</p>}
      title={`Version ${entry.version}`}
      summary={entry.summary}
      card={latest}
      head={
        latest && (
          <Link className="ls-btn ls-btn-ink" to="/downloads">
            Get version {entry.version} <ArrowDownToLine size={17} aria-hidden="true" />
          </Link>
        )
      }
    >
      <ChangeLists entry={entry} />
      {!latest && (
        <p className="ls-fine">
          <a
            href={`https://github.com/UnregisteredMusket/Lootsplit/releases/tag/android-v${entry.version}`}
          >
            View this release on GitHub ↗
          </a>
        </p>
      )}
    </ReleaseShell>
  );
}

function WebReleaseEntry({ entry, ...shape }: Shape & { entry: WebRelease }) {
  return (
    <ReleaseShell
      {...shape}
      date={entry.date}
      label="Website and backend"
      tag={<p className="ls-sc ls-web-tag">Published web & backend</p>}
      title={entry.title}
      summary={entry.summary}
    >
      <ul className="ls-plain-list">
        {entry.improvements.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
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
    </ReleaseShell>
  );
}

/** Version jump list: every Android version, and web releases by date (W-7). */
function JumpList() {
  const web = entries.filter((item) => item.kind === "web");
  return (
    <nav className="ls-jump" aria-label="Jump to a release">
      <p className="ls-sc">Jump to an Android version</p>
      <ul className="ls-jump-list">
        {publishedAndroid.map((entry) => (
          <li key={entry.version}>
            <a href={`#android-${entry.version}`}>{entry.version}</a>
          </li>
        ))}
      </ul>
      <details className="ls-jump-web">
        <summary>Website and backend releases by date ({web.length})</summary>
        <ul>
          {web.map((item) => (
            <li key={entryId(item)}>
              <a href={`#${entryId(item)}`}>
                {formatReleaseDate(item.entry.date, "short")} ·{" "}
                {item.kind === "web" ? item.entry.title : ""}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}

export function UpdatesPage() {
  const [filter, setFilter] = useState<Filter>("all");
  // Folded releases opened by the visitor or by a link to their anchor.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string, open: boolean) =>
    setOpened((prev) => {
      if (prev.has(id) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  useEffect(() => {
    const apply = () => {
      const next = filterFromHash(window.location.hash);
      if (!next) return;
      setFilter(next);
      // Opening a release's anchor expands it.
      toggle(window.location.hash.slice(1), true);
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
  // The newest releases in the current filter, and the latest Android download, stay in full.
  const expanded = new Set([
    ...shown.slice(0, EXPANDED_RELEASES).map(entryId),
    ...(filter === "web" ? [] : [`android-${release.version}`]),
  ]);
  const shape = (item: Entry) => {
    const id = entryId(item);
    return {
      id,
      hidden: !shown.includes(item),
      folded: !expanded.has(id),
      open: opened.has(id),
      onToggle: (open: boolean) => toggle(id, open),
    };
  };
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
          <JumpList />
          <p className="ls-fine ls-filter-status" role="status">
            Showing {shown.length} of {entries.length} releases
          </p>
          <span id="android-releases" className="ls-anchor" />
          <span id="web-backend" className="ls-anchor" />
          {entries.map((item) =>
            item.kind === "android" ? (
              <AndroidRelease key={entryId(item)} entry={item.entry} {...shape(item)} />
            ) : (
              <WebReleaseEntry key={entryId(item)} entry={item.entry} {...shape(item)} />
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
