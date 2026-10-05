// Synthetic PDF structures only. Never commit private character sheets.
export const characterPdfFields = {
  CharacterName: "Widget hero",
  "CLASS  LEVEL": "Fighter 4",
  RACE: "Variant Human",
  BACKGROUND: "Sailor",
  STR: "19",
  DEX: "10",
  CON: "18",
  INT: "8",
  WIS: "10",
  CHA: "12",
  Init: "+0",
  ProfBonus: "+2",
  AC: "10",
  MaxHP: "44",
  Total: "4d10",
  TempHP: "--",
  Animal: "+0",
  Passive1: "12",
  FeaturesTraits1: "First feature",
  FeaturesTraits2: "Second feature",
  FeaturesTraits3: "Third feature",
  Actions1: "First action",
  Actions2: "Second action",
  "Wpn Name": "Unarmed Strike",
  "Wpn1 AtkBonus": "+6",
  "Wpn1 Damage": "5 Bludgeoning",
  "Eq Name0": "",
  "Eq Qty0": "",
  CP: "0",
  GP: "0",
};
export const characterPdfLabels =
  "CHARACTER NAME\nStrength\nCLASS & LEVEL\nSPECIES\nBACKGROUND\nEXPERIENCE POINTS\nALIGNMENT\nFAITH\nPERSONALITY TRAITS\nIDEALS\nBONDS\nFLAWS\nCHARACTER APPEARANCE\nEQUIPMENT\nCopyright Example. All Rights Reserved.\nGENDER\nAGE\nEYES\nHAIR\nWEIGHT\nCHARACTER NAME";

export function characterPdf({ indexed = false, fields = characterPdfFields } = {}) {
  const literal = (value) =>
    String(value)
      .replace(/([\\()])/g, "\\$1")
      .replace(/\n/g, "\\n");
  const refs = Object.keys(fields)
    .map((_, i) => `${i + 7} 0 R`)
    .join(" ");
  const stream = Buffer.from(
    "BT /F1 10 Tf 20 770 Td 16 TL " +
      characterPdfLabels
        .split("\n")
        .map((line) => `(${literal(line)}) Tj T*`)
        .join(" ") +
      " ET",
  );
  const objects = [
    Buffer.from(`<< /Type /Catalog /Pages 2 0 R ${indexed ? "/AcroForm 6 0 R" : ""} >>`),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [${refs}] >>`,
    ),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
      stream,
      Buffer.from("\nendstream"),
    ]),
    Buffer.from(`<< /Fields [${refs}] /DA (/F1 10 Tf 0 g) /DR << /Font << /F1 4 0 R >> >> >>`),
    ...Object.entries(fields).map(([name, value], i) =>
      Buffer.from(
        `<< /Type /Annot /Subtype /Widget /FT /Tx /T (${literal(name)}) /V (${literal(value)}) /Rect [300 ${760 - i * 15} 580 ${774 - i * 15}] /P 3 0 R /F 4 /DA (/F1 10 Tf 0 g) >>`,
      ),
    ),
  ];
  const pieces = [Buffer.from("%PDF-1.4\n")],
    offsets = [0];
  for (const [i, body] of objects.entries()) {
    offsets.push(Buffer.concat(pieces).length);
    pieces.push(Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n"));
  }
  const xref = Buffer.concat(pieces).length;
  pieces.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(pieces);
}
