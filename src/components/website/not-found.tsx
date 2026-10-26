import { Link } from "@tanstack/react-router";
import { AppLink } from "@/components/app-link";
import { OPEN_APP } from "@/lib/website/labels";
import { Website } from "./site";
import { PageHero } from "./parts";

/** The website-styled 404 (W-1): it never shows the app's title screen or sign-in gate. */
export function NotFoundPage() {
  return (
    <Website>
      <PageHero kicker="Page not found" title="This page wandered off">
        <p className="ls-lead ls-measure">
          The link may be old or mistyped. Nothing in your campaigns has changed.
        </p>
        <nav aria-label="Where to go next" className="ls-actions ls-not-found-actions">
          <Link className="ls-btn ls-btn-gold" to="/welcome">
            Home
          </Link>
          <Link className="ls-btn ls-btn-ghost" to="/help">
            Help
          </Link>
          <AppLink className="ls-btn ls-btn-ghost" href="/">
            {OPEN_APP}
          </AppLink>
        </nav>
      </PageHero>
    </Website>
  );
}
