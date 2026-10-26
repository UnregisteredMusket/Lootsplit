// Fine-grained journal changes for DM "patch" commands.
//
// A patch used to carry the whole journal twice (before and after). With map artwork stored
// inline, one edit could exceed the 2 MB batch limit and the browser's storage quota for pending
// actions. A change now names the part of the journal it touches:
//   store "journal", id "journal:" + JSON path, before/after = that part only.
// The legacy whole-journal change (id "journal") stays valid for older clients and drafts.
//
// Paths are arrays of segments: an object key (string) or { id } for an item of an array whose
// items all have unique string ids. Arrays whose item order changes are replaced whole.
export type JournalPathSegment = string | { id: string };
export type JournalPath = JournalPathSegment[];
export type JournalPathChange = { path: JournalPath; before: unknown; after: unknown };

export const LEGACY_JOURNAL_CHANGE_ID = "journal";
const PREFIX = "journal:";
/** Parts smaller than this are sent whole rather than split further. */
const SPLIT_ABOVE = 4096;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, value) =>
    isObject(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, value[k]]),
        )
      : value,
  ) ?? "undefined";
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const size = (v: unknown) => (v === undefined ? 0 : canonical(v).length);

function idList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (!isObject(item) || typeof item.id !== "string" || !item.id) return null;
    ids.push(item.id);
  }
  return new Set(ids).size === ids.length ? ids : null;
}

/** Items may change or disappear and new ones may be appended; anything else is a reorder. */
function orderPreserved(before: string[], after: string[]) {
  const kept = new Set(after);
  const survivors = before.filter((id) => kept.has(id));
  const known = new Set(before);
  const firstNew = after.findIndex((id) => !known.has(id));
  const head = firstNew === -1 ? after : after.slice(0, firstNew);
  if (firstNew !== -1 && after.slice(firstNew).some((id) => known.has(id))) return false;
  return same(head, survivors);
}

function diff(path: JournalPath, before: unknown, after: unknown, out: JournalPathChange[]) {
  if (same(before, after)) return;
  const large = Math.max(size(before), size(after)) > SPLIT_ABOVE;
  if (large && isObject(before) && isObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
      diff([...path, key], before[key], after[key], out);
    return;
  }
  const a = idList(before),
    b = idList(after);
  if (large && a && b && orderPreserved(a, b)) {
    const beforeItems = new Map((before as { id: string }[]).map((x) => [x.id, x]));
    const afterItems = new Map((after as { id: string }[]).map((x) => [x.id, x]));
    for (const id of a)
      if (!afterItems.has(id))
        out.push({ path: [...path, { id }], before: beforeItems.get(id), after: null });
    for (const id of b) {
      const x = beforeItems.get(id),
        y = afterItems.get(id);
      if (x === undefined) out.push({ path: [...path, { id }], before: null, after: y });
      else if (!same(x, y)) {
        // A changed item is split further only when both sides are objects.
        if (size(x) > SPLIT_ABOVE && isObject(x) && isObject(y)) diff([...path, { id }], x, y, out);
        else out.push({ path: [...path, { id }], before: x, after: y });
      }
    }
    return;
  }
  out.push({
    path,
    before: before === undefined ? null : before,
    after: after === undefined ? null : after,
  });
}

/** The smallest set of journal parts that turns `before` into `after`. */
export function diffJournal(before: unknown, after: unknown): JournalPathChange[] {
  const out: JournalPathChange[] = [];
  // The top level is always split by key so unrelated journal areas never travel together.
  if (isObject(before) && isObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
      diff([key], before[key], after[key], out);
  } else diff([], before, after, out);
  return out;
}

export const journalChangeId = (path: JournalPath) => PREFIX + JSON.stringify(path);

export function journalChangePath(id: string): JournalPath | null {
  if (!id.startsWith(PREFIX)) return null;
  let path: unknown;
  try {
    path = JSON.parse(id.slice(PREFIX.length));
  } catch {
    return null;
  }
  if (
    !Array.isArray(path) ||
    path.length < 1 ||
    path.length > 12 ||
    !path.every(
      (s) =>
        (typeof s === "string" &&
          s.length > 0 &&
          s.length <= 200 &&
          s !== "__proto__" &&
          s !== "constructor" &&
          s !== "prototype") ||
        (isObject(s) &&
          Object.keys(s).length === 1 &&
          typeof s.id === "string" &&
          s.id.length > 0 &&
          s.id.length <= 200),
    )
  )
    return null;
  return path as JournalPath;
}

const MISSING = Symbol("missing");
/** The value at a path, or MISSING when a parent or item is absent. */
function read(root: unknown, path: JournalPath): unknown {
  let node: unknown = root;
  for (const segment of path) {
    if (typeof segment === "string") {
      if (!isObject(node) || !Object.prototype.hasOwnProperty.call(node, segment)) return MISSING;
      node = node[segment];
    } else {
      if (!Array.isArray(node)) return MISSING;
      const item = node.find((x) => isObject(x) && x.id === segment.id);
      if (item === undefined) return MISSING;
      node = item;
    }
  }
  return node;
}

/**
 * A copy of `root` with `value` at `path` (null at an item path removes the item; an absent item
 * is appended). Throws when a parent is missing, so a stale change becomes a conflict.
 */
export function writeJournalPath<T>(root: T, path: JournalPath, value: unknown): T {
  const copy = structuredClone(root) as unknown;
  if (!path.length) return value as T;
  let node: unknown = copy;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    const next =
      typeof segment === "string"
        ? isObject(node)
          ? node[segment]
          : undefined
        : Array.isArray(node)
          ? node.find((x) => isObject(x) && x.id === segment.id)
          : undefined;
    if (next === undefined || next === null || typeof next !== "object")
      throw Error("Activity changed elsewhere. Refresh and retry.");
    node = next;
  }
  const last = path[path.length - 1];
  if (typeof last === "string") {
    if (!isObject(node)) throw Error("Activity changed elsewhere. Refresh and retry.");
    if (value === null || value === undefined) delete node[last];
    else node[last] = value;
  } else {
    if (!Array.isArray(node)) throw Error("Activity changed elsewhere. Refresh and retry.");
    const index = node.findIndex((x) => isObject(x) && x.id === last.id);
    if (value === null || value === undefined) {
      if (index !== -1) node.splice(index, 1);
    } else if (index === -1) node.push(value);
    else node[index] = value;
  }
  return copy as T;
}

/** The value a change's `before` refers to in the current journal (null when absent). */
export function readJournalPath(root: unknown, path: JournalPath): unknown {
  const value = read(root, path);
  return value === MISSING ? null : value;
}
