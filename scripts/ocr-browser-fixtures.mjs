// Synthetic upright scans; never commit private campaign images.
export async function scanFixture(page, lines, type = "image/png") {
  const data = await page.evaluate(
    ({ lines, type }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1100;
      canvas.height = 1500;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "black";
      ctx.font = "30px Arial";
      lines.forEach((line, i) => ctx.fillText(line, 55, 90 + 48 * i));
      return canvas.toDataURL(type, 0.95).split(",")[1];
    },
    { lines, type },
  );
  return Buffer.from(data, "base64");
}
export function scannedPdf(jpeg) {
  const stream = Buffer.from("q 550 0 0 750 0 0 cm /Scan Do Q");
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 550 750] /Resources << /XObject << /Scan 4 0 R >> >> /Contents 5 0 R >>",
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 1100 /Height 1500 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      Buffer.from("\nendstream"),
    ]),
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
      stream,
      Buffer.from("\nendstream"),
    ]),
  ];
  const pieces = [Buffer.from("%PDF-1.4\n")],
    offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.concat(pieces).length);
    pieces.push(Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n"));
  });
  const xref = Buffer.concat(pieces).length;
  pieces.push(
    Buffer.from(
      `xref\n0 6\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
        .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(pieces);
}
