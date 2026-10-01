import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { articleNeighbors, getArticle, getBook } from "@/lib/quire/db";
import { loadHandouts, toggleHandout } from "@/lib/quire/handouts";
import { useLibrary } from "@/lib/quire/library";
import type { Article } from "@/lib/quire/types";
import { Shell } from "@/components/shell";
import { pageLabel } from "@/components/quire-ui";
import { usePrefs } from "@/lib/quire/prefs";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/read/$articleId")({
  component: ReadPage,
});

function ReadPage() {
  const { articleId } = Route.useParams();
  const { favorite } = useLibrary();
  const { prefs } = usePrefs();
  const [article, setArticle] = useState<Article | null | undefined>(undefined);
  const [bookTitle, setBookTitle] = useState("");
  const [handout, setHandout] = useState(false);
  const [neighbors, setNeighbors] = useState<{ prev: Article | null; next: Article | null }>({ prev: null, next: null });

  useEffect(() => {
    let cancelled = false;
    getArticle(articleId)
      .then(async (next) => {
        if (cancelled) return;
        setArticle(next);
        if (!next) return;
        const [book, around] = await Promise.all([getBook(next.bookId), articleNeighbors(next)]);
        if (cancelled) return;
        setBookTitle(book?.title ?? "PDF");
        setNeighbors(around);
        const shared = await loadHandouts();
        if (!cancelled) setHandout(shared.some((item) => item.id === next.id));
      })
      .catch(() => {
        if (!cancelled) setArticle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  async function toggle() {
    if (!article) return;
    const next = !article.favorite;
    setArticle({ ...article, favorite: next });
    await favorite(article.id, next);
  }

  return (
    <Shell width="prose">
      {article === undefined ? <p className="text-muted">Opening entry…</p> : null}
      {article === null ? (
        <div>
          <h1 className="font-display text-4xl tracking-tight">Missing entry</h1>
          <Link to="/books" search={{ q: "" }} className="mt-4 inline-flex min-h-11 items-center text-sm">
            Back to the library
          </Link>
        </div>
      ) : null}
      {article ? (
        <article>
          <Link
            to="/book/$bookId"
            params={{ bookId: article.bookId }}
            className="inline-flex min-h-11 items-center gap-1 text-sm text-muted"
          >
            <ChevronLeft className="size-4" />
            {bookTitle || "PDF"}
          </Link>
          <div className="mt-2 flex items-start justify-between gap-3">
            <p className="text-sm text-muted">{pageLabel(article.pageStart, article.pageEnd)}</p>
            <button
              type="button"
              onClick={() => void toggle()}
              aria-pressed={article.favorite}
              className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-border px-3 text-sm"
            >
              <Star className={article.favorite ? "size-4 fill-accent text-accent" : "size-4"} />
              {article.favorite ? "Saved" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                void toggleHandout(article.id).then(setHandout).catch((error: unknown) => {
                  toast.error(error instanceof Error ? error.message : "That handout could not be kept.");
                });
              }}
              aria-pressed={handout}
              className="inline-flex min-h-11 items-center rounded-sm border border-border px-3 text-sm"
            >
              {handout ? "Handout" : "Share with players"}
            </button>
          </div>
          <div className={cn("mt-4 rounded-xl p-4", prefs.nightReading ? "bg-elevated text-fg" : "bg-paper text-ink")}>
            <h1 className="font-display text-4xl leading-tight tracking-tight">{article.title}</h1>
            <div className="mt-4 max-w-prose">
              {article.text.split(/\n\n+/).map((paragraph, index) => (
                <p key={index} className={cn("mb-4 font-display leading-relaxed", READ_SIZE[prefs.readScale] ?? "text-lg")}>
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {neighbors.prev ? (
              <Link
                to="/read/$articleId"
                params={{ articleId: neighbors.prev.id }}
                className="min-h-11 rounded-sm border border-border px-3 py-2 text-sm"
              >
                <span className="block text-faint">Previous</span>
                <span className="block truncate font-medium">{neighbors.prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {neighbors.next ? (
              <Link
                to="/read/$articleId"
                params={{ articleId: neighbors.next.id }}
                className="min-h-11 rounded-sm border border-border px-3 py-2 text-right text-sm"
              >
                <span className="block text-faint">Next</span>
                <span className="block truncate font-medium">{neighbors.next.title}</span>
              </Link>
            ) : null}
          </div>
        </article>
      ) : null}
    </Shell>
  );
}

const READ_SIZE = ["text-base", "text-lg", "text-xl", "text-2xl"] as const;
