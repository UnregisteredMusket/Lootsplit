import type { Worker, ImageLike } from "tesseract.js";
import type { RawLine } from "./articles";
export async function createOcrReader(progress?: (message: string) => void) {
  const { createWorker, PSM } = await import("tesseract.js");
  let worker: Worker | undefined;
  let abandoned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bounded = async <T>(work: Promise<T>): Promise<T> => {
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            abandoned = true;
            void worker?.terminate();
            reject(Error("Text recognition timed out. Try a clearer or smaller image."));
          }, 90000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    worker = await bounded(
      createWorker("eng", 1, {
        workerPath: new URL("/ocr/v7/worker.min.js", location.href).href,
        corePath: new URL("/ocr/v7/", location.href).href,
        langPath: new URL("/ocr/v7/", location.href).href,
        logger: (m) => progress?.(`${m.status} · ${Math.round(m.progress * 100)}%`),
      }).then(async (created) => {
        if (abandoned) {
          await created.terminate();
          throw Error("Text recognition initialization timed out.");
        }
        return created;
      }),
    );
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1" });
    return {
      async read(image: ImageLike, page = 1) {
        const { data } = await bounded(worker!.recognize(image, {}, { text: true, blocks: true }));
        const lines: RawLine[] = (data.blocks || []).flatMap((b) =>
          b.paragraphs.flatMap((p) =>
            p.lines.map((l) => ({
              text: l.text.trim(),
              size: l.bbox.y1 - l.bbox.y0,
              x: l.bbox.x0,
              y: -l.bbox.y0,
              width: l.bbox.x1 - l.bbox.x0,
              page,
            })),
          ),
        );
        return { text: data.text, confidence: data.confidence, lines };
      },
      close: () => worker!.terminate(),
    };
  } catch (error) {
    await worker?.terminate();
    throw error;
  }
}
export async function readImageText(file: File, progress?: (message: string) => void) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(2, 2600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const reader = await createOcrReader(progress);
    try {
      const result = await reader.read(canvas);
      if (!result.text.trim())
        throw Error(
          "No readable text was found. Use a sharper, upright scan with the full page visible.",
        );
      return result;
    } finally {
      await reader.close();
    }
  } finally {
    bitmap.close();
  }
}
