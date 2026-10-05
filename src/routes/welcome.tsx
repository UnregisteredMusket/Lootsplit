import { WelcomePage } from "@/components/website/site";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Coins, Download, Monitor, ShieldCheck, Users } from "lucide-react";
export const Route = createFileRoute("/welcome")({ component: WelcomePage });
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
        <Link to="/resources">Resources</Link>
        <Link to="/donate">Donate</Link>
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
      <Link to="/share">
        Join a session as guest
      </Link>
    </footer>
  );
}
