import { useEffect, useState } from "react";
import { Heart, ArrowUpRight } from "lucide-react";
import { Website } from "./site";
import { PageHero } from "./parts";
import { accountRequest } from "@/lib/account/client";
export function DonatePage() {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    accountRequest<{ donationUrl: string | null }>("site-donations")
      .then((data) => {
        if (alive) setUrl(data.donationUrl);
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);
  return (
    <Website footer="ink">
      <PageHero kicker="A little support goes a long way" title="Support Lootsplitter">
        <p className="ls-lead ls-measure">
          For the price of one coffee, you can help support the development of Lootsplitter.
          Donations keep it free for every table and pay for hosting.
        </p>
      </PageHero>
      <section className="ls-paper ls-section ls-section-tight" aria-labelledby="donate-title">
        <div className="ls-wrap ls-narrow">
          <article className="ls-card ls-card-raised ls-donation">
            <Heart size={32} aria-hidden="true" className="ls-card-icon" />
            <h2 id="donate-title">Keep the adventure going.</h2>
            <p>
              You can keep using Lootsplitter without donating. Thank you for being part of the
              adventure.
            </p>
            {loading ? (
              <p role="status">Loading donation options…</p>
            ) : error ? (
              <div role="alert" className="ls-stack">
                <p>Donation options could not be loaded.</p>
                <button
                  className="ls-btn ls-btn-ink ls-self-start"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  Try again
                </button>
              </div>
            ) : url ? (
              <>
                <a
                  className="ls-btn ls-btn-ink ls-self-start"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Make a donation <ArrowUpRight size={18} aria-hidden="true" />
                </a>
                <p className="ls-fine">
                  Opens {new URL(url).hostname} in a new tab. Payments are handled by that provider.
                </p>
              </>
            ) : (
              <p className="ls-notice ls-notice-plain">
                Donations aren’t open yet. Check back here for a donation link.
              </p>
            )}
          </article>
        </div>
      </section>
    </Website>
  );
}
