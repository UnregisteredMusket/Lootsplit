import { readPdfPlain } from "./pdf.ts";
import { mergeSheetBodies, sheetFromData, sheetFromFields, sheetFromText, type SheetDraft } from "./sheet.ts";

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
  if (!name.endsWith(".pdf") && file.type !== "application/pdf") {
    throw new Error("Use a PDF character sheet or a JSON export.");
  }
  const plain = await readPdfPlain(file);
  const sheet = mergeSheetBodies(sheetFromFields(plain.fields), sheetFromText(plain.text));
  if (!sheet) throw new Error("That PDF does not look like a 2014 character sheet. A scan without selectable text cannot be read.");
  return sheet;
}
