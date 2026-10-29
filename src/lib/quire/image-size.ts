/** The image's natural size, for an automatic grid (data URLs and references both load). */
export function imageSize(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(Error("The map image could not be read. Try again once it has loaded."));
    image.src = src;
  });
}
