import { pricesInText, type PriceHit } from "./money.ts";
import type { ItemCategory, ItemRarity, LexemeKind } from "./types.ts";

export type LexemeHit = {
  name: string;
  kind: LexemeKind;
  notes: string;
};

const NAME = "([A-Z][a-zA-Z'’-]{2,}(?:\\s+[A-Z][a-zA-Z'’-]{2,}){0,3})";

const BODY: Array<{ kind: LexemeKind; re: RegExp }> = [
  { kind: "continent", re: new RegExp(`\\b(?:[Cc]ontinent|[Ww]orld)\\s+of\\s+${NAME}`, "g") },
  {
    kind: "country",
    re: new RegExp(
      `\\b(?:[Kk]ingdom|[Ee]mpire|[Rr]epublic|[Pp]rincipality|[Cc]ountry|[Nn]ation|[Rr]ealm)\\s+of\\s+${NAME}`,
      "g",
    ),
  },
  {
    kind: "region",
    re: new RegExp(
      `\\b(?:[Dd]uchy|[Pp]rovince|[Cc]ounty|[Rr]egion|[Mm]arches)\\s+of\\s+${NAME}`,
      "g",
    ),
  },
  {
    kind: "place",
    re: new RegExp(
      `\\b(?:[Cc]ity|[Tt]own|[Vv]illage|[Pp]ort|[Hh]amlet|[Cc]apital|[Ff]orest)\\s+of\\s+${NAME}`,
      "g",
    ),
  },
  {
    kind: "shop",
    re: /\b([A-Z][a-zA-Z'’-]{2,}(?:\s+[A-Z][a-zA-Z'’-]{2,}){0,3}\s+(?:Inn|Tavern|Smithy|Market|Emporium|Apothecary|Bakery|Shop))\b/g,
  },
  { kind: "person", re: new RegExp(`\\b(?:[Nn]amed|[Cc]alled|[Kk]nown as)\\s+${NAME}`, "g") },
];

const STOP = new Set([
  "the",
  "chapter",
  "part",
  "section",
  "introduction",
  "contents",
  "index",
  "appendix",
]);

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function remember(found: Map<string, LexemeHit>, kind: LexemeKind, raw: string, notes: string) {
  const name = clean(raw).replace(/^(?:the|a|an)\s+/i, (word) => (kind === "shop" ? word : ""));
  const trimmed = kind === "shop" ? clean(raw) : clean(name);
  if (trimmed.length < 3 || trimmed.length > 48) return;
  if (STOP.has(trimmed.toLowerCase())) return;
  const key = `${kind}|${trimmed.toLowerCase()}`;
  if (!found.has(key)) found.set(key, { name: trimmed, kind, notes });
}

function fromTitle(title: string, found: Map<string, LexemeHit>) {
  const text = clean(title);
  if (
    !text ||
    text.length > 48 ||
    STOP.has(text.toLowerCase()) ||
    /\b(notes?|inventory|equipment|rules|actions?|traits?|features?|abilities|spells?|contents|summary|overview)\b/i.test(
      text,
    )
  )
    return;
  if (/\b(inn|tavern|smithy|market|emporium|apothecary|bakery|shop|stall)\b/i.test(text)) {
    remember(found, "shop", text, "Heading");
    return;
  }
  if (/\bcontinent\b/i.test(text)) {
    remember(found, "continent", text, "Heading");
    return;
  }
  if (/\b(kingdom|empire|republic|realm|country|nation)\b/i.test(text)) {
    remember(found, "country", text, "Heading");
    return;
  }
  if (/\b(duchy|province|county|region|marches)\b/i.test(text)) {
    remember(found, "region", text, "Heading");
    return;
  }
  if (/\b(city|town|village|port|forest|mountains|keep|castle)\b/i.test(text)) {
    remember(found, "place", text, "Heading");
    return;
  }
  if (/^[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){1,2}$/.test(text))
    remember(found, "person", text, "Heading");
}

export function extractLexemes(articles: Array<{ title: string; text: string }>): LexemeHit[] {
  const found = new Map<string, LexemeHit>();
  for (const article of articles) {
    fromTitle(article.title, found);
    const blob = `${article.title}\n${article.text}`;
    for (const rule of BODY) {
      for (const match of blob.matchAll(rule.re)) {
        const captured = match[1];
        if (captured)
          remember(found, rule.kind, captured, `Read from ${article.title || "a book"}`);
      }
    }
  }
  return [...found.values()].slice(0, 160);
}

export function guessCategory(name: string): ItemCategory {
  const text = name.toLowerCase();
  if (/sword|armor|mail|axe|spear|blade|shield|helm|hinge|nail|forge|anvil/.test(text))
    return "smith";
  if (/cloak|boot|robe|glove|shirt|silk|mantle|hood|hem/.test(text)) return "cloth";
  if (/potion|herb|vial|salve|tincture|willow|fever|kit|draught/.test(text)) return "apothecary";
  if (/room|night|ale|meal|supper|loaf|wine|cider|ration|cheese|honey/.test(text))
    return /\b(loaf|cheese|honey|fish|tack|salt|saffron|cider)\b/.test(text) ? "provisions" : "inn";
  if (/horse|mule|feed|saddle|oat|harness|stabl/.test(text)) return "stable";
  if (/ink|paper|scroll|map|quill|journal|charter/.test(text)) return "scribe";
  if (/gem|ring|pearl|jewel|brooch|signet|chain/.test(text)) return "jewels";
  if (/ward|charm|relic|cameo|clasp|idol|chalk/.test(text)) return "curios";
  if (/bread|flour|salt|oil|meat|fish|biscuit/.test(text)) return "provisions";
  return "general";
}

export function guessRarity(copper: number): ItemRarity {
  if (copper >= 50000) return "magic";
  if (copper >= 5000) return "rare";
  if (copper >= 400) return "uncommon";
  return "common";
}

export type GoodHit = {
  name: string;
  copper: number;
  category: ItemCategory;
  rarity: ItemRarity;
  quote: string;
  source: string;
  conflict: boolean;
};

export function goodsFromText(
  articles: Array<{ text: string; title?: string; pageStart?: number; pageEnd?: number }>,
): GoodHit[] {
  const raw = articles.flatMap((article) =>
    pricesInText(stitchPriceLines(article.text)).map((hit) => ({
      ...hit,
      source: [
        article.title,
        article.pageStart
          ? `p. ${article.pageStart}${article.pageEnd && article.pageEnd !== article.pageStart ? `–${article.pageEnd}` : ""}`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    })),
  );
  const named = raw
    .map((hit) => ({ ...hit, name: polishGoodName(hit.name) }))
    .filter((hit) => hit.name.length > 0);
  const coherent = named.filter((hit) => isCoherentGood(hit.name, hit.quote));
  return dedupeGoods(coherent).slice(0, 200);
}

function stitchPriceLines(text: string): string {
  const lines = text.split(/\n+/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? "";
    const next = lines[i + 1]?.trim() ?? "";
    const priceOnly =
      /^\d{1,6}(?:,\d{3})*(?:\.\d+)?\s*(?:(?:pp|gp|ep|sp|cp)|(?:gold|silver|copper|electrum|platinum) pieces?)(?:[.,]|\s|$)/i.test(
        next,
      );
    const label =
      line.length > 2 &&
      line.length < 48 &&
      !/[.?!]$/.test(line) &&
      !/\b(?:pp|gp|ep|sp|cp)\b/i.test(line);
    if (label && priceOnly) {
      out.push(`${line} ${next}`);
      i += 1;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function polishGoodName(raw: string): string {
  let name = raw.replace(/\s+/g, " ").trim();
  name = name.replace(/^(?:a|an|the)\s+/i, "");
  name = name.replace(/\s+(?:costs?|priced at|worth|price(?: of)?)$/i, "");

  name = name.replace(/\b\d*d(?:4|6|8|10|12|20|100)\b/gi, "");
  name = name.replace(/^[\s,.;:–—-]+/, "").replace(/[.,;:–—-]+$/g, "");
  name = name.replace(/\s+/g, " ").trim();
  if (/[A-Za-z]/.test(name) && name === name.toUpperCase()) {
    const lower = name.toLowerCase();
    name = lower.charAt(0).toUpperCase() + lower.slice(1);
  } else if (/^[a-z]/.test(name)) {
    name = name.charAt(0).toUpperCase() + name.slice(1);
  }
  return name;
}

const FUNCTION_WORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "and",
  "or",
  "to",
  "in",
  "on",
  "for",
  "with",
  "from",
  "by",
  "at",
  "as",
  "per",
  "its",
  "his",
  "her",
  "their",
  "your",
  "our",
]);
const ABSTRACT = new Set([
  "cost",
  "price",
  "total",
  "sum",
  "fee",
  "fine",
  "tax",
  "reward",
  "bounty",
  "treasure",
  "gold",
  "silver",
  "copper",
  "platinum",
  "electrum",
  "payment",
  "amount",
  "value",
  "wage",
  "salary",
  "level",
  "chapter",
  "page",
  "figure",
  "table",
  "round",
  "turn",
]);
const VERB =
  /\b(is|are|was|were|be|been|being|has|have|had|paid|pay|pays|offered|offer|gave|give|gives|took|take|takes|said|says|contains|contain|holds|found|find|finds|earned|earns|receives|receive|deals|makes|made|will|would|could|should|bought|sold|spends|spent|owes|attacks|casts)\b/i;
const NOT_A_GOOD =
  /\b(damage|saving throw|ability check|experience|hit points|challenge rating|spell slot|bonus action|dice|reward|bounty|salary|wage|treasure|hoard)\b/i;

function isCoherentGood(name: string, quote: string): boolean {
  if (name.length < 3 || name.length > 48) return false;
  if (/[?]/.test(name) || /^\d/.test(name)) return false;
  if (VERB.test(name) || NOT_A_GOOD.test(name)) return false;
  if (/\b(?:you|your|party|adventurers?)\b/i.test(name)) return false;
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 7) return false;
  const content = words.filter(
    (word) => !FUNCTION_WORDS.has(word.toLowerCase().replace(/[^a-z]/g, "")),
  );
  if (!content.some((word) => /[A-Za-z]{3,}/.test(word))) return false;
  if (content.every((word) => ABSTRACT.has(word.toLowerCase().replace(/[^a-z]/g, ""))))
    return false;
  if (quote.length > 120 && words.length > 3) return false;
  if (
    /\b(?:chest|coffer|pouch|strongbox|hoard)\b/i.test(quote) &&
    /\b(?:contain|holds|hold|filled|full of|inside)\b/i.test(quote)
  )
    return false;
  if (
    /\b(?:per|each)\s+(?:day|week|month|year|hour)\b/i.test(quote) &&
    !/\b(?:room|meal|night|stable|stabling|board|lodging|ration)\b/i.test(name)
  )
    return false;
  if (/\b\d*d(?:4|6|8|10|12|20|100)\b/i.test(quote) && words.length < 2) return false;
  return true;
}

function dedupeGoods(hits: Array<PriceHit & { name: string; source: string }>): GoodHit[] {
  const kept = new Map<string, PriceHit & { name: string; source: string }>();
  for (const hit of hits) {
    const key = `${hit.name.toLowerCase()}|${hit.copper}`;
    const previous = kept.get(key);
    if (!previous || hit.quote.length < previous.quote.length) kept.set(key, hit);
  }
  return [...kept.values()].map((hit) => ({
    name: hit.name,
    copper: hit.copper,
    category: guessCategory(hit.name),
    rarity: guessRarity(hit.copper),
    quote: hit.quote,
    source: hit.source,
    conflict: [...kept.values()].some(
      (other) => other.name.toLowerCase() === hit.name.toLowerCase() && other.copper !== hit.copper,
    ),
  }));
}
