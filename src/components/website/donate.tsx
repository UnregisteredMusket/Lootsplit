import { useEffect, useState } from "react";
import { Heart, ArrowUpRight } from "lucide-react";
import { Website } from "./site";
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
    <Website>
      <section className="ls-wrap ls-section ls-reading">
        <p className="ls-eyebrow">A LITTLE SUPPORT GOES A LONG WAY</p>
        <h1>Support Lootsplit</h1>
        <p className="ls-intro">
          Enjoying your party’s ledger? Donations are an optional way to support ongoing development
          and hosting.
        </p>
        <article className="ls-platform ls-donation">
          <Heart size={32} />
          <h2>Keep the adventure going.</h2>
          <p>
            You can keep using Lootsplit without donating. Thank you for being part of the
            adventure.
          </p>
          {loading ? (
            <p role="status">Loading donation options…</p>
          ) : error ? (
            <div role="alert">
              <p>Donation options could not be loaded.</p>
              <button className="ls-button ls-secondary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          ) : url ? (
            <>
              <a className="ls-button" href={url} target="_blank" rel="noopener noreferrer">
                Make a donation <ArrowUpRight size={18} />
              </a>
              <p className="ls-small-copy">
                Opens {new URL(url).hostname} in a new tab. Payments are handled by that provider.
              </p>
            </>
          ) : (
            <p className="ls-notice">
              Donations aren’t open yet. Check back here for a donation link.
            </p>
          )}
        </article>
      </section>
    </Website>
  );
}
