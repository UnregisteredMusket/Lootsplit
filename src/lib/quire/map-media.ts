import { bundleMapAsset } from "./map-assets.ts";
import { MAP_ASSET_LIMIT, type MapAssetBundle } from "./map-assets-schema.ts";

export function canvasBlob(canvas: HTMLCanvasElement, type = "image/webp", quality = 0.9) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(Error("This device could not encode the map."))),
      type,
      quality,
    ),
  );
}
export function mapThumbnail(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement("canvas"),
    scale = Math.min(1, 640 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("This device could not prepare the map preview.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  let preview = canvas.toDataURL("image/webp", 0.75);
  while (preview.length > 65_000 && canvas.width > 40 && canvas.height > 40) {
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext("2d")!.drawImage(canvas, 0, 0);
    canvas.width = Math.max(1, Math.floor(canvas.width * 0.75));
    canvas.height = Math.max(1, Math.floor(canvas.height * 0.75));
    ctx.drawImage(copy, 0, 0, canvas.width, canvas.height);
    preview = canvas.toDataURL("image/webp", 0.7);
  }
  if (preview.length > 65_000) throw Error("This device could not make a bounded map preview.");
  return preview;
}
export async function prepareMapMedia(file: File): Promise<MapAssetBundle> {
  if (
    !/^(image\/(png|jpeg|webp)|video\/(mp4|webm))$/.test(file.type) ||
    file.size > MAP_ASSET_LIMIT
  )
    throw Error("Choose a PNG, JPEG, WebP, MP4 or WebM map up to 20 MB.");
  if (file.type.startsWith("image/")) {
    const bitmap = await createImageBitmap(file);
    try {
      return await bundleMapAsset(
        file,
        bitmap.width,
        bitmap.height,
        mapThumbnail(bitmap, bitmap.width, bitmap.height),
      );
    } finally {
      bitmap.close();
    }
  }
  const video = document.createElement("video"),
    url = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            Error(
              "This device could not decode the video. Use a supported MP4/WebM or a still map.",
            ),
          ),
        15_000,
      );
      video.onloadeddata = () => {
        clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timeout);
        reject(Error("This video format is not supported on this device."));
      };
      video.src = url;
      video.load();
    });
    return await bundleMapAsset(
      file,
      video.videoWidth,
      video.videoHeight,
      mapThumbnail(video, video.videoWidth, video.videoHeight),
    );
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
