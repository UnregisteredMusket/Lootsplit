import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { buildArticles, itemsToLines, type PageText, type TextAtom } from "./articles.ts";
import type { DraftArticle } from "./types.ts";

type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
};

let workerReady = false;

function ensureWorker() {
  if (workerReady) return;
  GlobalWorkerOptions.workerSrc = workerUrl;
  workerReady = true;
}

export type PdfRead = {
  title: string;
  pageCount: number;
  articles: DraftArticle[];
};

function atomFromItem(item: PdfTextItem): TextAtom | null {
  const text = item.str ?? "";
  if (!text.trim()) return null;
  const transform = item.transform ?? [];
  const height = item.height || Math.hypot(Number(transform[2]) || 0, Number(transform[3]) || 0) || 10;
  return {
    str: text,
    x: Number(transform[4]) || 0,
    y: Number(transform[5]) || 0,
    width: item.width || 0,
    height,
  };
}

export async function readPdf(
  file: File,
  onProgress: (page: number, total: number) => void,
): Promise<PdfRead> {
  ensureWorker();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({ data, verbosity: 0 });
  const doc = await new Promise<Awaited<typeof task.promise>>((resolve, reject) => {
    task.onPassword = () => {
      reject(new Error("This PDF is locked with a password."));
      void task.destroy();
    };
    task.promise.then(resolve, reject);
  });

  try {
    const meta = await doc.getMetadata();
    const info = meta.info as { Title?: unknown };
    const metaTitle = typeof info.Title === "string" ? info.Title.trim() : "";
    const title = metaTitle || file.name.replace(/\.pdf$/i, "").trim() || "Untitled PDF";
    const pages: PageText[] = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const atoms = content.items.flatMap((item) => {
        if (!("str" in item)) return [];
        const atom = atomFromItem(item);
        return atom ? [atom] : [];
      });
      pages.push({ width: viewport.width, lines: itemsToLines(atoms, number) });
      onProgress(number, doc.numPages);
      await page.cleanup();
    }
    const articles = buildArticles(pages);
    if (articles.length === 0) {
      throw new Error("No selectable text was found. Scanned pages cannot be catalogued.");
    }
    return { title, pageCount: doc.numPages, articles };
  } finally {
    await doc.cleanup();
    await task.destroy();
  }
}
