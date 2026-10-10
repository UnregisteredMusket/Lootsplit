import { AppLink } from "@/components/app-link";
import { ResourcePacks } from "@/components/resource-packs";
import { SearchSelect } from "@/components/search-select";
import { Button } from "@/components/ui";
import { useWorldTable } from "@/lib/quire/use-world-table";
import {
  libraryRecords,
  searchLibraryRecords,
  libraryRecordHref,
} from "@/lib/quire/library-records";
import { FantasyIcon } from "@/components/fantasy-icon";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/shell";
import { useSeat } from "@/lib/quire/seat";
import { loadHandouts, type Handout } from "@/lib/quire/handouts";
import { LedgerArt } from "@/components/ledger-art";
import { useEconomy } from "@/lib/quire/economy-context";
export const Route = createFileRoute("/library")({
  validateSearch: (s: Record<string, unknown>) => ({
    record: typeof s.record === "string" && s.record.length <= 800 ? s.record : undefined,
  }),
  component: LibraryHub,
});
function LibraryHub() {
  const seat = useSeat(),
    dm = seat.role === "dm",
    [query, setQuery] = useState(""),
    [handouts, setHandouts] = useState<Handout[]>([]);
  const { catalog, lexicon, ready } = useEconomy();
  const table = useWorldTable(),
    { record: recordKey } = Route.useSearch();
  const [kind, setKind] = useState(""),
    [page, setPage] = useState(0);
  const { journal, purses, holdings, shops } = table,
    { role, purseIds } = seat;
  const records = useMemo(
      () =>
        libraryRecords({ journal, purses, holdings, shops }, { role, purseIds }, catalog, lexicon),
      [journal, purses, holdings, shops, role, purseIds, catalog, lexicon],
    ),
    record = records.find((r) => r.key === recordKey);
  const matching = searchLibraryRecords(records, query, kind),
    kinds = [...new Set(records.map((r) => r.kind))].sort();
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matching.length / 20) - 1));
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
          {
            name: "Resource packs",
            icon: "Books",
            url: "/library#resource-packs",
            note: "Reviewed JSON imports",
          },
        ]
      : []),
    {
      name: "Handouts",
      icon: "Handouts",
      url: "/library#handouts",
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
          placeholder="Search locations, NPCs, monsters, items…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </label>
      <div className="library-tiles">
        {tiles
          .filter((x) => (x.name + " " + x.note).toLowerCase().includes(query.toLowerCase()))
          .map((x) => (
            <AppLink href={x.url} key={x.name}>
              <FantasyIcon ui={x.icon} size={36} />
              <strong>{x.name}</strong>
              <small>{x.note}</small>
            </AppLink>
          ))}
      </div>
      <section id="records" className="mt-6" aria-label="Campaign library records">
        <h2>Campaign records & imported data</h2>
        <p className="text-sm text-muted">
          Search your saved entries and open a record to see its details.
        </p>
        {recordKey && !ready ? (
          <p role="status">Loading entry…</p>
        ) : recordKey && !record ? (
          <p role="alert">
            This entry is unavailable in the current campaign or is not shared with you.
          </p>
        ) : null}
        {record && (
          <article className="world-card library-record-detail" aria-label="Library entry">
            <div className="panel-heading">
              <h2>{record.name}</h2>
              <AppLink href="/library#records">Close entry</AppLink>
            </div>
            <p className="text-muted">{record.kind}</p>
            {record.image && <img src={record.image} alt={record.name} />}
            {record.description && (
              <p className="whitespace-pre-wrap break-words mt-3">{record.description}</p>
            )}
            <dl className="library-record-fields">
              {record.fields.map(([label, value], i) => (
                <div className="contents" key={i}>
                  <dt>{label}</dt>
                  <dd>{value || "Not recorded"}</dd>
                </div>
              ))}
            </dl>
            {record.warnings?.map((warning, i) => (
              <p className="text-danger" key={i}>
                {warning}
              </p>
            ))}
            <div className="flex flex-wrap gap-3">
              {record.links.map((link, i) => (
                <AppLink className="settings-link" key={i} href={link.href}>
                  {link.name} →
                </AppLink>
              ))}
            </div>
          </article>
        )}
        <label className="block mt-3">
          Record type
          <SearchSelect
            aria-label="Library record type"
            value={kind}
            onValueChange={(value) => {
              setKind(value);
              setPage(0);
            }}
          >
            <option value="">All records</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </SearchSelect>
        </label>
        <p className="text-sm text-muted mt-2" role="status">
          {matching.length} matching entries
        </p>
        <div className="library-record-list">
          {matching.slice(currentPage * 20, (currentPage + 1) * 20).map((r) => (
            <AppLink href={`/library?record=${encodeURIComponent(r.key)}#records`} key={r.key}>
              <span>
                <strong>{r.name}</strong>
                <small>{r.kind}</small>
              </span>
              <span aria-hidden="true">›</span>
            </AppLink>
          ))}
        </div>
        {!matching.length && (
          <p className="mt-3">
            {records.length
              ? "No entries match your search."
              : "No campaign entries are available yet."}
          </p>
        )}
        {matching.length > 20 && (
          <div className="flex items-center justify-between gap-2 mt-3">
            <Button
              variant="ghost"
              disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous entries
            </Button>
            <span>
              {currentPage + 1} / {Math.ceil(matching.length / 20)}
            </span>
            <Button
              variant="ghost"
              disabled={(currentPage + 1) * 20 >= matching.length}
              onClick={() => setPage(currentPage + 1)}
            >
              More entries
            </Button>
          </div>
        )}
      </section>
      {dm && (
        <>
          <div className="panel-heading mt-6">
            <h2>Catalog references</h2>
            <AppLink href="/catalog">View all →</AppLink>
          </div>
          <div className="reference-list">
            {catalog
              .filter((x) => x.name.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 6)
              .map((x) => (
                <AppLink href={libraryRecordHref("catalog", x.id)} key={x.id}>
                  <LedgerArt kind="item" entry={x} />
                  <span>
                    <strong>{x.name}</strong>
                    <small>
                      {x.category} · {x.rarity}
                    </small>
                  </span>
                  <span>›</span>
                </AppLink>
              ))}
          </div>
          <AppLink href="/books" className="gold-link mt-4">
            Open books & import PDF
          </AppLink>
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
      {dm && <ResourcePacks />}
      <Link to="/resources" className="settings-link mt-5">
        Sources & licenses →
      </Link>
    </Shell>
  );
}
