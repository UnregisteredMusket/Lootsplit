import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { articlesForBook, getBook } from "@/lib/quire/db";
import { useLibrary } from "@/lib/quire/library";
import type { Article, Book } from "@/lib/quire/types";
import { Shell } from "@/components/shell";
import { pageLabel } from "@/components/quire-ui";
import { Confirm } from "@/components/ui";

export const Route = createFileRoute("/book/$bookId")({
  component: BookPage,
});

function BookPage() {
  const { bookId } = Route.useParams();
  const navigate = useNavigate();
  const { rename, remove } = useLibrary();
  const [book, setBook] = useState<Book | null | undefined>(undefined);
  const [articles, setArticles] = useState<Article[]>([]);
  const [filter, setFilter] = useState("");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getBook(bookId), articlesForBook(bookId)])
      .then(([nextBook, nextArticles]) => {
        if (cancelled) return;
        setBook(nextBook);
        setArticles(nextArticles);
      })
      .catch(() => {
        if (!cancelled) setBook(null);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? articles.filter((article) => article.title.toLowerCase().includes(needle) || article.text.toLowerCase().includes(needle))
    : articles;

  return (
    <Shell>
      {book === undefined ? <p className="text-muted">Loading…</p> : null}
      {book === null ? (
        <div>
          <h1 className="font-display text-4xl tracking-tight">PDF not found</h1>
          <p className="mt-2 text-muted">That book is not in this library.</p>
          <Link to="/books" search={{ q: "" }} className="mt-4 inline-flex min-h-11 items-center text-sm">
            Back to the library
          </Link>
        </div>
      ) : null}
      {book ? (
        <section>
          <label className="block">
            <span className="text-sm text-muted">Book title</span>
            <input
              defaultValue={book.title}
              key={book.title}
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (next && next !== book.title) {
                  void rename(book.id, next);
                  setBook({ ...book, title: next });
                }
              }}
              className="mt-1 min-h-11 w-full rounded-sm border border-border bg-subtle px-3 font-display text-2xl text-fg outline-none"
            />
          </label>
          <p className="mt-2 text-sm text-muted">
            {book.pageCount} pages · {articles.length} entries
          </p>
          <Link to="/market" search={{ book: book.id }} className="mt-3 inline-flex min-h-11 items-center text-sm text-muted">
            Stock a shop from this PDF
          </Link>
          <label className="mt-4 block">
            <span className="sr-only">Filter entries</span>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter this PDF"
              className="min-h-11 w-full rounded-sm border border-border bg-subtle px-3 text-base text-fg outline-none placeholder:text-faint"
            />
          </label>
          <ul className="mt-4 divide-y divide-border border-y border-border">
            {visible.map((article) => (
              <li key={article.id}>
                <Link to="/read/$articleId" params={{ articleId: article.id }} className="block py-3">
                  <span className="block font-display text-xl leading-tight">{article.title}</span>
                  <span className="text-sm text-muted">{pageLabel(article.pageStart, article.pageEnd)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {visible.length === 0 ? <p className="mt-4 text-muted">No entries match.</p> : null}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mt-6 inline-flex min-h-11 items-center rounded-sm border border-danger px-4 text-sm text-fg"
          >
            Remove PDF
          </button>
          <Confirm
            open={confirming}
            onOpenChange={setConfirming}
            title="Remove this PDF?"
            body="The entries made from it are deleted from this device. The original file on your computer is not deleted."
            confirmLabel="Remove"
            onConfirm={() => {
              void remove(book.id).then(() => navigate({ to: "/", search: { q: "" } }));
            }}
          />
        </section>
      ) : null}
    </Shell>
  );
}
