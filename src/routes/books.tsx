import { createFileRoute, Link } from "@tanstack/react-router";
import { Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { snippetAround } from "@/lib/quire/articles";
import { searchArticles } from "@/lib/quire/db";
import { useLibrary } from "@/lib/quire/library";
import type { Article } from "@/lib/quire/types";
import { Shell, KeptByDm } from "@/components/shell";
import { pageLabel } from "@/components/quire-ui";
import { Fold } from "@/components/ui";
import { FavoritesList } from "@/routes/favorites";
import { useSeat } from "@/lib/quire/seat";

export const Route = createFileRoute("/books")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : "",
  }),
  component: BooksPage,
});

function BooksPage() {
  const { q } = Route.useSearch();
  const seat = useSeat();
  if (seat.role === "player") return <KeptByDm />;
  return <Shell>{q.trim().length >= 2 ? <SearchResults query={q.trim()} /> : <LibraryHome />}</Shell>;
}

function LibraryHome() {
  const { ready, books, job, importFiles } = useLibrary();
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-4xl tracking-tight">Books</h1>
        <ImportButton disabled={Boolean(job)} onFiles={importFiles} />
      </div>
      <p className="mt-3 max-w-prose text-sm text-muted">
        Import a PDF you already own. It stays on this device. You can stock a shop from its prices, or copy names and items into the index.
      </p>
      {!ready ? <p className="mt-6 text-muted">Loading…</p> : null}
      {ready && books.length === 0 ? <p className="mt-6 text-muted">No PDFs yet.</p> : null}
      {books.length > 0 ? (
        <ul className="mt-6 border-y border-border lg:grid lg:grid-cols-2 lg:gap-x-8 lg:border-y-0">
          {books.map((book) => (
            <li key={book.id} className="border-b border-border">
              <Link to="/book/$bookId" params={{ bookId: book.id }} className="block min-h-16 py-3">
                <span className="block truncate font-display text-xl">{book.title}</span>
                <span className="text-sm text-muted">
                  {book.pageCount} pages · {book.articleCount} entries
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <Fold title="Favorites" hint="Entries you saved while reading.">
        <FavoritesList />
      </Fold>
    </section>
  );
}

function SearchResults({ query }: { query: string }) {
  const { books } = useLibrary();
  const [hits, setHits] = useState<Article[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    searchArticles(query)
      .then((next) => {
        if (!cancelled) setHits(next);
      })
      .catch(() => {
        if (!cancelled) setHits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const titles = new Map(books.map((book) => [book.id, book.title]));
  return (
    <section>
      <h1 className="font-display text-4xl tracking-tight">Search</h1>
      <p className="mt-2 text-sm text-muted">
        {hits === null ? "Looking…" : hits.length === 0 ? "Nothing matched." : `${hits.length} entries`}
      </p>
      <ul className="mt-4 divide-y divide-border border-y border-border">
        {hits?.map((article) => {
          const snippet = snippetAround(article.text, query);
          return (
            <li key={article.id}>
              <Link to="/read/$articleId" params={{ articleId: article.id }} className="block py-3">
                <span className="block font-display text-xl leading-tight">{article.title}</span>
                <span className="mt-1 block text-sm text-muted">
                  {titles.get(article.bookId) ?? "PDF"} · {pageLabel(article.pageStart, article.pageEnd)}
                </span>
                {snippet ? (
                  <span className="mt-2 block text-sm text-fg">
                    {snippet.before}
                    <mark className="bg-subtle text-fg">{snippet.match}</mark>
                    {snippet.after}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ImportButton({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: FileList) => Promise<void>;
}) {
  return (
    <label
      className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-sm bg-fg px-4 text-sm font-medium text-bg motion-press ${disabled ? "pointer-events-none opacity-40" : ""}`}
    >
      <Upload className="size-4" />
      Import PDF
      <input
        type="file"
        accept="application/pdf,.pdf"
        multiple
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const files = event.target.files;
          if (files && files.length > 0) void onFiles(files);
          event.target.value = "";
        }}
      />
    </label>
  );
}
