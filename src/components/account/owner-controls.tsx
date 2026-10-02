import { useEffect, useState, type FormEvent } from "react";
import { accountRequest } from "@/lib/account/client";

type OwnerData = {
  stats: {
    accounts: number;
    sharedCampaigns: number;
    savedMemberships: number;
    cloudBackups: number;
    characterProfiles: number;
  };
  settings: {
    title: string;
    message: string;
    published: number;
    revision: number;
    updated_at: number;
    donation_url: string;
    donation_revision: number;
  };
};
export function OwnerControls() {
  const [data, setData] = useState<OwnerData | null>(null);
  const [donationUrl, setDonationUrl] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const next = await accountRequest<OwnerData>("owner");
    setData(next);
    setTitle(next.settings.title);
    setDonationUrl(next.settings.donation_url);
    setMessage(next.settings.message);
  }
  useEffect(() => {
    let alive = true;
    accountRequest<OwnerData>("owner")
      .then((next) => {
        if (alive) {
          setData(next);
          setTitle(next.settings.title);
          setDonationUrl(next.settings.donation_url);
          setMessage(next.settings.message);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function save(published: boolean) {
    if (!data || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await accountRequest<{ revision: number }>("owner/announcement", {
        title,
        message,
        published,
        revision: data.settings.revision,
      });
      setData({
        ...data,
        settings: {
          ...data.settings,
          title: title.trim(),
          message: message.trim(),
          published: published ? 1 : 0,
          revision: result.revision,
          updated_at: Date.now(),
        },
      });
      setNotice(
        published
          ? "Announcement published on the homepage."
          : "Announcement is hidden. Your draft is saved.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the announcement.");
    } finally {
      setBusy(false);
    }
  }
  async function saveDonation(event: FormEvent) {
    event.preventDefault();
    if (!data || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await accountRequest<{ donationUrl: string; revision: number }>(
        "owner/donations",
        { donationUrl, revision: data.settings.donation_revision },
      );
      setDonationUrl(next.donationUrl);
      setData({
        ...data,
        settings: {
          ...data.settings,
          donation_url: next.donationUrl,
          donation_revision: next.revision,
        },
      });
      setNotice(
        next.donationUrl
          ? "Donation link is live on the Donate page."
          : "Donations are hidden until you add a link.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the donation link.");
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void save(true);
  }
  return (
    <section className="portal-card owner-controls" aria-labelledby="owner-title">
      <p className="portal-eyebrow">SITE OWNER</p>
      <h2 id="owner-title">Owner controls</h2>
      <p>
        Manage public announcements and see site totals. Campaign permissions and private account
        libraries keep their existing protections.
      </p>
      {error && (
        <p role="alert" className="portal-message error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="portal-message">
          {notice}
        </p>
      )}
      <button
        type="button"
        className="portal-button secondary"
        disabled={busy}
        onClick={() => {
          setError("");
          setBusy(true);
          void load()
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Reload owner panel
      </button>
      {!data ? (
        <p>Owner overview is loading. If it fails, use Reload owner panel to try again.</p>
      ) : (
        <>
          <dl className="owner-stats">
            {[
              ["Accounts", data.stats.accounts],
              ["Shared campaigns", data.stats.sharedCampaigns],
              ["Saved memberships", data.stats.savedMemberships],
              ["Cloud backups", data.stats.cloudBackups],
              ["Character profiles", data.stats.characterProfiles],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{Number(value).toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          <form onSubmit={saveDonation} className="owner-form">
            <h3>Donations</h3>
            <p>
              Paste your hosted PayPal, Ko-fi, or other donation page. Visitors complete payments
              with that provider. Leave this empty to keep donations closed.
            </p>
            <label>
              Donation page URL
              <input
                type="url"
                placeholder="https://"
                maxLength={2000}
                value={donationUrl}
                disabled={busy}
                onChange={(e) => setDonationUrl(e.target.value)}
              />
            </label>
            <button type="submit" className="portal-button" disabled={busy}>
              Save donation link
            </button>
          </form>
          <form onSubmit={submit} className="owner-form">
            <h3>Homepage announcement</h3>
            <p>
              Current status: <strong>{data.settings.published ? "Published" : "Hidden"}</strong>.
              Text is displayed as written, without HTML formatting.
            </p>
            <label>
              Announcement title
              <input
                value={title}
                maxLength={100}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Announcement message
              <textarea
                aria-label="Announcement message"
                value={message}
                maxLength={2000}
                rows={5}
                disabled={busy}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            <div className="portal-actions">
              <button
                className="portal-button"
                type="submit"
                disabled={busy || !title.trim() || !message.trim()}
              >
                Publish announcement
              </button>
              <button
                className="portal-button secondary"
                type="button"
                disabled={busy}
                onClick={() => void save(false)}
              >
                Save draft / hide announcement
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
