import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Coins, Download, Monitor, ShieldCheck, Users } from "lucide-react";
export const Route = createFileRoute("/welcome")({ component: Welcome });
export function SiteHeader() {
  return (
    <header className="portal-header">
      <Link to="/welcome" className="portal-brand">
        <Coins size={26} /> Lootsplit
      </Link>
      <nav aria-label="Website">
        <Link to="/downloads">Downloads</Link>
        <Link to="/updates">Changelog</Link>
        <Link to="/help">Help</Link>
        <Link to="/account">My account</Link>
        <Link to="/" search={{ view: "home" }} className="portal-button small">
          Open app <ArrowRight size={16} />
        </Link>
      </nav>
    </header>
  );
}
export function SiteFooter() {
  return (
    <footer className="portal-footer">
      <span>Lootsplit · More adventure. Less arithmetic.</span>
      <Link to="/downloads">Releases & help</Link>
      <Link to="/" search={{ view: "home" }}>
        Continue as guest
      </Link>
    </footer>
  );
}
function Welcome() {
  return (
    <div className="portal">
      <SiteHeader />
      <main>
        <section className="portal-hero">
          <div>
            <p className="portal-eyebrow">FOR THE PARTY. FOR THE STORY.</p>
            <h1>
              Keep the loot.
              <br />
              <em>Lose the paperwork.</em>
            </h1>
            <p className="portal-lead">
              Your party’s treasury, shops, characters and shared campaign ledger, together in one
              place. Built for the moments between adventures.
            </p>
            <div className="portal-actions">
              <Link to="/" search={{ view: "home" }} className="portal-button">
                Open browser app <ArrowRight size={19} />
              </Link>
              <Link to="/downloads" className="portal-button secondary">
                <Download size={19} /> Get Lootsplit
              </Link>
            </div>
            <p className="portal-subtle">
              Play as a guest, or sign in to keep your campaigns close.
            </p>
          </div>
          <div className="portal-ledger" aria-label="Lootsplit campaign features">
            <span className="portal-eyebrow">THE ADVENTURER’S LEDGER</span>
            <Coins size={72} strokeWidth={1} />
            <h2>Every coin has a story.</h2>
            <div>
              <span>Party treasury</span>
              <strong>Share the spoils</strong>
            </div>
            <div>
              <span>Shops & inventory</span>
              <strong>Find your next upgrade</strong>
            </div>
            <div>
              <span>Campaign history</span>
              <strong>Remember the journey</strong>
            </div>
            <span className="portal-ledger-seal">ONE PARTY · ONE LEDGER</span>
          </div>
        </section>
        <section className="portal-features">
          <article>
            <Users />
            <h2>Your table, together</h2>
            <p>
              Live and turn-based play with separate DM and player permissions. Keep manual sharing
              when your table needs it.
            </p>
          </article>
          <article>
            <ShieldCheck />
            <h2>A place for your campaigns</h2>
            <p>
              Save memberships to your account, return to your seat, and make private cloud backups
              when you choose.
            </p>
            <Link to="/account">Create your account →</Link>
          </article>
          <article>
            <Monitor />
            <h2>At home or on the road</h2>
            <p>
              Play in your browser, install the desktop web app, or download the signed Android app.
              Local play stays available.
            </p>
          </article>
        </section>
        <section className="portal-callout">
          <div>
            <p className="portal-eyebrow">ALREADY ADVENTURING?</p>
            <h2>Your existing campaign stays yours.</h2>
            <p>
              Open the app at its usual address. Sign-in is optional. Save a membership or cloud
              backup from your account when you’re ready.
            </p>
          </div>
          <Link to="/account" className="portal-button secondary">
            My campaign library <ArrowRight size={18} />
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
