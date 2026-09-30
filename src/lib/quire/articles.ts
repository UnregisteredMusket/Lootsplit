import type { DraftArticle } from "./types.ts";

export type TextAtom = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RawLine = {
  text: string;
  size: number;
  x: number;
  y: number;
  width: number;
  page: number;
};

export type PageText = {
  width: number;
  lines: RawLine[];
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function clean(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}

export function itemsToLines(items: TextAtom[], page: number): RawLine[] {
  const usable = items.filter((item) => clean(item.str).length > 0);
  usable.sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: TextAtom[][] = [];
  for (const item of usable) {
    let placed = false;
    for (let index = groups.length - 1; index >= 0 && index > groups.length - 5; index -= 1) {
      const current = groups[index];
      const last = current?.[current.length - 1];
      if (!current || !last) continue;
      const y = current.reduce((sum, part) => sum + part.y, 0) / current.length;
      const height = current.reduce((sum, part) => sum + part.height, 0) / current.length;
      const gap = item.x - (last.x + last.width);
      const sameBand = Math.abs(item.y - y) <= Math.max(2, height * 0.4);
      if (sameBand && gap >= -1 && gap < 12) {
        current.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([item]);
  }

  return groups
    .map((group) => {
      group.sort((a, b) => a.x - b.x);
      let text = "";
      for (let i = 0; i < group.length; i += 1) {
        const item = group[i];
        if (!item) continue;
        if (i > 0) {
          const prev = group[i - 1];
          if (prev) {
            const gap = item.x - (prev.x + prev.width);
            const charWidth = prev.width / Math.max(1, prev.str.length);
            if (gap > charWidth * 0.3) text += " ";
          }
        }
        text += item.str;
      }
      const first = group[0];
      if (!first) return null;
      const end = Math.max(...group.map((item) => item.x + item.width));
      const heights = group.map((item) => item.height);
      return {
        text: clean(text),
        size: median(heights) || heights[0] || 10,
        x: first.x,
        y: first.y,
        width: end - first.x,
        page,
      };
    })
    .filter((line): line is RawLine => line !== null && line.text.length > 0);
}

function absorbDropCaps(lines: RawLine[]): RawLine[] {
  const caps = lines.filter(
    (line) => line.text.length === 1 && /[A-Za-z]/.test(line.text) && line.size >= 20,
  );
  const rest = lines
    .filter((line) => !caps.includes(line))
    .map((line) => ({ ...line }));
  for (const cap of caps) {
    const host = rest
      .filter(
        (line) =>
          line.page === cap.page &&
          line.x >= cap.x - 6 &&
          line.x <= cap.x + cap.size + 48 &&
          line.y >= cap.y - 6 &&
          line.y <= cap.y + cap.size * 1.3 &&
          /^[a-z(]/.test(line.text),
      )
      .sort((a, b) => b.y - a.y)[0];
    if (host) host.text = cap.text + host.text;
    else rest.push({ ...cap });
  }
  return rest;
}

function clusterOrigins(xs: number[]): number[] {
  if (xs.length < 4) return [];
  const sorted = xs.slice().sort((a, b) => a - b);
  const clusters: { x: number; n: number }[] = [];
  for (const x of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || x - last.x > 28) clusters.push({ x, n: 1 });
    else {
      last.x = (last.x * last.n + x) / (last.n + 1);
      last.n += 1;
    }
  }
  let best: { left: number; right: number; score: number } | null = null;
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = i + 1; j < clusters.length; j += 1) {
      const left = clusters[i];
      const right = clusters[j];
      if (!left || !right || left.n < 2 || right.n < 2) continue;
      const gap = right.x - left.x;
      if (gap < 120) continue;
      const score = gap + left.n * 8 + right.n * 8;
      if (!best || score > best.score) best = { left: left.x, right: right.x, score };
    }
  }
  return best ? [best.left, best.right] : [];
}

export function orderPage(lines: RawLine[], pageWidth: number): RawLine[] {
  const prepared = absorbDropCaps(lines).filter((line) => !isPageNumber(line.text));
  if (prepared.length === 0) return [];
  const heights = prepared.map((line) => line.size);
  const body = median(heights) || 10;
  const sample = prepared.filter(
    (line) => line.size < body * 1.25 && line.size > body * 0.7 && line.text.length > 15,
  );
  const origins = clusterOrigins((sample.length >= 4 ? sample : prepared).map((line) => line.x));
  if (origins.length < 2) {
    return prepared.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  }
  const leftOrigin = origins[0] ?? 0;
  const rightOrigin = origins[1] ?? pageWidth;
  const spanning: RawLine[] = [];
  const left: RawLine[] = [];
  const right: RawLine[] = [];
  for (const line of prepared) {
    const end = line.x + line.width;
    const nearLeft = Math.abs(line.x - leftOrigin) < 56;
    const nearRight = Math.abs(line.x - rightOrigin) < 56;
    const mid = line.x + line.width / 2;
    const centered =
      !nearLeft &&
      !nearRight &&
      line.width > 80 &&
      mid > leftOrigin + 70 &&
      mid < rightOrigin + 30;
    const fullBleed = end - line.x > pageWidth * 0.62 || (line.x < leftOrigin + 24 && end > rightOrigin + 16);
    if (centered || fullBleed) spanning.push(line);
    else if (line.x < (leftOrigin + rightOrigin) / 2) left.push(line);
    else right.push(line);
  }
  const ordered: RawLine[] = [];
  const spans = spanning.slice().sort((a, b) => b.y - a.y);
  const leftSorted = left.slice().sort((a, b) => b.y - a.y);
  const rightSorted = right.slice().sort((a, b) => b.y - a.y);
  let top = Number.POSITIVE_INFINITY;
  for (const span of [...spans, null]) {
    const bottom = span ? span.y : Number.NEGATIVE_INFINITY;
    ordered.push(
      ...leftSorted.filter((line) => line.y <= top && line.y > bottom),
      ...rightSorted.filter((line) => line.y <= top && line.y > bottom),
    );
    if (span) ordered.push(span);
    top = bottom;
  }
  return ordered;
}

function isPageNumber(text: string): boolean {
  return /^\d{1,4}$/.test(text);
}

function isMarginal(line: RawLine, lines: RawLine[]): boolean {
  const ys = lines.map((item) => item.y);
  const max = Math.max(...ys);
  const min = Math.min(...ys);
  const span = Math.max(1, max - min);
  if (line.y > max - span * 0.09 || line.y < min + span * 0.09) return true;
  const sorted = lines.slice().sort((a, b) => b.y - a.y);
  return sorted[0] === line || sorted[1] === line || sorted.at(-1) === line || sorted.at(-2) === line;
}

function stripChrome(pages: PageText[], body: number): RawLine[] {
  const ordered = pages.flatMap((page) => orderPage(page.lines, page.width));
  const byPage = new Map<number, RawLine[]>();
  for (const line of ordered) {
    const list = byPage.get(line.page) ?? [];
    list.push(line);
    byPage.set(line.page, list);
  }
  const marginalCounts = new Map<string, number>();
  const marginalIds = new Set<RawLine>();
  for (const lines of byPage.values()) {
    const seen = new Set<string>();
    for (const line of lines) {
      if (!isMarginal(line, lines) || line.size > body * 1.2) continue;
      marginalIds.add(line);
      const key = line.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      marginalCounts.set(key, (marginalCounts.get(key) ?? 0) + 1);
    }
  }
  return ordered.filter((line) => {
    if (isPageNumber(line.text)) return false;
    if (!marginalIds.has(line)) return true;
    return (marginalCounts.get(line.text.toLowerCase()) ?? 0) < 3;
  });
}

function repairHeading(text: string): string {
  const broken = /[a-z][A-Z]/.test(text) || /[A-Z]{2}[a-z]/.test(text);
  const repaired = broken
    ? text.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    : text;
  const letters = repaired.replace(/[^A-Za-z]/g, "");
  const uppers = letters.replace(/[^A-Z]/g, "").length;
  if (letters.length > 3 && uppers <= 1) {
    return repaired.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }
  if ((repaired.match(/\b[a-z]{4,}/g) ?? []).length >= 1) {
    return repaired.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }
  return repaired;
}

function looksLikeHeading(text: string, size: number, body: number): boolean {
  if (text.length < 2 || text.length > 90) return false;
  if (isPageNumber(text)) return false;
  if (/[.?!]$/.test(text) && text.length > 40) return false;
  if (size >= body * 1.18) return true;
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length > 3 && letters === letters.toUpperCase() && text.length <= 60;
}

type Block = {
  text: string;
  page: number;
  heading: boolean;
};

function blocksFromLines(lines: RawLine[], body: number): Block[] {
  const blocks: Block[] = [];
  let paragraph = "";
  let paragraphPage = 0;
  let previous: RawLine | null = null;

  const flush = () => {
    const text = clean(paragraph).replace(/^[A-Z](?=[A-Z][a-z]{2})/, "");
    if (text) blocks.push({ text, page: paragraphPage, heading: false });
    paragraph = "";
  };

  for (const line of lines) {
    if (looksLikeHeading(line.text, line.size, body)) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.heading && last.page === line.page) last.text = repairHeading(clean(`${last.text} ${line.text}`));
      else blocks.push({ text: repairHeading(clean(line.text)), page: line.page, heading: true });
      previous = line;
      continue;
    }
    if (!previous) {
      paragraph = line.text;
      paragraphPage = line.page;
      previous = line;
      continue;
    }
    const gap = previous.y - line.y;
    const sameBaseline = line.page === previous.page && Math.abs(line.y - previous.y) <= 2 && line.x >= previous.x;
    const columnJump = line.y > previous.y + 4 || line.page !== previous.page;
    const indented = !sameBaseline && line.x > previous.x + 6 && line.size <= previous.size * 1.2;
    const loose = gap > Math.max(previous.size, line.size) * 1.7;
    const hyphen = /[A-Za-z]-$/.test(paragraph) && /^[a-z]/.test(line.text) && !columnJump && gap > 0 && gap < 28;
    if (hyphen) {
      paragraph = paragraph.slice(0, -1) + line.text;
    } else if (sameBaseline) {
      paragraph = `${paragraph} ${line.text}`;
    } else if (columnJump || indented || loose) {
      flush();
      paragraph = line.text;
      paragraphPage = line.page;
    } else {
      paragraph = `${paragraph} ${line.text}`;
    }
    previous = line;
  }
  flush();
  return blocks;
}

function clipTitle(text: string): string {
  const first = clean(text.split("\n")[0] ?? "");
  if (first.length <= 72) return first || "Entry";
  return `${first.slice(0, 69).trimEnd()}…`;
}

function sectionsFromBlocks(blocks: Block[]): DraftArticle[] {
  const drafts: DraftArticle[] = [];
  let title = "";
  let paras: string[] = [];
  let pageStart = 0;
  let pageEnd = 0;
  let kicker = "";

  const flush = () => {
    const text = paras.join("\n\n").trim();
    if (!title && !text) return;
    if (text.length < 24) {
      if (title) kicker = kicker ? `${kicker}: ${title}` : title;
      title = "";
      paras = [];
      return;
    }
    const fullTitle = kicker ? `${kicker}: ${title || clipTitle(text)}` : title || clipTitle(text);
    drafts.push({
      title: fullTitle,
      text,
      pageStart: pageStart || pageEnd,
      pageEnd: pageEnd || pageStart,
    });
    kicker = "";
    title = "";
    paras = [];
  };

  for (const block of blocks) {
    if (block.heading) {
      flush();
      title = block.text;
      pageStart = block.page;
      pageEnd = block.page;
      continue;
    }
    if (!pageStart) pageStart = block.page;
    pageEnd = block.page;
    paras.push(block.text);
  }
  flush();
  return splitLong(drafts);
}

function splitLong(drafts: DraftArticle[]): DraftArticle[] {
  const out: DraftArticle[] = [];
  for (const draft of drafts) {
    const span = draft.pageEnd - draft.pageStart;
    if (span <= 2 && draft.text.length <= 6000) {
      out.push(draft);
      continue;
    }
    const parts = draft.text.split(/\n\n+/);
    let buf: string[] = [];
    let chars = 0;
    let index = 0;
    const push = () => {
      const text = buf.join("\n\n").trim();
      if (text.length < 40) return;
      index += 1;
      out.push({
        title: index === 1 ? draft.title : `${draft.title} · ${index}`,
        text,
        pageStart: draft.pageStart,
        pageEnd: draft.pageEnd,
      });
      buf = [];
      chars = 0;
    };
    for (const part of parts) {
      if (chars > 2800 && buf.length > 0) push();
      buf.push(part);
      chars += part.length;
    }
    push();
  }
  return out;
}

function pageArticles(pages: PageText[], body: number): DraftArticle[] {
  let carry = "";
  const drafts: DraftArticle[] = [];
  for (const page of pages) {
    const lines = orderPage(page.lines, page.width).filter((line) => !isPageNumber(line.text));
    if (lines.length === 0) continue;
    const heading = lines.find((line) => looksLikeHeading(line.text, line.size, body));
    if (heading) carry = heading.text;
    const text = blocksFromLines(
      lines.filter((line) => line !== heading),
      body,
    )
      .filter((block) => !block.heading)
      .map((block) => block.text)
      .join("\n\n")
      .trim();
    if (text.length < 80) continue;
    const pageNo = lines[0]?.page ?? 0;
    drafts.push({
      title: heading?.text || carry || clipTitle(text),
      text,
      pageStart: pageNo,
      pageEnd: pageNo,
    });
  }
  return drafts;
}

function disambiguate(drafts: DraftArticle[]): DraftArticle[] {
  const counts = new Map<string, number>();
  for (const draft of drafts) counts.set(draft.title, (counts.get(draft.title) ?? 0) + 1);
  const seen = new Map<string, number>();
  return drafts.map((draft) => {
    if ((counts.get(draft.title) ?? 0) < 2) return draft;
    const next = (seen.get(draft.title) ?? 0) + 1;
    seen.set(draft.title, next);
    if (next === 1) return draft;
    return { ...draft, title: `${draft.title} · p. ${draft.pageStart}` };
  });
}

export function buildArticles(pages: PageText[]): DraftArticle[] {
  const withText = pages.filter((page) => page.lines.some((line) => clean(line.text).length > 0));
  if (withText.length === 0) return [];
  const sizes = withText.flatMap((page) => page.lines.filter((line) => line.text.length > 30).map((line) => line.size));
  const body = median(sizes) || median(withText.flatMap((page) => page.lines.map((line) => line.size))) || 10;
  const lines = stripChrome(withText, body);
  const sectional = disambiguate(sectionsFromBlocks(blocksFromLines(lines, body)));
  const thin = sectional.filter((article) => article.text.length < 80).length;
  const fragmented = sectional.length > 8 && thin / sectional.length > 0.45;
  const coarse = withText.length >= 6 && sectional.length < withText.length / 8;
  if (!fragmented && !coarse && sectional.length > 0) return sectional;
  const paged = disambiguate(pageArticles(withText, body));
  return paged.length > 0 ? paged : sectional;
}

export function snippetAround(text: string, query: string): { before: string; match: string; after: string } | null {
  const flat = text.replace(/\s+/g, " ").trim();
  const needle = query.trim();
  if (!needle) return null;
  const index = flat.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return null;
  const start = Math.max(0, index - 72);
  const end = Math.min(flat.length, index + needle.length + 72);
  return {
    before: `${start > 0 ? "…" : ""}${flat.slice(start, index)}`,
    match: flat.slice(index, index + needle.length),
    after: `${flat.slice(index + needle.length, end)}${end < flat.length ? "…" : ""}`,
  };
}
