import { AppLink } from "@/components/app-link";
import { HelpContent } from "../help-content";
import { GoldSpentCounter } from "./gold-counter";
import { SiteAnnouncement } from "./announcement";
import { Kicker, PageHero, Shot } from "./parts";
import { useReleaseIdentity } from "./release-identity";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import type { ProductShot } from "@/lib/website/product-shots";
import release from "@/lib/website/release.json";
import { OPEN_APP } from "@/lib/website/labels";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/website/contact";
import "./website.css";

/** One order and one set of labels for the header and the footer. */
const siteLinks = [
  ["/features", "Features"],
  ["/downloads", "Downloads"],
  ["/updates", "Changelog"],
  ["/help", "Help"],
  ["/resources", "Resources"],
  ["/donate", "Donate"],
] as const;

export function Website({
  children,
  footer = "paper",
}: {
  children: ReactNode;
  /** Contrast the footer with the page's last section. */
  footer?: "paper" | "ink";
}) {
  const path = useRouterState({ select: (s) => s.location.pathname }).replace(/\/$/, "");
  const [menuOpen, setMenuOpen] = useState(false);
  const navId = useId();
  useEffect(() => setMenuOpen(false), [path]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);
  const current = (to: string) => (path === to ? ("page" as const) : undefined);
  return (
    <div className="ls-site">
      <a className="ls-skip" href="#main">
        Skip to content
      </a>
      <header className="ls-header">
        <div className="ls-wrap ls-header-row">
          <Link className="ls-brand" to="/welcome" aria-label="Lootsplitter home">
            <img src="/favicon.svg" alt="" width="34" height="34" />
            <span className="ls-brand-text">
              <span className="ls-brand-name">Lootsplitter</span>
              <span className="ls-brand-tag">The Party Ledger</span>
            </span>
          </Link>
          <nav
            id={navId}
            aria-label="Website"
            className="ls-nav"
            data-open={menuOpen ? "true" : "false"}
          >
            <ul>
              {siteLinks.map(([to, label]) => (
                <li key={to}>
                  <Link to={to} aria-current={current(to)}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
            <Link className="ls-nav-account" to="/account" aria-current={current("/account")}>
              My account
            </Link>
          </nav>
          <AppLink className="ls-btn ls-btn-gold ls-btn-small ls-header-cta" href="/">
            {OPEN_APP}
          </AppLink>
          <button
            type="button"
            className="ls-menu-button"
            aria-expanded={menuOpen}
            aria-controls={navId}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            <span>Menu</span>
          </button>
        </div>
      </header>
      <main id="main">{children}</main>
      <SiteFooter tone={footer} current={current} />
    </div>
  );
}

function SiteFooter({
  tone,
  current,
}: {
  tone: "paper" | "ink";
  current: (to: string) => "page" | undefined;
}) {
  const { state } = useReleaseIdentity();
  const web =
    state.status === "ready"
      ? state.identity.commit.slice(0, 7)
      : state.status === "development"
        ? "development preview"
        : state.status === "failed"
          ? "release unavailable"
          : "checking…";
  return (
    <footer className={`ls-footer ${tone === "paper" ? "ls-paper ls-paper-open" : "ls-footer-ink"}`}>
      <div className="ls-wrap ls-footer-inner">
        <div className="ls-footcols">
          <div className="ls-footer-brand">
            <Link className="ls-footer-name" to="/welcome">
              Lootsplitter
            </Link>
            <p className="ls-footer-motto">Keep the books. Tell the story.</p>
            <p className="ls-footer-blurb">
              A companion for your tabletop adventures. DMs need an account. Players can join as
              guests with a current session invitation.
            </p>
            <p className="ls-footer-contact">
              <span>Contact &amp; support</span>
              <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
            </p>
          </div>
          <nav aria-label="Website footer" className="ls-footer-nav">
            <ul>
              {siteLinks.map(([to, label]) => (
                <li key={to}>
                  <Link to={to} aria-current={current(to)}>
                    {label}
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/account" aria-current={current("/account")}>
                  My account
                </Link>
              </li>
              <li>
                <AppLink href="/">{OPEN_APP}</AppLink>
              </li>
              <li>
                <a href={release.historyUrl}>GitHub releases ↗</a>
              </li>
            </ul>
          </nav>
        </div>
        <div className="ls-footer-bottom">
          <Link to="/downloads" hash="release-details" className="ls-footer-identity">
            Web {web} · Android {release.version} (code {release.versionCode})
          </Link>
          <Link to="/downloads" hash="release-details">
            Release details and verification
          </Link>
        </div>
      </div>
    </footer>
  );
}

const areas: [ProductShot, string, string, string][] = [
  [
    "character",
    "characters",
    "Characters & party",
    "Full sheets, dice, imports from PDF or scans, shared purses.",
  ],
  [
    "market",
    "markets",
    "Shops, trade & barter",
    "Merchants with stock, commodity exchanges, player trades.",
  ],
  [
    "maps",
    "encounters",
    "Maps & tabletop",
    "Linked scenes, tokens, fog of war, pings and a player display.",
  ],
  [
    "encounter",
    "encounters",
    "Encounters",
    "SRD creatures, generator, initiative tracker, loot tables.",
  ],
  [
    "properties",
    "world",
    "NPCs, property & ships",
    "Locations, NPC inventories, deeds, staff, cargo and voyages.",
  ],
  [
    "downtime",
    "downtime",
    "Downtime & finances",
    "Banks and loans, training, recurring income, DM approval.",
  ],
  [
    "room",
    "together",
    "Play together",
    "Live and Turn-based rooms, invitations, guests, party chat.",
  ],
  [
    "journal",
    "library",
    "Journal & library",
    "Session reports, SRD lookups, your private PDF books.",
  ],
];

export function WelcomePage() {
  return (
    <Website>
      <SiteAnnouncement />
      <section className="ls-hero" aria-labelledby="welcome-title">
        <img className="ls-hero-art" src="/art/landscape.webp" alt="" />
        <div className="ls-hero-shade" />
        <div className="ls-wrap ls-hero-grid">
          <div className="ls-stack ls-hero-copy">
            <Link className="ls-release-pill" to="/updates" hash={`android-${release.version}`}>
              <span className="ls-sc">New</span> Android {release.version} is here{" "}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
            <Kicker>The party ledger for tabletop campaigns</Kicker>
            <h1 id="welcome-title" className="ls-display ls-display-hero">
              Split the loot. <em>Run the whole campaign.</em>
            </h1>
            <p className="ls-lead">
              Every coin, item and purchase lands in one shared ledger. Around it: character
              sheets, shops and trade, maps, encounters, downtime and live rooms for the whole
              party.
            </p>
            <div className="ls-actions">
              <AppLink className="ls-btn ls-btn-gold" href="/">
                {OPEN_APP}
              </AppLink>
              <Link className="ls-btn ls-btn-ghost" to="/features">
                Tour the features
              </Link>
            </div>
            <p className="ls-fine ls-free-line">100% free, supported by donations</p>
          </div>
          <Shot name="ledger" tone="ink" className="ls-hero-shot" />
        </div>
      </section>

      <section className="ls-paper" aria-label="At a glance">
        <div className="ls-wrap ls-ledger">
          <div className="ls-ledger-entry">
            <p className="ls-sc ls-entry-no">The treasury</p>
            <GoldSpentCounter />
          </div>
          <div className="ls-ledger-entry">
            <p className="ls-sc ls-entry-no">At the table</p>
            <p className="ls-ledger-title">Three ways to play</p>
            <p className="ls-ledger-note">
              Local at one table, Turn-based between sessions, or Live online. One party, a shared
              ledger.
            </p>
          </div>
          <div className="ls-ledger-entry">
            <p className="ls-sc ls-entry-no">Behind the screen</p>
            <p className="ls-ledger-title">The DM keeps the keys</p>
            <p className="ls-ledger-note">
              Access, permissions and anything that needs a ruling. Built for the table.
            </p>
          </div>
        </div>
      </section>

      <section className="ls-ink ls-section" aria-labelledby="loot">
        <div className="ls-wrap ls-split">
          <div className="ls-stack">
            <Kicker ornament>Where it all began</Kicker>
            <h2 id="loot" className="ls-display">
              Loot, settled <em>fairly.</em>
            </h2>
            <p className="ls-lead">
              Award the hoard after a fight, review it, and send it once to the characters or the
              party fund. From the first copper piece to a dragon’s hoard, every coin is recorded.
            </p>
            <ul className="ls-ticks">
              <li>Five coin denominations with conversion, payments and transfers</li>
              <li>Guaranteed items and weighted loot tables per encounter</li>
              <li>A review step before the one-time transfer, so nothing is paid twice</li>
              <li>Character purses, party funds and a full activity ledger with voiding</li>
            </ul>
          </div>
          <Shot name="loot" tone="ink" />
        </div>
      </section>

      <section className="ls-paper ls-section" aria-labelledby="areas">
        <div className="ls-wrap ls-stack ls-gap-xl">
          <div className="ls-stack ls-measure">
            <Kicker>Everything around the ledger</Kicker>
            <h2 id="areas" className="ls-display">
              Your campaign has grown. <span className="ls-block">So has Lootsplitter.</span>
            </h2>
            <p className="ls-lead">
              Eight connected parts, one campaign. Purchases, voyages, property income and loot all
              post to the same ledger.
            </p>
          </div>
          <ul className="ls-areas">
            {areas.map(([shot, anchor, title, text]) => (
              <li key={title}>
                <Link className="ls-area" to="/features" hash={anchor}>
                  <h3>{title}</h3>
                  <Shot name={shot} size="inset" />
                  <p>{text}</p>
                </Link>
              </li>
            ))}
          </ul>
          <Link className="ls-btn ls-btn-ink ls-self-center" to="/features">
            See every feature
          </Link>
        </div>
      </section>

      <section className="ls-ink ls-section" aria-labelledby="flow">
        <div className="ls-wrap ls-stack ls-gap-xl">
          <div className="ls-stack ls-center">
            <Kicker ornament>How a campaign flows</Kicker>
            <h2 id="flow" className="ls-display">
              Prepare. Play. <em>Pick up next time.</em>
            </h2>
          </div>
          <div className="ls-cols3">
            <article className="ls-step">
              <p className="ls-numeral" aria-hidden="true">
                I
              </p>
              <h3>Prepare</h3>
              <p>
                Create an account to host a campaign. Add characters and party funds, build
                locations, shops and maps, place NPCs, and stock encounters with loot tables.
              </p>
            </article>
            <article className="ls-step">
              <p className="ls-numeral" aria-hidden="true">
                II
              </p>
              <h3>Play</h3>
              <p>
                Invite players into a Live or Turn-based room; guests can join without an account.
                Run initiative, show the map on a TV, roll and chat, then award loot and shop at
                the market. Use physical dice with permitted manual results, or virtual rolls with
                recorded outcomes.
              </p>
            </article>
            <article className="ls-step">
              <p className="ls-numeral" aria-hidden="true">
                III
              </p>
              <h3>Between sessions</h3>
              <p>
                End the session to close access and keep the campaign with its DM, or keep the room
                online. Review loan interest, recurring revenue and expenses before settlement;
                property plans and shop schedules follow in-game days, with DM approval. The
                Journal keeps the story.
              </p>
            </article>
          </div>
          <p className="ls-fine ls-center">
            The DM can work offline on an owned device campaign; shared sessions need a
            connection.{" "}
            <Link to="/help">Explore the application guide</Link>.
          </p>
        </div>
      </section>

      <section className="ls-paper ls-section" aria-labelledby="roles">
        <div className="ls-wrap ls-stack ls-gap-xl">
          <h2 id="roles" className="ls-display ls-center">
            One app, two seats at the table
          </h2>
          <div className="ls-cols2">
            <div className="ls-card">
              <Kicker>For Dungeon Masters</Kicker>
              <h3>Run the world, not the spreadsheet</h3>
              <ul className="ls-ticks">
                <li>Review Inbox for payments, loans, imports and training</li>
                <li>Shops, exchanges, black markets and blacksmith commissions</li>
                <li>Encounter builder, initiative tracker and player display</li>
                <li>Permissions per character field, room and scene</li>
              </ul>
              <Link className="ls-btn ls-btn-ink ls-self-start" to="/account">
                Start a campaign
              </Link>
            </div>
            <div className="ls-card">
              <Kicker>For players</Kicker>
              <h3>Your character, your coin</h3>
              <ul className="ls-ticks">
                <li>Join from an invitation link, no account needed</li>
                <li>Character sheet with dice and roll history</li>
                <li>Bank, finances, properties and your own journal</li>
                <li>Barter with the party and chat in private</li>
              </ul>
              <Link className="ls-btn ls-btn-ink ls-self-start" to="/help" hash="first-campaign">
                How joining works
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="ls-ink ls-section" aria-labelledby="platforms">
        <div className="ls-wrap ls-stack ls-gap-lg">
          <div className="ls-stack ls-center">
            <Kicker ornament>Your ledger, within reach</Kicker>
            <h2 id="platforms" className="ls-display">
              Start in the browser, <em>or take it with you.</em>
            </h2>
          </div>
          <div className="ls-cols2">
            <div className="ls-card ls-card-ink">
              <Kicker>Browser · no download</Kicker>
              <h3>Always the latest version</h3>
              <p>
                Open Lootsplitter in your PC’s or phone’s browser. Open screens in separate windows
                across monitors, or cast the player display to a TV.
              </p>
              <AppLink className="ls-btn ls-btn-gold ls-self-start" href="/">
                {OPEN_APP}
              </AppLink>
            </div>
            <div className="ls-card ls-card-ink">
              <Kicker>Android 7.0+ · signed APK</Kicker>
              <h3>Version {release.version}</h3>
              <p>
                Take the Android app to your next session: device campaigns that work offline,
                native sharing and file saving.
              </p>
              <Link className="ls-btn ls-btn-gold ls-self-start" to="/downloads">
                Download for Android
              </Link>
            </div>
          </div>
          <div className="ls-band">
            <div>
              <Kicker>Your campaigns, close at hand</Kicker>
              <p>
                Sign in to save memberships, reusable character profiles, and private cloud
                backups when you choose. Guest play stays available.
              </p>
            </div>
            <Link className="ls-btn ls-btn-ghost" to="/account">
              My campaign library
            </Link>
          </div>
          <p className="ls-fine ls-center">
            Comparing the browser and Android apps?{" "}
            <Link to="/downloads" hash="platform-comparison">
              See Browser or Android
            </Link>
            .
          </p>
        </div>
      </section>
    </Website>
  );
}

export function HelpPage() {
  return (
    <Website>
      <PageHero kicker="The Lootsplitter field guide" title="A little help, adventurer.">
        <p className="ls-lead ls-measure">
          Menus, money, encounters and recovery. Find a topic and jump straight to the tool you
          need.
        </p>
        <p className="ls-fine">
          Still stuck, or have feedback? Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
        </p>
      </PageHero>
      <section className="ls-ink ls-section ls-section-tight">
        <div className="ls-wrap ls-reading">
          <HelpContent />
        </div>
      </section>
    </Website>
  );
}
