import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { listFavorites } from "@/lib/quire/db";
import { useLibrary } from "@/lib/quire/library";
import type { Article } from "@/lib/quire/types";
import { Shell } from "@/components/shell";
import { pageLabel } from "@/components/quire-ui";

export const Route = createFileRoute("/favorites")({
  component: FavoritesPage,
});

export function FavoritesList() {
  const { books } = useLibrary();
  const [articles, setArticles] = useState<Article[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFavorites()
      .then((next) => {
        if (!cancelled) setArticles(next);
      })
      .catch(() => {
        if (!cancelled) setArticles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const titles = new Map(books.map((book) => [book.id, book.title]));

  return (
    <div>
      {articles === null ? <p className="text-muted">Opening saved entries…</p> : null}
      {articles && articles.length === 0 ? (
        <p className="max-w-prose text-muted">Save an entry while you are reading it. It stays on this device.</p>
      ) : null}
      {articles && articles.length > 0 ? (
        <ul className="divide-y divide-border border-y border-border">
          {articles.map((article) => (
            <li key={article.id}>
              <Link to="/read/$articleId" params={{ articleId: article.id }} className="block py-3">
                <span className="block font-display text-xl leading-tight">{article.title}</span>
                <span className="text-sm text-muted">
                  {titles.get(article.bookId) ?? "PDF"} · {pageLabel(article.pageStart, article.pageEnd)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FavoritesPage() {
  return (
    <Shell>
      <h1 className="font-display text-4xl tracking-tight">Favorites</h1>
      <div className="mt-4">
        <FavoritesList />
      </div>
    </Shell>
  );
}
