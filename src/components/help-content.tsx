import { useEffect, useId, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { HELP_GROUPS, topicMatches } from "@/lib/help/content";
import { PLAYER_HELP_GROUPS } from "@/lib/help/player-content";
import { useSeat, useSeatKnown } from "@/lib/quire/seat";
import { AppLink } from "./app-link";
import "./help-content.css";

export function HelpContent({
  embedded = false,
  onNavigate,
}: {
  embedded?: boolean;
  onNavigate?: () => void;
}) {
  const seat = useSeat(),
    known = useSeatKnown();
  const source =
    seat.role === "player"
      ? [...PLAYER_HELP_GROUPS, ...HELP_GROUPS.filter((g) => g.id === "install")]
      : HELP_GROUPS;
  const [query, setQuery] = useState("");
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const inputId = useId();
  const hash = useRouterState({ select: (s) => s.location.hash });
  const prefix = embedded ? "guide-" : "";
  useEffect(() => {
    if (embedded || !hash) return;
    const target = document.getElementById(hash);
    if (target instanceof HTMLDetailsElement) target.open = true;
    target?.scrollIntoView({ block: "start" });
  }, [hash, embedded, known]);
  if (!known) return <p role="status">Opening your guide…</p>;
  const groups = source
    .map((g) => ({
      ...g,
      topics: g.topics.filter((t) => topicMatches(t, query)),
    }))
    .filter((g) => g.topics.length);
  const count = groups.reduce((sum, g) => sum + g.topics.length, 0);
  return (
    <div className="help-guide">
      <h2>
        {known
          ? seat.role === "player"
            ? "Player guide"
            : "Dungeon Master guide"
          : "Opening your guide…"}
      </h2>
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
