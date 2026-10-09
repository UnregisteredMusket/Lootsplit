import { z } from "zod";
import { formatCopper } from "./money.ts";

const id = z.string().min(1).max(200);
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** A deed is attached to its property lot, never a second valued or independently spendable asset. */
export const propertyDeedSchema = z.object({
  id,
  transactionId: id,
  listingId: id,
  propertyName: z.string(),
  location: z.string(),
  buyerId: id,
  buyerName: z.string(),
  ownerId: id,
  ownerName: z.string(),
  purchasedAt: z.number().min(0).max(8640000000000000),
  campaignDay: amount,
  unitCopper: amount,
  totalCopper: amount,
  purchasedQuantity: amount.positive(),
  previousDeedId: id.optional(),
  transferredAt: z.number().finite().optional(),
  transferId: id.optional(),
});
export type PropertyDeed = z.infer<typeof propertyDeedSchema>;
export function transferPropertyDeed(
  deed: PropertyDeed,
  owner: { id: string; name: string },
  receipt: string,
  at: number,
): PropertyDeed {
  return {
    ...deed,
    id: `${receipt}-deed`,
    previousDeedId: deed.id,
    ownerId: owner.id,
    ownerName: owner.name,
    transferredAt: at,
    transferId: receipt,
  };
}

const escape = (text: string | number) =>
  String(text).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!,
  );
function lines(value: string, length = 30) {
  const words = value.split(/\s+/),
    rows: string[] = [];
  let row = "";
  for (const word of words) {
    // Break long unspaced names without losing any characters.
    for (let start = 0; start < word.length; start += length) {
      const part = word.slice(start, start + length);
      if (row && row.length + part.length + 1 > length) {
        rows.push(row);
        row = "";
      }
      row += (row ? " " : "") + part;
    }
  }
  if (row) rows.push(row);
  return rows.length ? rows : ["Not recorded"];
}
/** Exact data goes into a deterministic SVG template; escaped text cannot become markup. */
export function propertyDeedSvg(deed: PropertyDeed, quantity = deed.purchasedQuantity): string {
  let y = 255;
  const sections: string[] = [];
  for (const [label, value] of [
    ["PROPERTY", deed.propertyName],
    ["LOCATION AT PURCHASE", deed.location],
    ["REGISTERED HOLDER", deed.ownerName],
    ["ORIGINAL BUYER", deed.buyerName],
    [
      "CONSIDERATION",
      `${formatCopper(deed.totalCopper)} paid for ${deed.purchasedQuantity} · ${formatCopper(deed.unitCopper)} each`,
    ],
    [
      "RECORDED",
      `Campaign day ${deed.campaignDay} · ${new Date(deed.purchasedAt).toISOString().slice(0, 10)}`,
    ],
    ["THIS DEED COVERS", `${quantity} property ${quantity === 1 ? "unit" : "units"}`],
    ["PURCHASE RECEIPT", deed.transactionId],
    ["DEED REGISTER", deed.id],
    ...(deed.transferId
      ? [
          ["TRANSFER RECEIPT", deed.transferId],
          ["PREVIOUS DEED", deed.previousDeedId || ""],
        ]
      : []),
  ]) {
    sections.push(`<text x="94" y="${y}" class="label">${escape(label)}</text>`);
    y += 27;
    for (const line of lines(value)) {
      sections.push(`<text x="94" y="${y}" class="value">${escape(line)}</text>`);
      y += 28;
    }
    y += 22;
  }
  const height = Math.max(1160, y + 152);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="${height}" viewBox="0 0 820 ${height}">
    <style>.label{font:14px sans-serif;letter-spacing:2px;fill:#795438}.value{font:21px Georgia,serif;fill:#352315}</style>
    <rect width="820" height="${height}" fill="#efe1bd"/><rect x="24" y="24" width="772" height="${height - 48}" fill="none" stroke="#946931" stroke-width="3"/>
    <rect x="36" y="36" width="748" height="${height - 72}" fill="none" stroke="#ad8851"/>
    <path d="M64 98h692M64 210h692" stroke="#ad8851"/><text x="410" y="78" text-anchor="middle" class="label">LOOTSPLIT · REGISTER OF ESTATES</text>
    <text x="410" y="151" text-anchor="middle" font-family="Georgia,serif" font-size="48" fill="#6e2922">Deed of Ownership</text>
    <text x="410" y="185" text-anchor="middle" class="label">BE IT RECORDED IN THE CAMPAIGN LEDGER</text>
    ${sections.join("")}
    <circle cx="668" cy="${height - 109}" r="43" fill="#812e29"/><circle cx="668" cy="${height - 109}" r="33" fill="none" stroke="#d9ad67"/>
    <path d="M654 ${height - 119}h28v25h-28zM651 ${height - 119}l17 -15 17 15M663 ${height - 108}h10v14" fill="none" stroke="#e7c68d" stroke-width="2"/>
    <text x="94" y="${height - 102}" class="label">RECORDED · SEALED · HELD IN TRUST</text>
    <text x="94" y="${height - 70}" font-family="Georgia,serif" font-size="16" fill="#795438">Ownership follows the property in your inventory.</text>
  </svg>`;
}
export function propertyDeedImage(deed: PropertyDeed, quantity?: number) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(propertyDeedSvg(deed, quantity))}`;
}
