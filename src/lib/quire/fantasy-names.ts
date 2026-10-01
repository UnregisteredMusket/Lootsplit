import { pick } from "./names.ts";
import type { LexemeKind } from "./types.ts";
// Original syllable and word combinations, bundled locally. No external name service.
export const NAME_STYLES = [
  { value: "frontier", label: "Frontier folk" },
  { value: "northern", label: "Northern sagas" },
  { value: "sylvan", label: "Sylvan courts" },
  { value: "stone", label: "Stone halls" },
  { value: "shadow", label: "Shadow & candle" },
] as const;
export type NameStyle = (typeof NAME_STYLES)[number]["value"];
const POOLS: Record<
  NameStyle,
  { start: string[]; end: string[]; family: string[]; land: string[] }
> = {
  frontier: {
    start: ["Bel", "Cor", "Dar", "El", "Fen", "Har", "Jes", "Mar", "Nor", "Ros", "Tal", "Wen"],
    end: ["a", "en", "in", "ra", "is", "ley", "on", "ren"],
    family: [
      "Ashbrook",
      "Copperfield",
      "Wrenwell",
      "Mossgate",
      "Dawnford",
      "Barleycross",
      "Reedvale",
      "Flintwood",
    ],
    land: ["Barley", "Moss", "Clover", "Ash", "Willow", "Reed", "Copper", "Hazel"],
  },
  northern: {
    start: ["Arn", "Bjor", "Dag", "Eir", "Gunn", "Hal", "Ing", "Rag", "Siv", "Tor", "Ulf", "Yr"],
    end: ["a", "ar", "dis", "rik", "run", "vald", "vi", "mund"],
    family: [
      "Frostwake",
      "Stormoath",
      "Rimehand",
      "Snowmantle",
      "Emberhelm",
      "Greyseal",
      "Winteroak",
      "Ironfjord",
    ],
    land: ["Frost", "Storm", "Rime", "Winter", "Seal", "Pine", "Wolf", "North"],
  },
  sylvan: {
    start: ["Aer", "Cael", "El", "Fae", "Ith", "Lau", "Leth", "Mir", "Nae", "Syl", "Thal", "Vael"],
    end: ["iel", "ara", "ion", "eth", "wyn", "ora", "ian", "is"],
    family: [
      "Dewsong",
      "Moonbranch",
      "Silvermoss",
      "Stillbloom",
      "Starwillow",
      "Mistpetal",
      "Dawnglade",
      "Leafwhisper",
    ],
    land: ["Moon", "Dew", "Star", "Silver", "Mist", "Fern", "Lily", "Dawn"],
  },
  stone: {
    start: [
      "Bal",
      "Brom",
      "Dur",
      "Gar",
      "Hild",
      "Karn",
      "Kor",
      "Mor",
      "Rud",
      "Thra",
      "Tor",
      "Varr",
    ],
    end: ["in", "a", "dan", "ra", "rik", "na", "grim", "dis"],
    family: [
      "Bronzevein",
      "Flintbrow",
      "Deepchisel",
      "Graniteward",
      "Coppermantle",
      "Ironroot",
      "Coalhand",
      "Emberpick",
    ],
    land: ["Granite", "Copper", "Basalt", "Bronze", "Flint", "Iron", "Coal", "Deep"],
  },
  shadow: {
    start: ["Ash", "Cor", "Drev", "Es", "Mal", "Mor", "Ner", "Or", "Ser", "Val", "Ves", "Ys"],
    end: ["a", "en", "ith", "ora", "is", "ren", "ian", "eth"],
    family: [
      "Candlewick",
      "Thornveil",
      "Duskward",
      "Blackfen",
      "Hollowbell",
      "Ashvigil",
      "Rookgrave",
      "Paleglass",
    ],
    land: ["Dusk", "Thorn", "Rook", "Candle", "Ash", "Pale", "Hollow", "Black"],
  },
};
export function fantasyName(
  kind: LexemeKind,
  style: NameStyle,
  rng: () => number = Math.random,
): string {
  const p = POOLS[style] || POOLS.frontier;
  if (kind === "person") return `${pick(p.start, rng)}${pick(p.end, rng)} ${pick(p.family, rng)}`;
  if (kind === "shop")
    return `The ${pick(p.land, rng)} ${pick(["Lantern", "Stag", "Quill", "Kettle", "Crown", "Sparrow", "Anvil", "Fox", "Cup", "Rose", "Key", "Cask"], rng)}`;
  if (kind === "continent")
    return `${pick(p.start, rng)}${pick(["oria", "avara", "ereth", "undra", "alas", "emora", "athis", "ovia"], rng)}`;
  if (kind === "country")
    return `${pick(["Kingdom", "Marches", "Freeholds", "Dominion", "Confederacy", "Principality"], rng)} of ${pick(p.land, rng)}${pick(["mere", "mark", "vale", "reach", "haven", "gard"], rng)}`;
  if (kind === "region")
    return `The ${pick(p.land, rng)} ${pick(["Highlands", "Coast", "Marshes", "Wilds", "Downs", "Valley", "Wastes", "Isles"], rng)}`;
  return `${pick(p.land, rng)}${pick(["ford", "haven", "bridge", "wick", "mere", "gate", "holm", "stead", "watch", "fall", "brook", "crest"], rng)}`;
}
export function fantasyBatch(
  kind: LexemeKind,
  style: NameStyle,
  count = 6,
  rng: () => number = Math.random,
): string[] {
  const names = new Set<string>(),
    limit = Math.max(1, Math.min(12, Math.floor(count) || 6));
  for (let i = 0; i < 200 && names.size < limit; i++) names.add(fantasyName(kind, style, rng));
  return [...names];
}
