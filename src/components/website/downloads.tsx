import { Link } from "@tanstack/react-router";
import { ArrowDownToLine, ArrowRight, ShieldCheck } from "lucide-react";
import { AppLink } from "@/components/app-link";
import changelog from "@/lib/website/changelog.json";
import { formatReleaseDate } from "@/lib/website/format";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/website/contact";
import { OPEN_APP } from "@/lib/website/labels";
import release from "@/lib/website/release.json";
import { AboutLootsplit } from "./about";
import { Kicker, PageHero } from "./parts";
import { Website } from "./site";

const currentChanges = changelog.find((entry) => entry.version === release.version)!;

const comparison: [string, string, string][] = [
  ["Getting started", "Open the website", "Install the signed APK"],
  ["Updates", "Latest published web release", "Install each published APK update"],
  [
    "Campaign play",
    "Live, Turn-based and owned DM local play",
    "Same supported play modes; shared sessions require internet",
  ],
  [
    "Files and sharing",
    "Browser downloads and supported share controls",
    "Native file saving and Android share sheet",
  ],
  [
    "Device integration",
    "Browser navigation and storage",
    "Bundled client, Android back-button and network handling",
  ],
  ["Home screen", "—", "Field monitor and 4×1 companion widgets"],
  [
    "Notifications",
    "In-app alerts; browser notifications where supported and permitted",
    "In-app alerts; native push is not included",
  ],
];

export function DownloadsPage() {
  return (
    <Website>
      <PageHero kicker="Take Lootsplitter to your table" title="One party." accent="Your platform.">
        <p className="ls-lead ls-measure">
          Play in your browser or download the Android app. Sign in to host, or join the DM’s
          current invitation as a guest.
        </p>
      </PageHero>

      <section className="ls-paper ls-section ls-section-tight" aria-label="Platforms">
        <div className="ls-wrap ls-stack ls-gap-lg">
          <div className="ls-cols2">
            <article className="ls-card ls-card-raised">
              <div className="ls-card-top">
                <Kicker>Android 7.0+ · signed APK</Kicker>
                <p className="ls-sc ls-latest">
                  Latest · <time dateTime={currentChanges.date}>{release.date}</time>
                </p>
              </div>
              <h2>Version {release.version}</h2>
              <p>
                The app on your phone, with native file saving and sharing. Browser updates and
                the published APK have separate release schedules. Use the website for the latest
                tools; shared rooms connect when you’re online.
              </p>
              <p className="ls-card-summary">{currentChanges.summary}</p>
              <a className="ls-btn ls-btn-ink ls-self-start" href="/download/android">
                <ArrowDownToLine size={18} aria-hidden="true" /> Download for Android
              </a>
              <p className="ls-fine">
                Having trouble? <a href={release.apkUrl}>Download from GitHub</a> or open this
                page in Chrome. Still stuck? Email{" "}
                <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.{" "}
                <a href="https://drive.google.com/file/d/1MT4by-7mNe7-7PANKbTwcbBOcd2CSKrr/view">
                  Earlier Android release on Google Drive
                </a>
                .
              </p>
              <Link className="ls-text-link" to="/help" hash="android">
                Installation & update guide <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </article>
            <article className="ls-card ls-card-raised">
              <div className="ls-card-top">
                <Kicker>Browser and PC · no download</Kicker>
              </div>
              <h2>Always current</h2>
              <p>
                Use Lootsplitter on Windows, macOS, Linux, or your phone. Open the web app and keep
                playing at its existing address.
              </p>
              <p className="ls-card-summary">
                Always the deployed web version · Desktop & mobile browsers
              </p>
              <AppLink className="ls-btn ls-btn-ink ls-self-start" href="/">
                {OPEN_APP}
              </AppLink>
              <p className="ls-fine">A native Windows or macOS installer is not available yet.</p>
              <Link className="ls-text-link" to="/help" hash="desktop">
                Using Lootsplitter on your PC <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </article>
          </div>
          <aside className="ls-notice" aria-labelledby="update-safety">
            <ShieldCheck size={26} aria-hidden="true" />
            <div>
              <h2 id="update-safety">Keep your campaign safe when you update.</h2>
              <p>
                Export a backup first. Install each new APK over your existing, permanently signed
                Lootsplitter app; keep that app installed and don’t clear its data, because device
                campaigns live inside it. Every release is signed with the same permanent key, so
                Android accepts it as an update. Very early test builds that weren’t permanently
                signed can’t update in place; the installation guide explains how to move from
                them with a backup. Browser and Android saves are separate unless you use a shared
                room or transfer a backup.
              </p>
            </div>
          </aside>
          <div className="ls-whats-new">
            <h2 id="whats-new">What’s new in {release.version}?</h2>
            <p>{currentChanges.summary}</p>
            <Link className="ls-text-link" to="/updates" hash={`android-${release.version}`}>
              Read the changelog <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <section className="ls-ink ls-section" aria-labelledby="platform-comparison">
        <div className="ls-wrap ls-stack ls-gap-lg">
          <div className="ls-stack ls-center">
            <Kicker ornament>Weigh your options</Kicker>
            <h2 id="platform-comparison" className="ls-display ls-anchor">
              Browser or Android?
            </h2>
            <p className="ls-lead ls-measure">
              Choose the version that fits your table. Android provides native device
              conveniences; campaign rules and server permissions stay shared.
            </p>
          </div>
          <p className="ls-fine ls-scroll-hint" aria-hidden="true">
            Scroll the table sideways to compare →
          </p>
          <div
            className="ls-table-wrap ls-paper"
            role="region"
            aria-labelledby="platform-comparison"
            tabIndex={0}
          >
            <table className="ls-compare">
              <thead>
                <tr>
                  <th scope="col">Capability</th>
                  <th scope="col">Browser</th>
                  <th scope="col">Android app</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map(([capability, browser, android]) => (
                  <tr key={capability}>
                    <th scope="row">{capability}</th>
                    <td>{browser}</td>
                    <td>{android}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ls-fine ls-center">
            Web and Android releases have separate schedules. Features shown on this website may
            reach the browser before the next APK. Keep exported backups outside either
            application’s storage.
          </p>
        </div>
      </section>

      <section
        id="release-details"
        className="ls-ink ls-section ls-section-flush ls-anchor"
        aria-labelledby="release-details-title"
      >
        <div className="ls-wrap">
          <div className="ls-card ls-card-ink ls-release-details">
            <h2 id="release-details-title">Release details and verification</h2>
            <p>
              Published {release.date}. Permanently signed Android release, version code{" "}
              {release.versionCode}.
            </p>
            <dl className="ls-meta">
              <dt>Version</dt>
              <dd>
                {release.version} (version code {release.versionCode})
              </dd>
              <dt>Published</dt>
              <dd>
                <time dateTime={currentChanges.date}>{formatReleaseDate(currentChanges.date)}</time>
              </dd>
              <dt>File</dt>
              <dd>{release.filename}</dd>
              <dt>SHA-256</dt>
              <dd>
                <code className="ls-hash">{release.sha256}</code>
              </dd>
              <dt>Links</dt>
              <dd>
                <a href={release.checksumUrl}>Download checksum file ↗</a> ·{" "}
                <a href={release.releaseUrl}>View this release on GitHub ↗</a> ·{" "}
                <Link to="/updates" hash={`android-${release.version}`}>
                  What’s new
                </Link>
              </dd>
            </dl>
            <AboutLootsplit />
          </div>
        </div>
      </section>
    </Website>
  );
}
