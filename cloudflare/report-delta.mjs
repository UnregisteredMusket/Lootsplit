/**
 * Delta-stored archived sessions (storage follow-up to history on demand).
 *
 * Every archived session is a snapshot of the whole campaign table at that moment, so consecutive
 * archives repeat almost everything (characters, shops, stock, the world, the trade economy);
 * only the session's ledger, chat and events and whatever changed are new. A snapshot is stored as
 * a delta against an earlier full snapshot of the same room (its base) when that saves at least a
 * fifth.
 *
 * This is a storage encoding only. Readers always receive the exact original snapshot text: the
 * delta is decoded and the text's SHA-256 checked against the snapshot's reference, so a damaged
 * delta or base is an error, never history. The command engines (commands.ts, economy.ts) never see
 * deltas. A delta is only stored when decoding it reproduces the snapshot text byte for byte.
 *
 * Node encoding (a JSON array, so no key can collide with campaign data):
 * - `["s"]`: the same value as the base at this position.
 * - `["v", value]`: a literal value.
 * - `["o", [[key, node], ...]]`: an object, keys in their original order, each against the base
 *   object's value for that key.
 * - `["a", [elementNode, ...]]`: an array of objects with unique string `id`s, each element as
 *   `["i", id]` (identical to the base element with that id), `["d", id, node]` (an object node
 *   against that base element) or a literal node.
 * Objects and id-keyed arrays are diffed to `MAX_DEPTH` levels; deeper values are literal unless
 * equal.
 */
export const REPORT_DELTA_KEY = "$reportDelta";
const MAX_DEPTH = 6;

const plain = (/** @type {unknown} */ value) => !!value && typeof value === "object" && !Array.isArray(value);
/** @param {unknown} value */
function idArray(value) {
  if (!Array.isArray(value) || !value.length) return null;
  const ids = new Map();
  for (const item of value) {
    if (!plain(item) || typeof item.id !== "string" || ids.has(item.id)) return null;
    ids.set(item.id, item);
  }
  return ids;
}

/**
 * @param {any} value @param {unknown} base @param {number} depth @param {string} [text] value's JSON
 * @returns {unknown[]}
 */
function encodeNode(value, base, depth, text) {
  const own = text ?? JSON.stringify(value);
  if (base !== undefined && own === JSON.stringify(base)) return ["s"];
  if (depth >= MAX_DEPTH) return ["v", value];
  if (plain(value) && plain(base)) {
    const source = /** @type {Record<string, unknown>} */ (base);
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (value)).map(([key, child]) => [key, encodeNode(child, source[key], depth + 1)]);
    return ["o", entries];
  }
  const baseIds = idArray(base);
  const ownIds = baseIds && idArray(value);
  if (baseIds && ownIds) {
    return [
      "a",
      /** @type {any[]} */ (value).map((item) => {
        const previous = baseIds.get(item.id);
        if (!previous) return ["v", item];
        const node = encodeNode(item, previous, depth + 1);
        return node[0] === "s" ? ["i", item.id] : node[0] === "o" ? ["d", item.id, node] : node;
      }),
    ];
  }
  return ["v", value];
}

/** @param {any} node @param {unknown} base @returns {unknown} */
function decodeNode(node, base) {
  const broken = () => Error("An archived session report is damaged. Keep the original recovery export; the campaign was not changed.");
  if (!Array.isArray(node)) throw broken();
  switch (node[0]) {
    case "s":
      if (base === undefined) throw broken();
      return structuredClone(base);
    case "v":
      return node[1];
    case "o": {
      if (!Array.isArray(node[1])) throw broken();
      const source = plain(base) ? /** @type {Record<string, unknown>} */ (base) : {};
      /** @type {Record<string, unknown>} */
      const result = {};
      for (const entry of node[1]) {
        if (!Array.isArray(entry) || typeof entry[0] !== "string") throw broken();
        result[entry[0]] = decodeNode(entry[1], source[entry[0]]);
      }
      return result;
    }
    case "a": {
      const ids = idArray(base);
      if (!ids || !Array.isArray(node[1])) throw broken();
      return node[1].map((element) => {
        if (!Array.isArray(element)) throw broken();
        if (element[0] === "i") {
          if (!ids.has(element[1])) throw broken();
          return structuredClone(ids.get(element[1]));
        }
        if (element[0] === "d") {
          if (!ids.has(element[1])) throw broken();
          return decodeNode(element[2], ids.get(element[1]));
        }
        return decodeNode(element, undefined);
      });
    }
    default:
      throw broken();
  }
}

/**
 * The delta body for `text` (a snapshot stored under `reference`) against `base` (another stored
 * snapshot of the room, `baseReference`), or null when a delta would not save at least a fifth, or
 * when decoding it would not reproduce `text` exactly.
 * @param {string} text @param {string} reference @param {string} baseText @param {string} baseReference
 * @returns {string | null}
 */
export function encodeReportDelta(text, reference, baseText, baseReference) {
  let value, base;
  try {
    value = JSON.parse(text);
    base = JSON.parse(baseText);
  } catch {
    return null;
  }
  if (!plain(value) || !plain(base)) return null;
  const node = encodeNode(value, base, 0, text);
  const body = JSON.stringify({ [REPORT_DELTA_KEY]: { v: 1, reference, base: baseReference, bytes: new TextEncoder().encode(text).length, node } });
  // Worth storing only when it saves at least a fifth of the snapshot.
  if (body.length * 5 > text.length * 4) return null;
  // Stored only if it decodes to exactly the same text.
  if (JSON.stringify(decodeNode(node, base)) !== text) return null;
  return body;
}

/** @param {string} body @returns {{ reference: string; base: string; bytes: number; node: unknown } | null} */
export function reportDeltaMarker(body) {
  if (!body.startsWith(`{"${REPORT_DELTA_KEY}":`)) return null;
  const marker = JSON.parse(body)[REPORT_DELTA_KEY];
  if (!marker || marker.v !== 1 || typeof marker.reference !== "string" || typeof marker.base !== "string" || !Array.isArray(marker.node))
    throw Error("An archived session report is damaged. Keep the original recovery export; the campaign was not changed.");
  return marker;
}

/** The snapshot text a delta marker stands for, from its base snapshot text (not yet verified). */
export function decodeReportDelta(/** @type {{ node: unknown }} */ marker, /** @type {string} */ baseText) {
  return JSON.stringify(decodeNode(marker.node, JSON.parse(baseText)));
}
