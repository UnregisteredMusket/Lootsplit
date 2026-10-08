import { createOcrReader } from "./ocr";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import {
  buildArticles,
  itemsToLines,
  orderPage,
  type PageText,
  type TextAtom,
} from "./articles.ts";
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
  skippedPages: number[];
  ocrPages?: number[];
};

function atomFromItem(item: PdfTextItem): TextAtom | null {
  const text = item.str ?? "";
  if (!text.trim()) return null;
  const transform = item.transform ?? [];
  const height =
    item.height || Math.hypot(Number(transform[2]) || 0, Number(transform[3]) || 0) || 10;
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

  let ocr: Awaited<ReturnType<typeof createOcrReader>> | undefined;
  try {
    const meta = await doc.getMetadata().catch(() => ({ info: {} }));
    const info = meta.info as { Title?: unknown };
    const metaTitle = typeof info.Title === "string" ? info.Title.trim() : "";
    const title = metaTitle || file.name.replace(/\.pdf$/i, "").trim() || "Untitled PDF";
    const pages: PageText[] = [];
    const skippedPages: number[] = [];
    const ocrPages: number[] = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const atoms = content.items.flatMap((item) => {
        if (!("str" in item)) return [];
        const atom = atomFromItem(item);
        return atom ? [atom] : [];
      });
      if (
        atoms
          .map((a) => a.str)
          .join("")
          .trim().length < 100
      ) {
        ocr ??= await createOcrReader();
        const canvas = await renderForOcr(page);
        const result = await ocr.read(canvas, number);
        pages.push({ width: canvas.width, lines: result.lines });
        ocrPages.push(number);
        if (result.confidence < 75) skippedPages.push(number);
      } else pages.push({ width: viewport.width, lines: itemsToLines(atoms, number) });
      onProgress(number, doc.numPages);
      await page.cleanup();
    }
    const articles = buildArticles(pages);
    if (articles.length === 0) {
      throw new Error("No selectable text was found. Try a clearer scan.");
    }
    return { title, pageCount: doc.numPages, articles, skippedPages, ocrPages };
  } finally {
    await ocr?.close();
    await doc.cleanup();
    await task.destroy();
  }
}

export async function readPdfPlain(
  file: File,
  onProgress?: (message: string) => void,
): Promise<{ fields: Record<string, string>; text: string; warnings: string[] }> {
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
  let ocr: Awaited<ReturnType<typeof createOcrReader>> | undefined;
  try {
    const warnings: string[] = [];
    const fields: Record<string, string> = {};
    const raw = await doc.getFieldObjects();
    if (raw) {
      for (const [name, entries] of raw) {
        const value = fieldText(entries);
        if (value) fields[name] = value;
      }
    }
    const pages: string[] = [];
    const last = doc.numPages;
    for (let number = 1; number <= last; number += 1) {
      const page = await doc.getPage(number);
      // Some exports retain filled page widgets but lose /AcroForm/Fields.
      // getTextContent reads their printed labels, not the widget values.
      for (const annotation of await page.getAnnotations()) {
        if (annotation.subtype !== "Widget" || !annotation.fieldName) continue;
        const value = fieldText([annotation]);
        if (!value) continue;
        if (fields[annotation.fieldName] && fields[annotation.fieldName] !== value) {
          warnings.push(`Conflicting PDF values for ${annotation.fieldName}; review this field.`);
        } else fields[annotation.fieldName] = value;
      }
      const content = await page.getTextContent();
      const atoms = content.items.flatMap((item) => {
        if (!("str" in item)) return [];
        const atom = atomFromItem(item);
        return atom ? [atom] : [];
      });
      const lines = orderPage(itemsToLines(atoms, number), page.getViewport({ scale: 1 }).width);
      onProgress?.(`Reading page ${number} of ${last}`);
      if (
        lines
          .map((l) => l.text)
          .join("")
          .trim().length >= 100
      )
        pages.push(lines.map((line) => line.text).join("\n"));
      else {
        ocr ??= await createOcrReader(onProgress);
        const result = await ocr.read(await renderForOcr(page), number);
        if (result.text.trim()) pages.push(result.text);
        warnings.push(
          `Page ${number}: scanned text (${Math.round(result.confidence)}% OCR confidence); compare every imported value with the original.`,
        );
      }
      await page.cleanup();
    }
    if (!pages.length && !Object.keys(fields).length)
      throw new Error("No selectable text or form fields were found. This PDF may need OCR first.");
    return { fields, text: pages.join("\n\f\n"), warnings };
  } finally {
    await ocr?.close();
    await doc.cleanup();
    await task.destroy();
  }
}

function fieldText(entries: unknown): string {
  if (!Array.isArray(entries)) return "";
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as { value?: unknown; fieldValue?: unknown };
    const value = record.value ?? record.fieldValue;
    if (typeof value === "string" && value.trim() && !/^(off|false)$/i.test(value.trim()))
      return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

async function renderForOcr(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof getDocument>["promise"]>["getPage"]>>,
) {
  const original = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: Math.min(3, 2600 / Math.max(original.width, original.height)),
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return canvas;
}
