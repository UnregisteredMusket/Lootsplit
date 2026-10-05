import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  deleteBook,
  listBooks,
  randomArticleId,
  renameBook,
  saveImport,
  setFavorite,
} from "./db.ts";
import { subscribeCampaigns } from "./campaigns.ts";
import type { Book } from "./types.ts";

export type ImportJob = {
  name: string;
  page: number;
  total: number;
  phase: "read" | "save";
};

type LibraryApi = {
  ready: boolean;
  books: Book[];
  job: ImportJob | null;
  importFiles: (files: FileList | File[]) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  favorite: (id: string, value: boolean) => Promise<void>;
  randomId: () => Promise<string | null>;
  reload: () => Promise<void>;
};

const LibraryContext = createContext<LibraryApi | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [ready, setReady] = useState(false);
  const [job, setJob] = useState<ImportJob | null>(null);

  const refresh = useCallback(async () => {
    setBooks(await listBooks());
  }, []);

  useEffect(() => {
    let cancelled = false;
    listBooks()
      .then((next) => {
        if (!cancelled) setBooks(next);
      })
      .catch(() => {
        if (!cancelled) toast.error("The library on this device could not be opened.");
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      subscribeCampaigns(() => {
        setReady(false);
        setBooks([]);
        void refresh().finally(() => setReady(true));
      }),
    [refresh],
  );

  const importFiles = useCallback(async (files: FileList | File[]) => {
    const list = [...files].filter(
      (file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name),
    );
    if (list.length === 0) {
      toast.error("Choose a PDF.");
      return;
    }
    const { readPdf } = await import("./pdf.ts");
    let added = 0;
    for (const file of list) {
      if (file.size > 220_000_000) {
        toast.error(`${file.name} is too large to read in the browser.`);
        continue;
      }
      try {
        setJob({ name: file.name, page: 0, total: 1, phase: "read" });
        const result = await readPdf(file, (page, total) => {
          setJob({ name: file.name, page, total, phase: "read" });
        });
        setJob({ name: file.name, page: result.pageCount, total: result.pageCount, phase: "save" });
        await saveImport(
          {
            id: crypto.randomUUID(),
            title: result.title,
            fileName: file.name,
            pageCount: result.pageCount,
            articleCount: result.articles.length,
            importedAt: Date.now(),
          },
          result.articles,
        );
        if (result.skippedPages.length)
          toast.warning(
            `${result.title}: ${result.skippedPages.length} pages have low-confidence OCR. Review the extracted text against the original before importing values.`,
          );
        added += 1;
        setBooks(await listBooks());
      } catch (error) {
        const message = error instanceof Error ? error.message : "That PDF could not be read.";
        toast.error(message);
      }
    }
    setJob(null);
    if (added > 0) toast.success(added === 1 ? "PDF added." : `${added} PDFs added.`);
  }, []);

  const rename = useCallback(async (id: string, title: string) => {
    const next = title.trim();
    if (!next) return;
    await renameBook(id, next);
    setBooks((current) =>
      current.map((book) => (book.id === id ? { ...book, title: next } : book)),
    );
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteBook(id);
    setBooks((current) => current.filter((book) => book.id !== id));
    toast.success("PDF removed.");
  }, []);

  const favorite = useCallback(async (id: string, value: boolean) => {
    await setFavorite(id, value);
  }, []);

  const randomId = useCallback(async () => randomArticleId(), []);

  const api = useMemo<LibraryApi>(
    () => ({ ready, books, job, importFiles, rename, remove, favorite, randomId, reload: refresh }),
    [ready, books, job, importFiles, rename, remove, favorite, randomId, refresh],
  );

  return <LibraryContext.Provider value={api}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const value = useContext(LibraryContext);
  if (!value) throw new Error("Library is unavailable.");
  return value;
}
