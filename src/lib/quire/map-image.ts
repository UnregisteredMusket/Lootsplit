import { createOcrReader } from "./ocr";
export async function prepareMapImage(file: File) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 20_000_000)
    throw Error("Choose a PNG, JPEG or WebP map up to 20 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 64_000_000)
      throw Error("Choose a map smaller than 64 megapixels.");
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("This device could not prepare the map.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let image = canvas.toDataURL("image/webp", 0.85);
    for (let quality = 0.75; image.length > 500000 && quality >= 0.25; quality -= 0.1)
      image = canvas.toDataURL("image/webp", quality);
    if (image.length > 500000)
      throw Error(
        "This map is too detailed to share. Crop it into regional maps or use a smaller image.",
      );
    return image;
  } finally {
    bitmap.close();
  }
}
export async function recognizeMap(image: string, progress: (text: string) => void) {
  const bitmap = await createImageBitmap(await (await fetch(image)).blob()),
    canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("This device could not read the map.");
    ctx.drawImage(bitmap, 0, 0);
    const reader = await createOcrReader(progress);
    try {
      return { ...(await reader.read(canvas)), width: canvas.width, height: canvas.height };
    } finally {
      await reader.close();
    }
  } finally {
    bitmap.close();
  }
}
