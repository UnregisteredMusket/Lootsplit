import { AppLink } from "@/components/app-link";
import { TreasuryEntry } from "./gold-counter";
import { SiteAnnouncement } from "./announcement";
import { AreasCarousel, type Area } from "./areas-carousel";
import { PromoVideo } from "./promo-video";
import { Kicker, Shot } from "./parts";
import { Website } from "./site";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Dices, Link2, UserRound } from "lucide-react";
import release from "@/lib/website/release.json";
import { OPEN_APP } from "@/lib/website/labels";

const areas: Area[] = [
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
    "maps",
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

/** "How joining works", shown in place on the home page (Q35): three steps, no detour to Help. */
const JOIN_STEPS = [
  [Link2, "Get the link", "Your DM sends an invitation link or code."],
  [UserRound, "Pick your character", "Open it, type your name and choose the character your DM set up."],
  [Dices, "Play", "Your sheet, coins and party chat are ready. No account needed."],
] as const;

function JoinSteps() {
  return (
    <div className="ls-join">
      <h4 id="join-steps" className="ls-sc">
        How joining works
      </h4>
      <ol className="ls-join-steps" aria-labelledby="join-steps">
        {JOIN_STEPS.map(([Icon, title, text], index) => (
          <li key={title}>
            <span className="ls-join-icon" aria-hidden="true">
              <Icon size={22} />
              <span className="ls-join-no">{index + 1}</span>
            </span>
            <span className="ls-join-text">
              <strong>{title}</strong>
              <span>{text}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function WelcomePage() {
  return (
    <Website>
      <SiteAnnouncement />
      <section className="ls-hero" aria-labelledby="welcome-title">
        <img className="ls-hero-art" src="/art/landscape.webp" alt="" fetchPriority="high" />
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
          <PromoVideo />
        </div>
      </section>

      <section className="ls-paper ls-section" aria-labelledby="loot">
        <div className="ls-wrap ls-split">
          <div className="ls-stack">
            <Kicker ornament>Where it all began</Kicker>
            <h2 id="loot" className="ls-display">
              Loot, settled <em>fairly.</em>
            </h2>
            <p className="ls-lead">
              Award the hoard after a fight, review it, and send it once to one purse or split the
              coins evenly across the party. Every coin is recorded, down to the copper.
            </p>
            <ul className="ls-ticks">
              <li>Five coin denominations with conversion, payments and transfers</li>
              <li>Guaranteed items and weighted loot tables per encounter</li>
              <li>Even coin splits to the copper, with the leftover sent where you choose</li>
              <li>A party treasure pool: claim Need, Greed or Pass, and the DM resolves fairly</li>
              <li>A review step before the one-time transfer, so nothing is paid twice</li>
              <li>Character purses, party funds and a full activity ledger with voiding</li>
            </ul>
          </div>
          <Shot name="loot" tone="paper" />
        </div>
      </section>

      <section className="ls-ink ls-section" aria-labelledby="why">
        <div className="ls-wrap ls-measure ls-stack ls-gap-lg ls-why">
          <img
            className="ls-why-mascot"
            src="/brand/mascot-chase.webp"
            alt="A grinning kobold sprints off with a giant gold coin while an exasperated fighter lunges after it."
            width={1200}
            height={859}
            loading="lazy"
            decoding="async"
          />
          <div className="ls-stack ls-center">
            <Kicker ornament>A note from the maker</Kicker>
            <h2 id="why" className="ls-display">
              Why did I create Lootsplitter?
            </h2>
          </div>
          <p>
            I really hate shopping episodes. You know the ones: they follow the party comically
            killing your BBEG with no plan at all, which loads them up with a pile of treasure.
            Then they spend the next two or three sessions arguing with multiple shopkeepers,
            splitting hairs over 2 copper pieces to get a cool new hat for their pet monkey named
            “Bingo”.
          </p>
          <p>
            <strong>That’s why I created Lootsplitter: to save you time, and to smite shopping episodes forever.</strong>{" "}
            Manage your party, build encounters and assign loot, and set up shops for your players
            to interact with, eliminating paper inventory sheets in your campaign.
          </p>
          <p>
            Plus… Open5e integration, service features such as blacksmithing, a bartering system,
            property listings, a fully integrated map system with fog of war, and so much more!
          </p>
          <p>
            Free to use, with no ads of any kind.{" "}
            <AppLink href="/">Open the app</AppLink> or{" "}
            <Link to="/downloads">download it for Android</Link>.
          </p>
          <p className="ls-why-signature">— UnregisteredMusket</p>
        </div>
      </section>

      <section className="ls-paper ls-section" aria-labelledby="areas">
        <div className="ls-wrap ls-stack ls-gap-xl">
          <div className="ls-stack ls-measure">
            <Kicker>Everything around the ledger</Kicker>
            <h2 id="areas" className="ls-display">
              Eight parts of one campaign
            </h2>
            <p className="ls-lead">
              Purchases, voyages, property income and loot all post to the same ledger.
            </p>
          </div>
          <AreasCarousel areas={areas} />
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
            <Link to="/help">Read the Help guide</Link>.
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
              <h3>Shops, combat and approvals</h3>
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
              <JoinSteps />
              <Link
                className="ls-btn ls-btn-ink ls-self-start"
                to="/help"
                search={{ guide: "player" } as never}
                hash="first-campaign"
              >
                More in the player guide
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="ls-paper" aria-label="At a glance">
        <div className="ls-wrap ls-ledger">
          <TreasuryEntry />
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
              The DM controls access and permissions, and approves anything that needs a ruling.
            </p>
          </div>
        </div>
      </section>

      <section className="ls-ink ls-section" aria-labelledby="platforms">
        <div className="ls-wrap ls-stack ls-gap-lg">
          <div className="ls-stack ls-center">
            <Kicker ornament>Browser and Android</Kicker>
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
              <Kicker>With an account</Kicker>
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
