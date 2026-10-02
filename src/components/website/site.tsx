import { SiteAnnouncement } from "./announcement";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Coins,
  Monitor,
  ShieldCheck,
  Smartphone,
  Store,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import release from "@/lib/website/release.json";
import "./website.css";

export function Website({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="ls-site">
      <a className="ls-skip" href="#main">
        Skip to content
      </a>
      <header className="ls-header ls-wrap">
        <Link className="ls-brand" to="/welcome">
          <img src="/favicon.svg" alt="" width="34" height="34" />
          Lootsplit<span>THE PARTY LEDGER</span>
        </Link>
        <nav aria-label="Website">
          <Link to="/account">My account</Link>
          <Link to="/resources" aria-current={path === "/resources" ? "page" : undefined}>
            Resources
          </Link>
          <Link to="/donate" aria-current={path === "/donate" ? "page" : undefined}>
            Donate
          </Link>
          <Link to="/downloads" aria-current={path === "/downloads" ? "page" : undefined}>
            Downloads
          </Link>
          <Link to="/updates" aria-current={path === "/updates" ? "page" : undefined}>
            Changelog
          </Link>
          <Link to="/help" aria-current={path === "/help" ? "page" : undefined}>
            Help
          </Link>
        </nav>
        <a className="ls-button ls-small" href="/">
          Open app <ArrowRight size={16} />
        </a>
      </header>
      <main id="main">{children}</main>
      <footer className="ls-footer ls-wrap">
        <div>
          <Link className="ls-brand" to="/welcome">
            Lootsplit
          </Link>
          <p>Keep the books. Tell the story.</p>
        </div>
        <div>
          <Link to="/downloads">Downloads</Link>
          <Link to="/updates">Changelog</Link>
          <Link to="/help">Help & backups</Link>
          <Link to="/resources">Resources</Link>
          <Link to="/donate">Donate</Link>
          <a href={release.historyUrl}>GitHub releases ↗</a>
        </div>
        <p>
          A companion for your tabletop adventures.
          <br />
          Accounts are optional.
        </p>
      </footer>
    </div>
  );
}

export function WelcomePage() {
  return (
    <Website>
      <SiteAnnouncement />
      <section className="ls-hero">
        <img className="ls-hero-art" src="/art/landscape.webp" alt="" />
        <div className="ls-hero-shade" />
        <div className="ls-wrap ls-hero-content">
          <Link className="ls-release-label" to="/updates">
            <span /> Android {release.version} is here <ArrowRight size={14} />
          </Link>
          <p className="ls-eyebrow">FOR DUNGEON MASTERS & THEIR PARTIES</p>
          <h1>
            More adventure.
            <br />
            <em>Less bookkeeping.</em>
          </h1>
          <p className="ls-intro">
            A shared ledger for your next great campaign. Track the treasure, stock the shops, and
            keep every party member on the same page.
          </p>
          <div className="ls-actions">
            <a className="ls-button" href="/">
              Open browser app <ArrowRight size={18} />
            </a>
            <Link className="ls-button ls-secondary" to="/downloads">
              <ArrowDownToLine size={18} /> Get Lootsplit
            </Link>
          </div>
          <p className="ls-hero-note">
            Browser & Android · Guest access · Local and shared campaigns
          </p>
        </div>
        <span className="ls-hero-caption">YOUR NEXT CHAPTER STARTS HERE</span>
      </section>
      <div className="ls-strip">
        <span>
          <Coins size={18} /> Every coin accounted for
        </span>
        <span>
          <Users size={18} /> One party, a shared ledger
        </span>
        <span>
          <BookOpen size={18} /> Built for the table
        </span>
      </div>
      <section className="ls-wrap ls-section ls-feature">
        <div>
          <p className="ls-eyebrow">THE COMPANION BETWEEN ADVENTURES</p>
          <h2>
            The loot is legendary.
            <br />
            The admin shouldn’t be.
          </h2>
          <p className="ls-copy">
            From the first copper piece to a dragon’s hoard, give your campaign’s economy a home.
            Keep money, inventory, merchants, and the story behind every purchase together.
          </p>
          <a className="ls-text-link" href="/">
            Start your ledger <ArrowRight size={17} />
          </a>
        </div>
        <div className="ls-feature-list">
          {[
            [
              Coins,
              "Follow the money",
              "Manage character purses and party funds, record transfers, and look back through the transaction ledger.",
            ],
            [
              Store,
              "Bring your markets to life",
              "Create shops, manage stock and prices, and let players buy and sell for their characters.",
            ],
            [
              Users,
              "Play your way",
              "Run locally, share files manually, or bring the party together in Live or Turn-based rooms.",
            ],
          ].map(([Icon, title, text]) => {
            const Glyph = Icon as typeof Coins;
            return (
              <article key={String(title)}>
                <Glyph size={23} />
                <div>
                  <h3>{String(title)}</h3>
                  <p>{String(text)}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <section className="ls-wrap ls-callout">
        <div>
          <p className="ls-eyebrow">YOUR CAMPAIGNS, CLOSE AT HAND</p>
          <h2>A place for your adventures.</h2>
          <p>
            Sign in to save memberships, reusable character profiles, and private cloud backups when
            you choose. Guest play stays available.
          </p>
        </div>
        <Link className="ls-button ls-secondary" to="/account">
          My campaign library <ArrowRight size={18} />
        </Link>
      </section>
      <section className="ls-wrap ls-callout">
        <div>
          <p className="ls-eyebrow">AT THE TABLE. ON THE GO.</p>
          <h2>Your ledger, within reach.</h2>
          <p>Open in your PC’s browser or take the Android app to your next session.</p>
        </div>
        <Link className="ls-button" to="/downloads">
          Choose your platform <ArrowRight size={18} />
        </Link>
      </section>
    </Website>
  );
}

export function DownloadsPage() {
  return (
    <Website>
      <section className="ls-wrap ls-section">
        <p className="ls-eyebrow">TAKE LOOTSPLIT TO YOUR TABLE</p>
        <h1>One party. Your platform.</h1>
        <p className="ls-intro">
          Play in your browser or download the Android app. Start without an account.
        </p>
        <div className="ls-platforms">
          <article className="ls-platform ls-android">
            <Smartphone size={30} />
            <span className="ls-tag">SIGNED RELEASE</span>
            <h2>Android</h2>
            <p>
              The app on your phone, with native file saving and sharing. The new account library is
              available on the website first. Shared rooms connect when you’re online.
            </p>
            <div className="ls-version">
              Version {release.version} <span>Android 7.0+ · APK</span>
            </div>
            <a className="ls-button" href="/download/android">
              <ArrowDownToLine size={18} /> Download for Android
            </a>
            <p className="ls-small-copy">
              Having trouble? <a href={release.apkUrl}>Download from GitHub</a> or open this page in
              Chrome.{" "}
              <a href="https://drive.google.com/file/d/1MT4by-7mNe7-7PANKbTwcbBOcd2CSKrr/view">
                Alternate download on Google Drive
              </a>
              .
            </p>
            <Link className="ls-text-link" to="/help" hash="android">
              Installation & update guide <ArrowRight size={16} />
            </Link>
          </article>
          <article className="ls-platform">
            <Monitor size={30} />
            <span className="ls-tag">NO DOWNLOAD NEEDED</span>
            <h2>Browser & PC</h2>
            <p>
              Use Lootsplit on Windows, macOS, Linux, or your phone. Open the web app and keep
              playing at its existing address.
            </p>
            <div className="ls-version">
              Always the deployed web version<span>Desktop & mobile browsers</span>
            </div>
            <a className="ls-button ls-secondary" href="/">
              Open browser app <ArrowRight size={18} />
            </a>
            <p className="ls-small-copy">
              A native Windows or macOS installer is not available yet.
            </p>
            <Link className="ls-text-link" to="/help" hash="desktop">
              Using Lootsplit on your PC <ArrowRight size={16} />
            </Link>
          </article>
        </div>
        <aside className="ls-notice">
          <ShieldCheck size={25} />
          <div>
            <h3>Keep your campaign safe when you update.</h3>
            <p>
              Export a backup first. Install this APK over the permanently signed 1.3.0 or 1.3.1
              app; keep your existing app installed. Browser and Android saves are separate unless
              you use a shared room or transfer a backup.
            </p>
          </div>
        </aside>
        <details className="ls-details">
          <summary>Release details & file verification</summary>
          <div>
            <p>Published {release.date}. Permanently signed Android release, version code 4.</p>
            <p>SHA-256 for {release.filename}:</p>
            <code className="ls-hash">{release.sha256}</code>
            <p>
              <a href={release.checksumUrl}>Download checksum file ↗</a> ·{" "}
              <a href={release.releaseUrl}>View this release on GitHub ↗</a>
            </p>
          </div>
        </details>
        <div className="ls-section-heading">
          <h2>What’s new in {release.version}?</h2>
          <Link className="ls-text-link" to="/updates">
            Read the changelog <ArrowRight size={16} />
          </Link>
        </div>
        <p className="ls-copy">
          Save exports to a chosen Android folder, navigate clearer invitations and backups, and see
          more useful transaction history.
        </p>
      </section>
    </Website>
  );
}

export function UpdatesPage() {
  return (
    <Website>
      <section className="ls-wrap ls-section ls-reading">
        <p className="ls-eyebrow">FROM THE LOOTSPLIT LEDGER</p>
        <h1>Changelog</h1>
        <p className="ls-intro">
          New releases, practical improvements, and what changed at the table.
        </p>
        <article className="ls-release">
          <div className="ls-release-meta">
            <span className="ls-tag">LATEST ANDROID RELEASE</span>
            <time dateTime="2026-10-02">{release.date}</time>
          </div>
          <h2>Version {release.version}</h2>
          <p className="ls-copy">
            Better exports, clearer recovery, and a more useful record of your campaign.
          </p>
          <ul>
            <li>
              <strong>Choose where your files go.</strong> Android exports offer Save file alongside
              Share.
            </li>
            <li>
              <strong>Switch rooms with more confidence.</strong> Invitations provide an explicit
              choice when you are already connected, with a backup before switching.
            </li>
            <li>
              <strong>Understand your records.</strong> New events record transaction types and
              structured price history, while older saves stay readable.
            </li>
            <li>
              <strong>Clearer backup guidance.</strong> Device recovery and browser background
              notifications have more precise instructions.
            </li>
            <li>
              <strong>Your party is ready.</strong> New installations include the Greyhaven default
              party. Existing campaigns stay unchanged.
            </li>
          </ul>
          <Link className="ls-button" to="/downloads">
            Get version {release.version} <ArrowDownToLine size={17} />
          </Link>
          <p className="ls-small-copy">
            Physical-device file saving, force-close recovery, and notification delivery still
            require device validation.
          </p>
        </article>
        <a className="ls-text-link" href={release.historyUrl}>
          Browse earlier releases on GitHub <ArrowRight size={17} />
        </a>
      </section>
    </Website>
  );
}

export function HelpPage() {
  return (
    <Website>
      <section className="ls-wrap ls-section ls-reading">
        <p className="ls-eyebrow">A GOOD START TO THE NEXT SESSION</p>
        <h1>A little help, adventurer.</h1>
        <p className="ls-intro">Installation, safe updates, and keeping your campaign with you.</p>
        <section className="ls-help-block" id="android">
          <h2>Install or update on Android</h2>
          <ol>
            <li>
              In your existing app, export a campaign backup and keep it outside the app’s storage.
            </li>
            <li>
              Use <Link to="/downloads">Download for Android</Link>. If an in-app browser blocks the
              download, open this page in Chrome. The GitHub link is a second download option.
            </li>
            <li>
              Open the APK in Files → Downloads. If Android asks, allow installation from that
              browser or file manager, then return to the installer.
            </li>
            <li>
              Choose Install or Update. The permanent release updates permanently signed 1.3.0 and
              1.3.1 installations in place.
            </li>
          </ol>
          <details className="ls-details">
            <summary>Android says “App not installed”</summary>
            <div>
              <p>
                An older debug-signed build cannot be updated with the permanent signing key. First
                export and verify a backup. Only then uninstall the old debug build, install this
                release, and restore your backup. Do not uninstall a working app just to
                troubleshoot a failed download.
              </p>
            </div>
          </details>
        </section>
        <section className="ls-help-block" id="desktop">
          <h2>Use Lootsplit on your PC</h2>
          <p>
            Open the <a href="/">browser app</a> in your desktop browser and bookmark it. There is
            no separate PC installer yet. If your browser offers an “Install app” or “Create
            shortcut” command, you can use it for quicker access.
          </p>
          <p>
            Keep using the same browser profile and website address to access its local campaigns. A
            shortcut does not create a cloud backup or automatically synchronize with Android.
          </p>
        </section>
        <section className="ls-help-block" id="backups">
          <h2>Keep saves and devices in sync</h2>
          <p>
            Local campaigns belong to the device and browser where you created them. Clearing
            browser data or uninstalling the app can remove those saves.
          </p>
          <p>
            Use Device backups to export a file outside app storage. To move a local campaign,
            transfer and import that backup on the other device. For shared play, host or join a
            Live or Turn-based room through Multiplayer. A shared action is saved when the server
            accepts it.
          </p>
          <p>
            Optional accounts now provide saved campaign memberships, private cloud backups, and
            reusable character profiles on the website. Use My account to explicitly save a
            membership or backup. Private PDFs stay device-local. Your current guest, local,
            manual-sharing, and multiplayer options remain available.
          </p>
        </section>
        <section className="ls-help-block">
          <h2>Starting with your party</h2>
          <p>
            Open the app as a dungeon master to manage the campaign, party, and shops. In
            Multiplayer, choose a shared mode and send an invitation to your players. Players join
            and take an assigned character; their permissions depend on the campaign.
          </p>
          <a className="ls-button" href="/">
            Open Lootsplit <ArrowRight size={18} />
          </a>
        </section>
      </section>
    </Website>
  );
}
