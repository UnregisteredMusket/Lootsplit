/** Bounded raster container inspection. No decoding, paths or executable metadata. */
export function animatedMapImage(bytes: Uint8Array, mime: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (mime === "image/png") {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (length > bytes.length - offset - 12) return false;
      if (tag(offset + 4) === "acTL") return true;
      offset += length + 12;
    }
  } else if (mime === "image/webp" && tag(0) === "RIFF" && tag(8) === "WEBP") {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const length = view.getUint32(offset + 4, true);
      if (length > bytes.length - offset - 8) return false;
      if (["ANIM", "ANMF"].includes(tag(offset))) return true;
      offset += length + 8 + (length % 2);
    }
  }
  return false;
}
