import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Website } from "./site";
import { Kicker, PageHero } from "./parts";
import {
  GAME_SUGGESTIONS,
  LOOKING_FOR_LABEL,
  PLAY_ROLE_LABEL,
  loadCommunityProfile,
  loadDirectory,
  localTimeIn,
  reportProfile,
  timeZones,
  type CommunityDirectory,
  type CommunityFilters,
  type CommunityProfile,
} from "@/lib/account/community";
import { DISCORD_INVITE } from "@/lib/website/contact";

function Portrait({ profile, size }: { profile: CommunityProfile; size: number }) {
  return profile.portrait ? (
    <img
      className="ls-member-portrait"
      src={profile.portrait}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
    />
  ) : (
    <span className="ls-member-portrait ls-member-initial" style={{ width: size, height: size }} aria-hidden="true">
      {profile.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function Badges({ profile }: { profile: CommunityProfile }) {
  return (
    <p className="ls-member-badges">
      {profile.play_role && <span className="ls-badge">{PLAY_ROLE_LABEL[profile.play_role]}</span>}
      {profile.lfg && <span className="ls-badge ls-badge-gold">{LOOKING_FOR_LABEL[profile.lfg]}</span>}
    </p>
  );
}

function DiscordJoin() {
  if (!DISCORD_INVITE) return null;
  return (
    <p className="ls-fine">
      Chat, plan sessions and meet other tables on the{" "}
      <a href={DISCORD_INVITE} rel="noopener">
        Lootsplitter Discord ↗
      </a>
      .
    </p>
  );
}

/** /community — the Looking for Group directory. */
export function CommunityPage() {
  const [filters, setFilters] = useState<CommunityFilters>({});
  const [form, setForm] = useState<CommunityFilters>({});
  const [data, setData] = useState<CommunityDirectory | null>(null);
  const [more, setMore] = useState<CommunityProfile[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const zones = useMemo(() => timeZones(), []);

  useEffect(() => {
    // Ignore a superseded answer instead of aborting it, so no request is cut off mid-flight.
    let alive = true;
    setLoading(true);
    setError("");
    loadDirectory(filters)
      .then((next) => {
        if (!alive) return;
        setData(next);
        setMore((prev) => (filters.offset ? [...prev, ...next.profiles] : next.profiles));
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Could not load the directory.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [filters]);

  function search(e: FormEvent) {
    e.preventDefault();
    setFilters({ ...form, offset: 0 });
  }

  return (
    <Website>
      <PageHero kicker="Looking for group" title="Find your" accent="party.">
        <p className="ls-lead ls-measure">
          Dungeon Masters looking for players and players looking for a table. Make a profile from
          your account, choose who can see it, and find each other here.
        </p>
        <DiscordJoin />
      </PageHero>
      <section className="ls-paper ls-section ls-section-tight" aria-labelledby="community-results">
        <div className="ls-wrap ls-stack ls-gap-lg">
          <form className="ls-community-filters" onSubmit={search} aria-label="Filter profiles">
            <label>
              Role
              <select value={form.role ?? ""} onChange={(e) => setForm({ ...form, role: e.target.value as CommunityFilters["role"] })}>
                <option value="">Anyone</option>
                <option value="dm">Dungeon Masters</option>
                <option value="player">Players</option>
              </select>
            </label>
            <label>
              Looking for
              <select value={form.lfg ?? ""} onChange={(e) => setForm({ ...form, lfg: e.target.value as CommunityFilters["lfg"] })}>
                <option value="">Any</option>
                <option value="players">Looking for players</option>
                <option value="group">Looking for a group</option>
              </select>
            </label>
            <label>
              Game
              <input list="community-filter-games" value={form.game ?? ""} maxLength={30} onChange={(e) => setForm({ ...form, game: e.target.value })} />
              <datalist id="community-filter-games">
                {GAME_SUGGESTIONS.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </label>
            <label>
              Time zone
              <select value={form.tz ?? ""} onChange={(e) => setForm({ ...form, tz: e.target.value })}>
                <option value="">Any</option>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name
              <input value={form.q ?? ""} maxLength={60} onChange={(e) => setForm({ ...form, q: e.target.value })} />
            </label>
            <button className="ls-btn ls-btn-ink" type="submit">
              Search
            </button>
          </form>
          <h2 id="community-results" className="ls-visually-hidden">
            Profiles
          </h2>
          {error && (
            <p role="alert" className="ls-community-error">
              {error}{" "}
              <button className="ls-btn ls-btn-ghost-paper" onClick={() => setFilters({ ...filters })}>
                Try again
              </button>
            </p>
          )}
          {data && (
            <p role="status" className="ls-fine">
              {data.total === 0
                ? "No profiles match yet."
                : `${data.total} profile${data.total === 1 ? "" : "s"}`}
              {!data.signedIn && " · Sign in to also see members-only profiles."}
            </p>
          )}
          <ul className="ls-member-grid">
            {more.map((p) => (
              <li key={p.handle}>
                <Link className="ls-member-card" to="/community/$handle" params={{ handle: p.handle }}>
                  <Portrait profile={p} size={64} />
                  <div className="ls-stack">
                    <h3>{p.name}</h3>
                    <p className="ls-fine">@{p.handle}</p>
                    <Badges profile={p} />
                    {p.games.length > 0 && <p className="ls-member-games">{p.games.join(" · ")}</p>}
                    {p.time_zone && (
                      <p className="ls-fine">
                        {p.time_zone.replaceAll("_", " ")} · now {localTimeIn(p.time_zone)}
                      </p>
                    )}
                    {p.lfg_note && <p className="ls-member-note">{p.lfg_note}</p>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {data && more.length < data.total && (
            <button
              className="ls-btn ls-btn-ink ls-self-center"
              disabled={loading}
              onClick={() => setFilters({ ...filters, offset: more.length })}
            >
              {loading ? "Loading…" : "Show more"}
            </button>
          )}
          {loading && !data && <p role="status">Loading profiles…</p>}
          <div className="ls-band ls-band-paper">
            <div>
              <Kicker>Your profile</Kicker>
              <p>
                Add your games, time zone and what you are looking for. Profiles are hidden until
                you choose who can see them.
              </p>
            </div>
            <Link className="ls-btn ls-btn-ink" to="/account" hash="account-community">
              Set up my profile
            </Link>
          </div>
        </div>
      </section>
    </Website>
  );
}

/** /community/$handle — one member's profile. */
export function CommunityProfilePage({ handle }: { handle: string }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "missing" }
    | { kind: "error"; message: string }
    | { kind: "ready"; profile: CommunityProfile; self: boolean; signedIn: boolean }
  >({ kind: "loading" });
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [reportNotice, setReportNotice] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    loadCommunityProfile(handle)
      .then((r) => {
        if (alive) setState({ kind: "ready", ...r });
      })
      .catch((e: Error & { status?: number }) => {
        if (!alive) return;
        setState(
          e.status === 404 || /No profile/.test(e.message)
            ? { kind: "missing" }
            : { kind: "error", message: e.message || "Could not load this profile." },
        );
      });
    return () => {
      alive = false;
    };
  }, [handle]);

  async function report(e: FormEvent) {
    e.preventDefault();
    try {
      await reportProfile(handle, reason);
      setReporting(false);
      setReason("");
      setReportNotice("Thanks. Site staff will review this profile.");
    } catch (err) {
      setReportNotice(err instanceof Error ? err.message : "Could not send the report.");
    }
  }

  if (state.kind !== "ready")
    return (
      <Website>
        <PageHero kicker="Looking for group" title={state.kind === "loading" ? "Loading profile…" : "Profile not found"}>
          {state.kind === "missing" && (
            <p className="ls-lead ls-measure">
              There is no profile at this address, or it is not visible to you. Members choose who
              can see their profile; some are for signed-in members only.
            </p>
          )}
          {state.kind === "error" && (
            <p role="alert" className="ls-lead ls-measure">
              {state.message}
            </p>
          )}
          <Link className="ls-btn ls-btn-gold" to="/community">
            Back to the directory
          </Link>
        </PageHero>
      </Website>
    );

  const p = state.profile;
  return (
    <Website>
      <section className="ls-ink ls-page-hero" aria-labelledby="member-name">
        <div className="ls-wrap ls-member-hero">
          <Portrait profile={p} size={128} />
          <div className="ls-stack">
            <Kicker>Looking for group</Kicker>
            <h1 id="member-name" className="ls-display">
              {p.name}
            </h1>
            <p className="ls-fine">@{p.handle}</p>
            <Badges profile={p} />
          </div>
        </div>
      </section>
      <section className="ls-paper ls-section ls-section-tight">
        <div className="ls-wrap ls-reading ls-member-detail">
          {state.self && (
            <p className="ls-band ls-band-paper">
              This is your profile.{" "}
              <Link to="/account" hash="account-community">
                Edit it in My account
              </Link>
              .
            </p>
          )}
          {p.lfg_note && (
            <>
              <h2>{LOOKING_FOR_LABEL[p.lfg] || "Note"}</h2>
              <p>{p.lfg_note}</p>
            </>
          )}
          {p.introduction && (
            <>
              <h2>About</h2>
              <p className="ls-member-intro">{p.introduction}</p>
            </>
          )}
          <h2>Table details</h2>
          <dl className="ls-meta">
            <dt>Games</dt>
            <dd>{p.games.length ? p.games.join(", ") : "Not listed"}</dd>
            <dt>Time zone</dt>
            <dd>
              {p.time_zone
                ? `${p.time_zone.replaceAll("_", " ")} (now ${localTimeIn(p.time_zone)})`
                : "Not listed"}
            </dd>
            <dt>Usual play times</dt>
            <dd>{p.play_times || "Not listed"}</dd>
            <dt>Discord</dt>
            <dd>
              {p.discord ? (
                <>
                  <code>{p.discord}</code>{" "}
                  <button
                    className="ls-btn ls-btn-ghost-paper ls-btn-small"
                    onClick={() =>
                      void navigator.clipboard?.writeText(p.discord).then(() => setCopied(true))
                    }
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </>
              ) : (
                "Not listed"
              )}
            </dd>
            <dt>Member since</dt>
            <dd>{new Date(p.member_since).toLocaleDateString(undefined, { year: "numeric", month: "long" })}</dd>
          </dl>
          <DiscordJoin />
          <p>
            <Link to="/community">← Back to the directory</Link>
          </p>
          {!state.self && state.signedIn && (
            <div className="ls-member-report">
              {reportNotice && <p role="status">{reportNotice}</p>}
              {reporting ? (
                <form onSubmit={report} className="ls-stack">
                  <label>
                    What is wrong with this profile?
                    <textarea required minLength={3} maxLength={500} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </label>
                  <div className="ls-actions">
                    <button className="ls-btn ls-btn-ink" type="submit">
                      Send report
                    </button>
                    <button className="ls-btn ls-btn-ghost-paper" type="button" onClick={() => setReporting(false)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button className="ls-text-button" onClick={() => setReporting(true)}>
                  Report this profile
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </Website>
  );
}
