import type { Coins } from "./types.ts";

export const COPPER = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 } as const;

export function emptyCoins(): Coins {
  return { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
}

export function toCopper(coins: Coins): number {
  return coins.cp * COPPER.cp + coins.sp * COPPER.sp + coins.ep * COPPER.ep + coins.gp * COPPER.gp + coins.pp * COPPER.pp;
}

export function fromCopper(total: number): Coins {
  let left = Math.max(0, Math.round(total));
  const gp = Math.floor(left / COPPER.gp);
  left -= gp * COPPER.gp;
  const sp = Math.floor(left / COPPER.sp);
  left -= sp * COPPER.sp;
  return { pp: 0, gp, ep: 0, sp, cp: left };
}

export function formatCopper(total: number): string {
  const sign = total < 0 ? "−" : "";
  let left = Math.abs(Math.round(total));
  const gp = Math.floor(left / COPPER.gp);
  left -= gp * COPPER.gp;
  const sp = Math.floor(left / COPPER.sp);
  left -= sp * COPPER.sp;
  const parts: string[] = [];
  if (gp) parts.push(`${gp} gp`);
  if (sp) parts.push(`${sp} sp`);
  if (left || parts.length === 0) parts.push(`${left} cp`);
  return sign + parts.join(", ");
}

export function formatDollars(copper: number, gpDollars: number): string {
  const negative = copper < 0;
  const value = (Math.abs(copper) / 100) * (Number.isFinite(gpDollars) ? gpDollars : 250);
  const body =
    value >= 20
      ? `$${Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`
      : `$${value.toFixed(2).replace(/\.00$/, "")}`;
  return negative ? `−${body}` : body;
}

export function formatCoins(coins: Coins): string {
  const parts: string[] = [];
  if (coins.gp) parts.push(`${coins.gp} gp`);
  if (coins.sp) parts.push(`${coins.sp} sp`);
  if (coins.cp) parts.push(`${coins.cp} cp`);
  if (coins.ep) parts.push(`${coins.ep} ep`);
  if (coins.pp) parts.push(`${coins.pp} pp`);
  if (parts.length === 0) parts.push("0 cp");
  return parts.join(", ");
}

/** Book rates: 10 cp = 1 sp, 10 sp = 1 gp, 10 gp = 1 pp, and 1 ep = 5 sp. */
export function carryToStandard(coins: Coins): Coins {
  let gp = Math.max(0, Math.floor(coins.gp)) + Math.max(0, Math.floor(coins.pp)) * 10;
  let sp = Math.max(0, Math.floor(coins.sp)) + Math.max(0, Math.floor(coins.ep)) * 5;
  let cp = Math.max(0, Math.floor(coins.cp));
  sp += Math.floor(cp / 10);
  cp %= 10;
  gp += Math.floor(sp / 10);
  sp %= 10;
  return { pp: 0, ep: 0, gp, sp, cp };
}

export function explainPurse(coins: Coins): string {
  const pp = whole(coins.pp);
  const ep = whole(coins.ep);
  const gp = whole(coins.gp);
  const sp = whole(coins.sp);
  const cp = whole(coins.cp);
  if (pp === 0 && ep === 0 && cp < 10 && sp < 10) return "";
  const terms: string[] = [];
  if (pp) terms.push(`${pp} pp`);
  if (gp) terms.push(`${gp} gp`);
  if (ep) terms.push(`${ep} ep`);
  if (sp) terms.push(`${sp} sp`);
  if (cp) terms.push(`${cp} cp`);
  const rate = ep ? "10 cp = 1 sp, 10 sp = 1 gp, 10 gp = 1 pp, 1 ep = 5 sp" : "10 cp = 1 sp, 10 sp = 1 gp, 10 gp = 1 pp";
  return `${terms.join(" + ")} = ${formatCoins(carryToStandard({ cp, sp, ep, gp, pp }))}, at ${rate}.`;
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number(value) || 0));
}

export function parsePrice(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  const pattern = /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(pp|gp|ep|sp|cp)\b/g;
  let total = 0;
  let found = false;
  for (const match of text.matchAll(pattern)) {
    found = true;
    const amount = Number(match[1]?.replace(/,/g, ""));
    const unit = match[2] as keyof typeof COPPER | undefined;
    if (!unit || Number.isNaN(amount)) continue;
    total += Math.round(amount * COPPER[unit]);
  }
  if (found) return total;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number(text) * COPPER.gp);
  return null;
}

export type PriceHit = {
  name: string;
  copper: number;
  quote: string;
};

export function pricesInText(text: string): PriceHit[] {
  const hits: PriceHit[] = [];
  const pattern = /(?<![\d.dD])(\d{1,6}(?:,\d{3})*(?:\.\d+)?)\s*(pp|gp|ep|sp|cp)\b/gi;
  for (const line of text.split(/\n+/)) {
    const matches = [...line.matchAll(pattern)];
    for (let i = 0; i < matches.length; i += 1) {
      const match = matches[i];
      if (!match) continue;
      const amount = Number((match[1] ?? "").replace(/,/g, ""));
      const unit = (match[2] ?? "").toLowerCase() as keyof typeof COPPER;
      if (!COPPER[unit] || Number.isNaN(amount)) continue;
      const copper = Math.round(amount * COPPER[unit]);
      if (copper <= 0 || copper > 100_000_000) continue;
      const start = i === 0 ? 0 : (matches[i - 1]?.index ?? 0) + (matches[i - 1]?.[0].length ?? 0);
      const index = match.index ?? 0;
      let name = line.slice(start, index).split(/[.;:]/).pop() ?? "";
      name = name.replace(/\b(costs?|priced at|worth|price(?: of)?|for|at|is|are)\s*$/i, "");
      name = name.replace(/^[\s\-–—*•\d.)]+/, "").replace(/[\s\-–—*•,]+$/g, "").replace(/\s+/g, " ").trim();
      if (name.length < 3 || name.length > 72) continue;
      if (/^(the|a|an|and|or|of|to|in)$/i.test(name)) continue;
      hits.push({ name, copper, quote: line.trim().slice(0, 180) });
    }
  }
  return hits;
}

const SPEND_ORDER = ["cp", "sp", "ep", "gp", "pp"] as const;
const BREAK_ORDER = ["sp", "ep", "gp", "pp"] as const;

export function spendCoins(coins: Coins, cost: number): Coins | null {
  if (cost < 0 || toCopper(coins) < cost) return null;
  if (cost === 0) return { ...coins };
  const next = { ...coins };
  let remaining = cost;
  for (const unit of SPEND_ORDER) {
    const use = Math.min(next[unit], Math.floor(remaining / COPPER[unit]));
    next[unit] -= use;
    remaining -= use * COPPER[unit];
  }
  if (remaining === 0) return next;
  for (const unit of BREAK_ORDER) {
    if (next[unit] <= 0 || COPPER[unit] < remaining) continue;
    next[unit] -= 1;
    let change = COPPER[unit] - remaining;
    for (const piece of ["gp", "ep", "sp", "cp"] as const) {
      if (COPPER[piece] >= COPPER[unit]) continue;
      const count = Math.floor(change / COPPER[piece]);
      next[piece] += count;
      change -= count * COPPER[piece];
    }
    return next;
  }
  return fromCopper(toCopper(coins) - cost);
}
