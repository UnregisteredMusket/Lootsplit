import { FantasyIcon } from "@/components/fantasy-icon";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { useSeat } from "@/lib/quire/seat";
import { loadHandouts, type Handout } from "@/lib/quire/handouts";
import { LedgerArt } from "@/components/ledger-art";
import { useEconomy } from "@/lib/quire/economy-context";
export const Route = createFileRoute("/library")({ component: LibraryHub });
function LibraryHub() {
  const seat = useSeat(),
    dm = seat.role === "dm",
    [query, setQuery] = useState(""),
    [handouts, setHandouts] = useState<Handout[]>([]);
  const { catalog } = useEconomy();
  useEffect(() => {
    void loadHandouts()
      .then(setHandouts)
      .catch(() => setHandouts([]));
  }, []);
  const tiles = [
    {
      name: "Catalog",
      icon: "Catalog",
      url: dm ? "/catalog?pane=goods" : "/catalog?pane=open5e",
      note: dm ? "Items & services" : "Open rules & items",
    },
    {
      name: "Creatures",
      icon: "Creatures",
      url: "/catalog?pane=open5e&kind=creatures",
      note: "Open5e index",
    },
    {
      name: "Spells",
      icon: "Spells",
      url: "/catalog?pane=open5e&kind=spells",
      note: "Rules & references",
    },
    ...(dm
      ? [
          {
            name: "Books",
            icon: "Books",
            url: "/books",
            note: "Private PDF library",
          },
        ]
      : []),
    {
      name: "Handouts",
      icon: "Handouts",
      url: "#handouts",
      note: "Campaign references",
    },
    {
      name: "Names",
      icon: "Names",
      url: "/catalog?pane=names",
      note: "Generator & lexicon",
    },
  ];
  return (
    <Shell>
      <div className="library-banner">
        <FantasyIcon ui="Library" size={40} />
        <div>
          <h1>Library</h1>
          <p>Your references, close at hand.</p>
        </div>
      </div>
      <label className="hub-search">
        <Search size={20} />
        <input
          aria-label="Search library destinations and catalog"
          placeholder="Search references, items, tools…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="library-tiles">
        {tiles
          .filter((x) => (x.name + " " + x.note).toLowerCase().includes(query.toLowerCase()))
          .map((x) => (
            <a href={x.url} key={x.name}>
              <FantasyIcon ui={x.icon} size={36} />
              <strong>{x.name}</strong>
              <small>{x.note}</small>
            </a>
          ))}
      </div>
      {dm && (
        <>
          <div className="panel-heading mt-6">
            <h2>Catalog references</h2>
            <a href="/catalog">View all →</a>
          </div>
          <div className="reference-list">
            {catalog
              .filter((x) => x.name.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 6)
              .map((x) => (
                <a href="/catalog" key={x.id}>
                  <LedgerArt kind="item" entry={x} />
                  <span>
                    <strong>{x.name}</strong>
                    <small>
                      {x.category} · {x.rarity}
                    </small>
                  </span>
                  <span>›</span>
                </a>
              ))}
          </div>
          <a href="/books" className="gold-link mt-4">
            Open books & import PDF
          </a>
          <p className="text-sm text-muted mt-2">Private PDFs stay on this device.</p>
        </>
      )}
      <section className="mt-6" id="handouts">
        <h2>Shared handouts</h2>
        {handouts
          .filter((x) => (x.title + " " + x.text).toLowerCase().includes(query.toLowerCase()))
          .map((h) => (
            <details className="reference-handout" key={h.id}>
              <summary>{h.title}</summary>
              <p className="whitespace-pre-wrap">{h.text}</p>
            </details>
          ))}
        {!handouts.length && (
          <p className="text-muted mt-2">
            {dm
              ? "Mark an entry as a handout in your PDF reader, then include it in a player link or file."
              : "Your DM can include handouts in a player link or file."}
          </p>
        )}
        {!dm && (
          <p className="text-sm text-muted mt-3">
            The campaign’s private PDF library is managed by the DM.
          </p>
        )}
      </section>
      <Link to="/resources" className="settings-link mt-5">
        Sources & licenses →
      </Link>
    </Shell>
  );
}
