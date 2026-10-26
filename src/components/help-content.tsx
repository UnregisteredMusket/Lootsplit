import { useEffect, useId, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { HELP_GROUPS, topicMatches } from "@/lib/help/content";
import { PLAYER_HELP_GROUPS } from "@/lib/help/player-content";
import { guideForHash, guideFromSearch, type HelpGuide } from "@/lib/help/guide-choice";
import { useSeat, useSeatKnown } from "@/lib/quire/seat";
import { AppLink } from "./app-link";
import "./help-content.css";

const GUIDE_SOURCES: Record<HelpGuide, typeof HELP_GROUPS> = {
  // The player guide carries no DM setup links; only the shared install topics join it.
  player: [...PLAYER_HELP_GROUPS, ...HELP_GROUPS.filter((g) => g.id === "install")],
  dm: HELP_GROUPS,
};

export function HelpContent({
  embedded = false,
  onNavigate,
}: {
  embedded?: boolean;
  onNavigate?: () => void;
}) {
  const seat = useSeat(),
    known = useSeatKnown();
  const hash = useRouterState({ select: (s) => s.location.hash });
  const searchGuide = useRouterState({ select: (s) => guideFromSearch(s.location.search) });
  const navigate = useNavigate();
  // In the app the guide follows the seat; the public Help page defaults to the DM guide, and
  // `?guide=player|dm` (or a link to a player-only topic) picks one (W-3).
  const [embeddedChoice, setEmbeddedChoice] = useState<HelpGuide | null>(null);
  const guide: HelpGuide | null = embedded
    ? (embeddedChoice ?? (known ? (seat.role === "player" ? "player" : "dm") : null))
    : (searchGuide ?? guideForHash(hash, GUIDE_SOURCES) ?? "dm");
  function choose(next: HelpGuide) {
    if (next === guide) return;
    if (embedded) setEmbeddedChoice(next);
    else
      void navigate({
        to: "/help",
        search: (prev: Record<string, unknown>) => ({ ...prev, guide: next }),
        hash: "",
        replace: true,
        resetScroll: false,
      } as never);
  }
  const source = GUIDE_SOURCES[guide ?? "dm"];
  const [query, setQuery] = useState("");
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const inputId = useId();
  const prefix = embedded ? "guide-" : "";
  useEffect(() => {
    if (embedded || !hash) return;
    const target = document.getElementById(hash);
    if (target instanceof HTMLDetailsElement) target.open = true;
    target?.scrollIntoView({ block: "start" });
  }, [hash, embedded, guide]);
  if (!guide) return <p role="status">Opening your guide…</p>;
  const groups = source
    .map((g) => ({
      ...g,
      topics: g.topics.filter((t) => topicMatches(t, query)),
    }))
    .filter((g) => g.topics.length);
  const count = groups.reduce((sum, g) => sum + g.topics.length, 0);
  return (
    <div className="help-guide">
      <div className="help-guide-switch" role="group" aria-label="Guide for">
        <span aria-hidden="true">Guide for:</span>
        {(
          [
            ["player", "Players"],
            ["dm", "Dungeon Masters"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={guide === value}
            disabled={!interactive}
            onClick={() => choose(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <h2>{guide === "player" ? "Player guide" : "Dungeon Master guide"}</h2>
      <label className="help-search" htmlFor={inputId}>
        Find a rule, menu or task
        <input
          id={inputId}
          type="search"
          disabled={!interactive}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Try downtime, coins, import, backups…"
        />
      </label>
      <nav className="help-quick-links" aria-label="Help topics">
        {source.map((group) => (
          <button
            type="button"
            disabled={!interactive}
            key={group.id}
            onClick={() => {
              setQuery("");
              requestAnimationFrame(() =>
                document
                  .getElementById(prefix + group.id)
                  ?.scrollIntoView({ block: "start", behavior: "instant" }),
              );
            }}
          >
            {group.title}
          </button>
        ))}
      </nav>
      <p className="help-result" role="status">
        {query
          ? `${count} matching topics`
          : "Choose a topic, or search. Menu links open the current campaign; your permissions still apply."}
      </p>
      {groups.map((group) => (
        <section className="help-group" id={prefix + group.id} key={group.id}>
          <h2>{group.title}</h2>
          {group.topics.map((topic) => (
            <details
              className="help-topic"
              id={prefix + topic.id}
              key={topic.id}
              open={query ? true : !embedded && hash === topic.id ? true : undefined}
            >
              <summary>
                {topic.title}
                {topic.audience && <small>{topic.audience}</small>}
              </summary>
              <div className="help-topic-body">
                {topic.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                <nav className="help-destinations" aria-label={`${topic.title} menus`}>
                  {topic.links.map(([label, href]) => (
                    <AppLink key={href} href={href} onClick={onNavigate}>
                      {label}
                      <span aria-hidden="true"> →</span>
                    </AppLink>
                  ))}
                  {topic.email && (
                    <a href={`mailto:${topic.email}`}>
                      Email {topic.email}
                      <span aria-hidden="true"> →</span>
                    </a>
                  )}
                </nav>
              </div>
            </details>
          ))}
        </section>
      ))}
      {!count && <p>No matching topics. Try “loan”, “room”, “sheet” or “backup”.</p>}
    </div>
  );
}
