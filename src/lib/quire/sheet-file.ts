import {
  mergeSheetBodies,
  sheetFromData,
  sheetFromFields,
  sheetFromText,
  type SheetDraft,
} from "./sheet.ts";

export async function readCharacterSheet(file: File): Promise<SheetDraft> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json") || file.type === "application/json") {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error("That JSON could not be read.");
    }
    const sheet = sheetFromData(data);
    if (!sheet) throw new Error("That file does not look like a 2014 character sheet.");
    return sheet;
  }
  if (/\.(png|jpe?g|webp)$/i.test(name) || /^image\//.test(file.type)) {
    const { readImageText } = await import("./ocr");
    const result = await readImageText(file);
    const sheet = sheetFromText(result.text);
    if (!sheet)
      throw Error(
        "No reliable character fields were found. Use a clear sheet image, PDF or JSON export.",
      );
    return sheet;
  }
  if (!name.endsWith(".pdf") && file.type !== "application/pdf") {
    throw new Error("Use a PDF, PNG, JPEG, WebP or JSON character sheet.");
  }
  const { readPdfPlain } = await import("./pdf.ts");
  const plain = await readPdfPlain(file);
  const sheet = mergeSheetBodies(sheetFromFields(plain.fields), sheetFromText(plain.text));
  if (!sheet)
    throw new Error(
      "No reliable character fields were found. Review the scan quality or use a filled PDF/JSON export.",
    );
  return sheet;
}
