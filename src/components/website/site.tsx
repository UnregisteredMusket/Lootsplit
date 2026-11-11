import { AppLink } from "@/components/app-link";
import { useReleaseIdentity } from "./release-identity";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import release from "@/lib/website/release.json";
import { OPEN_APP } from "@/lib/website/labels";
import { INSTAGRAM_URL, SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/website/contact";
import "./website.css";

/* The shared website chrome only. The home and help pages live in welcome-page.tsx and
 * help-page.tsx so their route chunks load only on those pages (audit F5, 2026-11-10): the root
 * route's 404 page uses this chrome, which kept every page's content in the shell. */

/** One order and one set of labels for the footer; the header shows the main four
 * (owner decision 2026-10-23: Changelog and Resources live in the footer). */
const siteLinks = [
  ["/features", "Features"],
  ["/downloads", "Downloads"],
  ["/updates", "Changelog"],
  ["/help", "Help"],
  ["/resources", "Resources"],
  ["/donate", "Donate"],
  ["/community", "Find a group"],
  ["/privacy", "Privacy"],
] as const;
/** Changelog, Resources and Privacy live in the footer only (owner decision 2026-10-23). */
const footerOnly = new Set<string>(["/updates", "/resources", "/privacy"]);
const headerLinks = siteLinks.filter(([to]) => !footerOnly.has(to));

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
          {/* The name keeps the visible wordmark and tagline (WCAG 2.5.3); phones show only the icon. */}
          <Link className="ls-brand" to="/welcome" aria-label="Lootsplitter, The Party Ledger: home">
            <img src="/brand/kobold-icon-128.png" alt="" width="40" height="40" />
            <span className="ls-brand-text">
              <span className="ls-brand-name">Lootsplitter</span>{" "}
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
              <li>
                <Link to="/welcome" aria-current={current("/welcome")}>
                  Home
                </Link>
              </li>
              {headerLinks.map(([to, label]) => (
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
              <li>
                <Link to="/welcome" aria-current={current("/welcome")}>
                  Home
                </Link>
              </li>
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
              <li>
                <a href={INSTAGRAM_URL} rel="noopener">
                  Instagram ↗
                </a>
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
