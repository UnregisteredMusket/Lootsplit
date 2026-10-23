import { Link } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { FEATURE_AREAS, type FeatureArea, type MajorFeature } from "@/lib/website/feature-catalog";
import { productShots } from "@/lib/website/product-shots";
import { DmTag, Kicker, PageHero, Shot } from "./parts";
import { Website } from "./site";

type Audience = "all" | "players" | "dm";
const AUDIENCES: [Audience, string][] = [
  ["all", "Everything"],
  ["players", "For players"],
  ["dm", "DM tools"],
];
const shows = (audience: Audience, dm?: boolean) =>
  audience === "all" || (audience === "dm" ? !!dm : !dm);

/** Every feature in one flat list, for search. */
const SEARCH_INDEX = FEATURE_AREAS.flatMap((area) => [
  ...area.major.map((f) => ({
    area,
    title: f.title,
    text: `${f.summary} ${f.details.join(" ")}`,
    major: true,
    dm: !!f.dm,
  })),
  ...area.minor.map((f) => ({ area, title: f.title, text: f.text, major: false, dm: !!f.dm })),
]);

function areaFromHash() {
  if (typeof window === "undefined") return FEATURE_AREAS[0]!.id;
  const id = window.location.hash.slice(1);
  return FEATURE_AREAS.some((a) => a.id === id) ? id : FEATURE_AREAS[0]!.id;
}

function Gallery({ area }: { area: FeatureArea }) {
  const [index, setIndex] = useState(0);
  const shot = area.shots[Math.min(index, area.shots.length - 1)]!;
  return (
    <div className="ls-feature-gallery">
      <Shot name={shot} tone="paper" />
      {area.shots.length > 1 && (
        <div className="ls-feature-thumbs" role="group" aria-label={`${area.title} screenshots`}>
          {area.shots.map((name, i) => (
            <button
              key={name}
              type="button"
              aria-pressed={i === index}
              aria-label={`Show screenshot ${i + 1} of ${area.shots.length}: ${productShots[name].alt}`}
              onClick={() => setIndex(i)}
            >
              <img src={`/product/${name}.webp`} alt="" loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MajorCard({
  feature,
  open,
  onToggle,
}: {
  feature: MajorFeature;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  return (
    <details
      className="ls-feature-card"
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        if (next !== open) onToggle(next);
      }}
      data-feature={feature.title}
    >
      <summary>
        <span className="ls-feature-card-title">
          {feature.title}
          {feature.dm && (
            <>
              {" "}
              <DmTag />
            </>
          )}
        </span>
        <span className="ls-feature-card-summary">{feature.summary}</span>
      </summary>
      <ul>
        {feature.details.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
    </details>
  );
}

/** Public feature tour. In-app screens stay at /features/$feature. */
export function FeaturesPage() {
  const [active, setActive] = useState(FEATURE_AREAS[0]!.id);
  const [audience, setAudience] = useState<Audience>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const tabsId = useId();
  const panelTop = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Deep links (#money, #maps, …) open their area; the home page links here by area.
  useEffect(() => {
    const sync = () => setActive(areaFromHash());
    sync();
    if (window.location.hash) panelTop.current?.scrollIntoView({ block: "start" });
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  function choose(id: string, focus = false) {
    setActive(id);
    history.replaceState(null, "", `#${id}`);
    if (focus) tabRefs.current[id]?.focus();
  }

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = FEATURE_AREAS.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? index === last
          ? 0
          : index + 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? index === 0
            ? last
            : index - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    choose(FEATURE_AREAS[next]!.id, true);
  }

  const q = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      q.length < 2
        ? []
        : SEARCH_INDEX.filter(
            (f) =>
              shows(audience, f.dm) &&
              `${f.title} ${f.text} ${f.area.title}`.toLowerCase().includes(q),
          ).slice(0, 12),
    [q, audience],
  );

  function openResult(areaId: string, title: string, major: boolean) {
    choose(areaId);
    if (major) setOpen((o) => ({ ...o, [`${areaId}/${title}`]: true }));
    setQuery("");
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `#${areaId}-panel [data-feature="${CSS.escape(title)}"]`,
      );
      el?.scrollIntoView({ block: "center" });
      el?.querySelector<HTMLElement>("summary, b")?.focus();
    });
  }

  const totals = useMemo(
    () => ({
      major: FEATURE_AREAS.reduce((n, a) => n + a.major.length, 0),
      minor: FEATURE_AREAS.reduce((n, a) => n + a.minor.length, 0),
    }),
    [],
  );

  return (
    <Website footer="ink">
      <PageHero kicker="The whole campaign" title="Features">
        <p className="ls-lead ls-measure">
          It started with splitting loot. Now the ledger sits at the center of everything your
          table tracks, from the first copper piece to a fleet of ships. Every feature is free.
        </p>
        <p className="ls-fine">
          {totals.major} major features and {totals.minor} smaller ones in {FEATURE_AREAS.length}{" "}
          areas. <DmTag /> marks tools for the Dungeon Master.
        </p>
      </PageHero>

      <section className="ls-paper ls-section ls-section-tight" aria-label="Feature explorer">
        <div className="ls-wrap ls-stack ls-gap-lg" ref={panelTop}>
          <div className="ls-feature-tools">
            <label className="ls-feature-search">
              <span>Find a feature</span>
              <input
                type="search"
                value={query}
                placeholder="Try “fog”, “loans” or “barter”"
                maxLength={60}
                onChange={(e) => setQuery(e.target.value)}
                aria-controls={`${tabsId}-results`}
              />
            </label>
            <div className="ls-feature-audience" role="radiogroup" aria-label="Show features for">
              {AUDIENCES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={audience === value}
                  onClick={() => setAudience(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div id={`${tabsId}-results`} aria-live="polite" className="ls-feature-results-slot">
            {q.length >= 2 && (
              <div className="ls-feature-results">
                <p className="ls-fine">
                  {results.length === 0
                    ? "No features match. Try a shorter word."
                    : `${results.length} match${results.length === 1 ? "" : "es"}`}
                </p>
                <ul>
                  {results.map((r) => (
                    <li key={`${r.area.id}/${r.title}`}>
                      <button type="button" onClick={() => openResult(r.area.id, r.title, r.major)}>
                        <b>{r.title}</b> <span className="ls-fine">in {r.area.title}</span>
                        {r.dm && (
                          <>
                            {" "}
                            <DmTag />
                          </>
                        )}
                        <span className="ls-feature-result-text">{r.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <nav aria-label="Feature areas" className="ls-feature-tabs-wrap">
            <div role="tablist" aria-label="Feature areas" className="ls-feature-tabs">
              {FEATURE_AREAS.map((area, i) => (
                <button
                  key={area.id}
                  ref={(el) => {
                    tabRefs.current[area.id] = el;
                  }}
                  id={`${area.id}-tab`}
                  role="tab"
                  type="button"
                  aria-selected={active === area.id}
                  aria-controls={`${area.id}-panel`}
                  tabIndex={active === area.id ? 0 : -1}
                  data-href={`#${area.id}`}
                  onClick={() => choose(area.id)}
                  onKeyDown={(e) => onTabKey(e, i)}
                >
                  {area.chip}
                </button>
              ))}
            </div>
          </nav>

          {FEATURE_AREAS.map((area) => {
            const major = area.major.filter((f) => shows(audience, f.dm));
            const minor = area.minor.filter((f) => shows(audience, f.dm));
            const allOpen = major.length > 0 && major.every((f) => open[`${area.id}/${f.title}`]);
            return (
              <section
                key={area.id}
                id={`${area.id}-panel`}
                role="tabpanel"
                aria-labelledby={`${area.id}-tab`}
                hidden={active !== area.id}
                className="ls-feature-panel"
              >
                <div className="ls-feature-panel-head">
                  <Gallery area={area} />
                  <div className="ls-stack">
                    <Kicker>
                      {area.major.length} major · {area.minor.length} more
                    </Kicker>
                    <h2 id={area.id} className="ls-display ls-anchor">
                      {area.title}
                    </h2>
                    <p className="ls-lead">{area.lead}</p>
                    {area.id === "platforms" && (
                      <Link className="ls-btn ls-btn-ink ls-self-start" to="/downloads">
                        Compare Browser and Android
                      </Link>
                    )}
                  </div>
                </div>

                {major.length > 0 && (
                  <>
                    <div className="ls-feature-subhead">
                      <h3>Major features</h3>
                      <button
                        type="button"
                        className="ls-feature-toggle"
                        onClick={() =>
                          setOpen((o) => ({
                            ...o,
                            ...Object.fromEntries(
                              major.map((f) => [`${area.id}/${f.title}`, !allOpen]),
                            ),
                          }))
                        }
                      >
                        {allOpen ? "Collapse all" : "Expand all"}
                      </button>
                    </div>
                    <div className="ls-feature-cards">
                      {major.map((f) => (
                        <MajorCard
                          key={f.title}
                          feature={f}
                          open={!!open[`${area.id}/${f.title}`]}
                          onToggle={(next) =>
                            setOpen((o) => ({ ...o, [`${area.id}/${f.title}`]: next }))
                          }
                        />
                      ))}
                    </div>
                  </>
                )}
                {minor.length > 0 && (
                  <>
                    <div className="ls-feature-subhead">
                      <h3>Also included</h3>
                    </div>
                    <ul className="ls-feature-minor">
                      {minor.map((f) => (
                        <li key={f.title} data-feature={f.title}>
                          <b tabIndex={-1}>{f.title}</b>
                          {f.dm && (
                            <>
                              {" "}
                              <DmTag />
                            </>
                          )}
                          <span className="ls-feature-minor-text">{f.text}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {major.length + minor.length === 0 && (
                  <p className="ls-fine">Nothing in this area matches that filter.</p>
                )}
              </section>
            );
          })}
        </div>
      </section>
    </Website>
  );
}
