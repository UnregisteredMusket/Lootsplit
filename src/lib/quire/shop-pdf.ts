import { labelOf, RARITIES, SHOP_KINDS, WEALTHS } from "./labels.ts";
import { formatCopper, formatDollars } from "./money.ts";
import type { Shop, StockLine } from "./types.ts";

export type ShopPdfInput = {
  shop: Shop;
  lines: StockLine[];
  showDollars: boolean;
  gpDollars: number;
  issued?: Date;
};

const PAGE_W = 612;
const PAGE_H = 792;
const LEFT = 54;
const RIGHT = 558;
const TOP = 736;
const BOTTOM = 64;

type Page = { ops: string[]; y: number };

export function shopPdfFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${slug || "shop"}.pdf`;
}

export function renderShopPdf(input: ShopPdfInput): string {
  const pages = layout(input);
  return assemble(pages);
}

export function downloadShopPdf(input: ShopPdfInput): void {
  const pdf = renderShopPdf(input);
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = shopPdfFilename(input.shop.name);
  link.click();
  URL.revokeObjectURL(url);
}

function layout(input: ShopPdfInput): string[] {
  const shop = input.shop;
  const issued = input.issued ?? new Date();
  const date = issued.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const pages: Page[] = [];
  let page = startPage();
  pages.push(page);

  const fresh = () => {
    page = startPage();
    pages.push(page);
    text(page, shop.name || "Shop", 11, "F2", LEFT);
    page.y -= 4;
    rule(page);
    page.y -= 8;
  };

  const need = (height: number) => {
    if (page.y - height < BOTTOM) fresh();
  };

  text(page, shop.name || "Shop", 22, "F2", LEFT);
  page.y -= 6;
  rule(page);
  page.y -= 14;

  const who = [shop.keeper, shop.place].filter(Boolean).join("  ·  ");
  if (who) {
    muted(page, who, 11);
    page.y -= 4;
  }
  muted(page, `${labelOf(SHOP_KINDS, shop.category)}  ·  ${labelOf(WEALTHS, shop.wealth)} shop`, 11);
  page.y -= 8;
  const pay = Math.round(shop.buyRate * 100);
  wrap(page, `Asking prices. 10 cp = 1 sp, 10 sp = 1 gp, and 10 gp = 1 pp. The shop pays ${pay}% when buying from you.`, 11, "F1", true);
  if (shop.notes.trim()) {
    page.y -= 6;
    wrap(page, shop.notes.trim(), 11, "F1", false);
  }
  page.y -= 16;
  text(page, "For sale", 12, "F2", LEFT);
  page.y -= 8;

  const shelf = [...input.lines].sort((a, b) => a.name.localeCompare(b.name));
  if (shelf.length === 0) {
    muted(page, "No items.", 11);
  }

  for (const line of shelf) {
    const ask = Math.max(0, Math.round(line.copper * shop.sellRate));
    const price = priceLabel(ask, input);
    const detail = detailLabel(line);
    const nameWidth = RIGHT - LEFT - measure(price, 11) - 16;
    const nameLines = breakLines(line.name || "Good", nameWidth, 11);
    const block = nameLines.length * 15 + (detail ? 14 : 0) + 10;
    need(block);
    nameLines.forEach((part, index) => {
      const baseline = page.y - 11;
      textAt(page, part, 11, "F1", LEFT, baseline);
      if (index === 0) textAt(page, price, 11, "F1", RIGHT - measure(price, 11), baseline);
      page.y -= 15;
    });
    if (detail) muted(page, detail, 9);
    page.y -= 4;
    hairline(page);
    page.y -= 8;
  }

  const total = pages.length;
  return pages.map((item, index) => seal(item, index, total, date));
}

function priceLabel(ask: number, input: ShopPdfInput): string {
  const coin = formatCopper(ask).replace("\u2212", "-");
  if (!input.showDollars) return coin;
  return `${coin}  (${formatDollars(ask, input.gpDollars).replace("\u2212", "-")})`;
}

function detailLabel(line: StockLine): string {
  const bits: string[] = [];
  if (line.rarity !== "common") bits.push(labelOf(RARITIES, line.rarity));
  if (line.quantity === null) bits.push("Always");
  else if (line.quantity <= 0) bits.push("Sold out");
  else bits.push(`${line.quantity} on hand`);
  if (line.notes.trim()) bits.push(line.notes.trim());
  if (line.rarity === "common" && line.quantity === null && !line.notes.trim()) return "";
  return bits.join("  ·  ");
}

function startPage(): Page {
  return {
    ops: ["0.957 0.937 0.894 rg", "0 0 612 792 re", "f", "0.110 0.098 0.078 rg"],
    y: TOP,
  };
}

function text(page: Page, value: string, size: number, font: "F1" | "F2", x: number) {
  textAt(page, value, size, font, x, page.y - size);
  page.y -= size + 4;
}

function textAt(page: Page, value: string, size: number, font: "F1" | "F2", x: number, baseline: number) {
  page.ops.push("0.110 0.098 0.078 rg", `BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${baseline.toFixed(2)} Tm (${pdfText(value)}) Tj ET`);
}

function muted(page: Page, value: string, size: number) {
  const baseline = page.y - size;
  page.ops.push("0.360 0.333 0.290 rg", `BT /F1 ${size} Tf 1 0 0 1 ${LEFT} ${baseline.toFixed(2)} Tm (${pdfText(value)}) Tj ET`, "0.110 0.098 0.078 rg");
  page.y -= size + 4;
}

function wrap(page: Page, value: string, size: number, font: "F1" | "F2", quiet: boolean) {
  for (const line of breakLines(value, RIGHT - LEFT, size)) {
    if (quiet) muted(page, line, size);
    else text(page, line, size, font, LEFT);
  }
}

function rule(page: Page) {
  const y = page.y;
  page.ops.push("0.184 0.435 0.384 RG", "1.25 w", `${LEFT} ${y.toFixed(2)} m ${RIGHT} ${y.toFixed(2)} l S`);
  page.y -= 2;
}

function hairline(page: Page) {
  const y = page.y;
  page.ops.push("0.780 0.745 0.675 RG", "0.6 w", `${LEFT} ${y.toFixed(2)} m ${RIGHT} ${y.toFixed(2)} l S`);
}

function seal(page: Page, index: number, total: number, date: string): string {
  const stamp = total > 1 ? `${date}   ${index + 1} / ${total}` : date;
  page.ops.push("0.360 0.333 0.290 rg", `BT /F1 9 Tf 1 0 0 1 ${LEFT} 36 Tm (${pdfText(stamp)}) Tj ET`);
  return page.ops.join("\n");
}

function measure(value: string, size: number): number {
  return value.length * size * 0.5;
}

function breakLines(value: string, maxWidth: number, size: number): string[] {
  const maxChars = Math.max(8, Math.floor(maxWidth / (size * 0.5)));
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  const pushWord = (word: string) => {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= maxChars) line = `${line} ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  };
  for (const word of words) {
    if (word.length <= maxChars) pushWord(word);
    else {
      for (let i = 0; i < word.length; i += maxChars) pushWord(word.slice(i, i + maxChars));
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function pdfText(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 92) out += "\\\\";
    else if (code === 40) out += "\\(";
    else if (code === 41) out += "\\)";
    else if (code >= 32 && code <= 126) out += char;
    else if (code >= 160 && code <= 255) out += `\\${code.toString(8).padStart(3, "0")}`;
    else {
      const mapped = WIN1252[code];
      if (mapped !== undefined) out += `\\${mapped.toString(8).padStart(3, "0")}`;
    }
  }
  return out;
}

const WIN1252: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
};

function assemble(contents: string[]): string {
  const count = contents.length;
  const objects: Array<string | { stream: string }> = [];
  const pageIds = contents.map((_, index) => 5 + index * 2);
  const contentIds = contents.map((_, index) => 6 + index * 2);
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${count} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`;
  contents.forEach((body, index) => {
    const pageId = pageIds[index] ?? 0;
    const contentId = contentIds[index] ?? 0;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`;
    objects[contentId] = { stream: body };
  });

  let out = "%PDF-1.4\n";
  const offsets = [0];
  const max = 4 + count * 2;
  for (let id = 1; id <= max; id += 1) {
    offsets[id] = out.length;
    const object = objects[id];
    if (!object) throw new Error("Missing PDF object.");
    if (typeof object === "string") out += `${id} 0 obj\n${object}\nendobj\n`;
    else out += `${id} 0 obj\n<< /Length ${object.stream.length} >>\nstream\n${object.stream}\nendstream\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${max + 1}\n`;
  out += "0000000000 65535 f \n";
  for (let id = 1; id <= max; id += 1) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${max + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
