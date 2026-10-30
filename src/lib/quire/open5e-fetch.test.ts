import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOpenPage,
  OPEN5E_FIELDS,
  OPEN5E_KINDS,
  openUrl,
  type OpenQuery,
} from "./open5e.ts";
import {
  clearOpen5eMemory,
  OPEN5E_FRESH_MS,
  OPEN5E_MESSAGES,
  OPEN5E_STALE_MS,
  open5eErrorMessage,
  readOpen5e,
} from "./open5e-fetch.mjs";
import { CREATURE_INDEX_FIELDS, creatureIndex, creatureIndexUrl } from "../encounters/index.mjs";

beforeEach(() => clearOpen5eMemory());

const page = (name = "Fire Bolt") => ({
  count: 1,
  next: null,
  results: [{ key: "srd_fire-bolt", name, document: { key: "srd-2014", name: "SRD 5.1" } }],
});
const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const timeoutError = () =>
  Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
type Call = { url: string; init?: RequestInit };
function mockFetch(responses: Array<Response | Error | (() => Response | Error)>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    const value = typeof next === "function" ? next() : next;
    if (!value) throw new Error("unexpected extra fetch");
    if (value instanceof Error) throw value;
    return value;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const noEdge = { caches: null, sleep: async () => {} };
const spells: OpenQuery = { kind: "spells", edition: "srd-2014", query: "Fire", page: 1 };

test("each section requests only the fields the normalizer reads, with exact filters", () => {
  for (const { value: kind } of OPEN5E_KINDS)
    for (const edition of ["srd-2014", "srd-2024"] as const) {
      const url = new URL(openUrl({ kind, edition, query: " Fire ", page: 2 }));
      assert.equal(url.origin + url.pathname, `https://api.open5e.com/v2/${kind}/`);
      assert.equal(
        url.searchParams.get("document__key__in"),
        kind === "conditions" ? "core" : edition,
      );
      assert.equal(url.searchParams.get("name__icontains"), "Fire");
      assert.equal(url.searchParams.get("page"), "2");
      assert.equal(url.searchParams.get("ordering"), "name");
      const fields = url.searchParams.get("fields")!.split(",");
      for (const required of ["key", "name", "document"])
        assert.ok(fields.includes(required), `${kind} ${required}`);
      assert.equal(url.searchParams.get("document__fields"), "key,name");
      assert.ok(!fields.includes("crossreferences"));
      // Same query, same URL: the URL is the cache key.
      assert.equal(openUrl({ kind, edition, query: "Fire", page: 2 }), url.toString());
    }
  assert.ok(OPEN5E_FIELDS.spells.fields!.split(",").includes("higher_level"));
  assert.ok(OPEN5E_FIELDS.magicitems.fields!.split(",").includes("rarity"));
});

// Emulates Open5e's `fields` / `<child>__fields` pruning on a full record.
function prune(record: Record<string, unknown>, params: Record<string, string>) {
  const keep = new Set(params.fields!.split(","));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (!keep.has(k)) continue;
    const child = params[`${k}__fields`];
    if (!child) out[k] = v;
    else {
      const sub = new Set(child.split(","));
      const pick = (o: unknown) =>
        Object.fromEntries(
          Object.entries(o as Record<string, unknown>).filter(([key]) => sub.has(key)),
        );
      out[k] = Array.isArray(v) ? v.map(pick) : v && typeof v === "object" ? pick(v) : v;
    }
  }
  return out;
}
const doc = {
  key: "srd-2014",
  name: "System Reference Document 5.1",
  publisher: { name: "WotC" },
  gamesystem: { key: "5e-2014" },
};
const full: Record<string, Record<string, unknown>> = {
  items: {
    key: "srd_longsword",
    name: "Longsword",
    desc: "A sword.",
    cost: "15.00",
    weight: "3.000",
    weight_unit: "lb",
    category: { name: "Weapon", key: "weapon", url: "x" },
    size: { name: "Tiny" },
    crossreferences: { to: [] },
    weapon: {
      damage_dice: "1d8",
      damage_type: { name: "Slashing" },
      properties: [{ property: { name: "Versatile", desc: "Two hands." }, detail: "1d10" }],
    },
    armor: null,
    document: doc,
  },
  magicitems: {
    key: "srd_ring-of-warmth",
    name: "Ring of Warmth",
    desc: "Warm.",
    cost: "0.00",
    weight: "0.000",
    weight_unit: "lb",
    category: { name: "Ring", key: "ring" },
    rarity: { name: "Uncommon", rank: 2 },
    requires_attunement: true,
    attunement_detail: "by a wizard",
    weapon: null,
    armor: { ac_display: "12" },
    document: doc,
    crossreferences: { to: [] },
  },
  spells: {
    key: "srd_fireball",
    name: "Fireball",
    desc: "Boom.",
    higher_level: "More boom.",
    level: 3,
    school: { name: "Evocation", key: "evocation" },
    casting_time: "action",
    range_text: "150 feet",
    range: 150,
    duration: "instantaneous",
    verbal: true,
    somatic: true,
    material: true,
    material_specified: "Bat guano",
    concentration: false,
    ritual: false,
    reaction_condition: "",
    classes: [{ name: "Wizard", key: "wizard" }],
    casting_options: [{ type: "slot_level_4" }],
    crossreferences: { to: [] },
    document: doc,
  },
  creatures: {
    key: "srd_goblin",
    name: "Goblin",
    type: { name: "Humanoid", key: "humanoid" },
    size: { name: "Small", key: "small" },
    armor_class: 15,
    hit_points: 7,
    challenge_rating: 0.25,
    experience_points: 50,
    ability_scores: { strength: 8 },
    traits: [{ name: "Nimble Escape", desc: "Disengage." }],
    actions: [
      {
        name: "Scimitar",
        desc: "Melee.",
        attacks: [{ to_hit_mod: 4 }],
        crossreferences: null,
        action_type: "ACTION",
      },
    ],
    resistances_and_immunities: {},
    document: doc,
  },
  conditions: {
    key: "blinded",
    name: "Blinded",
    document: { key: "core", name: "Core" },
    icon: { name: "eye" },
    descriptions: [
      { document: "srd-2014", desc: "Can't see." },
      { document: "srd-2024", desc: "Can't see (2024)." },
    ],
  },
};
test("the reduced field set normalizes exactly like the full Open5e record", () => {
  for (const { value: kind } of OPEN5E_KINDS) {
    const q: OpenQuery = { kind, edition: "srd-2014", query: "", page: 1 };
    const expected = normalizeOpenPage({ count: 1, next: null, results: [full[kind]] }, q);
    const reduced = normalizeOpenPage(
      { count: 1, next: null, results: [prune(full[kind]!, OPEN5E_FIELDS[kind])] },
      q,
    );
    assert.equal(expected.entries.length, 1, kind);
    assert.deepEqual(reduced, expected, kind);
  }
});

test("a timeout is retried once and then fails with a friendly message", async () => {
  const { fn, calls } = mockFetch([timeoutError(), timeoutError()]);
  await assert.rejects(readOpen5e(openUrl(spells), { ...noEdge, fetch: fn }), (e: Error) => {
    assert.equal(e.message, OPEN5E_MESSAGES.timeout);
    assert.doesNotMatch(e.message, /aborted/);
    return true;
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[0]!.init?.signal instanceof AbortSignal);
  assert.equal(calls[0]!.init?.credentials, undefined);
  assert.equal(new Headers(calls[0]!.init?.headers).get("cookie"), null);
});

test("a timeout or 5xx followed by success returns the data", async () => {
  for (const first of [
    timeoutError(),
    new Response("bad gateway", { status: 502 }),
    new Response("<html>", { status: 200 }),
  ]) {
    clearOpen5eMemory();
    const { fn, calls } = mockFetch([first, ok(page())]);
    const data = (await readOpen5e(openUrl(spells), { ...noEdge, fetch: fn })) as {
      results: unknown[];
    };
    assert.equal(data.results.length, 1);
    assert.equal(calls.length, 2);
  }
});

test("429 waits for a short Retry-After, and a long one fails as busy without hammering", async () => {
  const waits: number[] = [];
  const short = mockFetch([
    new Response("", { status: 429, headers: { "Retry-After": "2" } }),
    ok(page()),
  ]);
  await readOpen5e(openUrl(spells), {
    caches: null,
    fetch: short.fn,
    sleep: async (ms) => void waits.push(ms),
  });
  assert.deepEqual(waits, [2000]);
  clearOpen5eMemory();
  const long = mockFetch([new Response("", { status: 429, headers: { "Retry-After": "120" } })]);
  await assert.rejects(readOpen5e(openUrl(spells), { ...noEdge, fetch: long.fn }), {
    message: OPEN5E_MESSAGES.busy,
  });
  assert.equal(long.calls.length, 1);
  clearOpen5eMemory();
  const missing = mockFetch([new Response("", { status: 404 })]);
  await assert.rejects(readOpen5e(openUrl(spells), { ...noEdge, fetch: missing.fn }), {
    message: OPEN5E_MESSAGES.unavailable,
  });
  assert.equal(missing.calls.length, 1);
});

test("the overall budget stops a retry that cannot finish", async () => {
  let clock = 0;
  const { fn, calls } = mockFetch([() => ((clock += 24500), timeoutError())]);
  await assert.rejects(readOpen5e(openUrl(spells), { ...noEdge, fetch: fn, now: () => clock }), {
    message: OPEN5E_MESSAGES.timeout,
  });
  assert.equal(calls.length, 1);
});

test("repeat searches are answered from the cache without calling Open5e", async () => {
  let clock = 1_000_000;
  const { fn, calls } = mockFetch([ok(page())]);
  const options = { ...noEdge, fetch: fn, now: () => clock };
  await readOpen5e(openUrl(spells), options);
  clock += OPEN5E_FRESH_MS - 1;
  const again = (await readOpen5e(openUrl(spells), options)) as {
    results: Array<{ name: string }>;
  };
  assert.equal(again.results[0]!.name, "Fire Bolt");
  assert.equal(calls.length, 1);
});

test("identical searches in flight share one Open5e request", async () => {
  let release!: (r: Response) => void;
  const pending = new Promise<Response>((resolve) => (release = resolve));
  let count = 0;
  const fn = (async () => (count++, pending)) as unknown as typeof fetch;
  const a = readOpen5e(openUrl(spells), { ...noEdge, fetch: fn });
  const b = readOpen5e(openUrl(spells), { ...noEdge, fetch: fn });
  await new Promise((r) => setTimeout(r, 0));
  release(ok(page()));
  await Promise.all([a, b]);
  assert.equal(count, 1);
});

test("a stale copy answers when Open5e fails, and is refreshed in the background when possible", async () => {
  let clock = 0;
  const first = mockFetch([ok(page("Old"))]);
  await readOpen5e(openUrl(spells), { ...noEdge, fetch: first.fn, now: () => clock });
  clock = OPEN5E_FRESH_MS + 1;
  const failing = mockFetch([timeoutError(), timeoutError()]);
  const stale = (await readOpen5e(openUrl(spells), {
    ...noEdge,
    fetch: failing.fn,
    now: () => clock,
  })) as {
    results: Array<{ name: string }>;
  };
  assert.equal(stale.results[0]!.name, "Old");
  const tasks: Array<() => Promise<unknown>> = [];
  const refreshing = mockFetch([ok(page("New"))]);
  const quick = (await readOpen5e(openUrl(spells), {
    ...noEdge,
    fetch: refreshing.fn,
    now: () => clock,
    defer: (task) => void tasks.push(task),
  })) as { results: Array<{ name: string }> };
  assert.equal(quick.results[0]!.name, "Old");
  assert.equal(refreshing.calls.length, 0);
  await tasks[0]!();
  const fresh = (await readOpen5e(openUrl(spells), {
    ...noEdge,
    fetch: mockFetch([]).fn,
    now: () => clock,
  })) as {
    results: Array<{ name: string }>;
  };
  assert.equal(fresh.results[0]!.name, "New");
  clock += OPEN5E_STALE_MS;
  await assert.rejects(
    readOpen5e(openUrl(spells), {
      ...noEdge,
      fetch: mockFetch([timeoutError(), timeoutError()]).fn,
      now: () => clock,
    }),
  );
});

test("the Worker cache is keyed by the Open5e URL and survives a new isolate", async () => {
  const store = new Map<string, Response>();
  const edge = {
    default: {
      match: async (key: Request) => store.get(key.url)?.clone(),
      put: async (key: Request, value: Response) => void store.set(key.url, value),
    },
  };
  const url = openUrl(spells);
  await readOpen5e(url, { caches: edge, fetch: mockFetch([ok(page())]).fn, sleep: async () => {} });
  assert.deepEqual([...store.keys()], [url]);
  assert.match(store.get(url)!.headers.get("Cache-Control")!, /max-age=604800/);
  clearOpen5eMemory();
  const data = (await readOpen5e(url, { caches: edge, fetch: mockFetch([]).fn })) as {
    results: unknown[];
  };
  assert.equal(data.results.length, 1);
});

test("only Open5e URLs can be read", async () => {
  await assert.rejects(readOpen5e("https://example.com/v2/spells/", noEdge), /Only Open5e/);
  await assert.rejects(readOpen5e("http://api.open5e.com/v2/spells/", noEdge), /Only Open5e/);
});

test("raw fetch failures become friendly messages; other messages pass through", () => {
  assert.equal(
    open5eErrorMessage(new Error("The operation was aborted due to timeout")),
    OPEN5E_MESSAGES.timeout,
  );
  assert.equal(
    open5eErrorMessage(Object.assign(new Error("x"), { name: "AbortError" })),
    OPEN5E_MESSAGES.timeout,
  );
  assert.equal(open5eErrorMessage(new TypeError("Failed to fetch")), OPEN5E_MESSAGES.network);
  assert.equal(
    open5eErrorMessage(new Error("Reference lookups are disabled by your DM.")),
    "Reference lookups are disabled by your DM.",
  );
});

test("encounter creature index asks only for the fields it converts", () => {
  const url = new URL(creatureIndexUrl(3));
  assert.equal(url.searchParams.get("document__key__in"), "srd-2014");
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.get("limit"), "500");
  const fields = url.searchParams.get("fields")!.split(",");
  for (const f of [
    "key",
    "name",
    "document",
    "hit_points",
    "armor_class",
    "challenge_rating",
    "experience_points",
    "initiative_bonus",
    "size",
    "type",
    "traits",
    "actions",
    "environments",
  ])
    assert.ok(fields.includes(f), f);
  assert.equal(CREATURE_INDEX_FIELDS.actions__fields, "name,desc");
});

test("encounter creature search fails clearly, then imports SRD creatures with attribution", async () => {
  await assert.rejects(
    creatureIndex({ ...noEdge, fetch: mockFetch([timeoutError(), timeoutError()]).fn }),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 503);
      assert.match(
        e.message,
        /taking too long.*Saved encounters and custom enemies remain available/,
      );
      return true;
    },
  );
  const goblin = prune(full.creatures!, CREATURE_INDEX_FIELDS);
  const { fn, calls } = mockFetch([
    ok({
      count: 1,
      next: null,
      results: [{ ...goblin, initiative_bonus: 2, environments: [{ name: "Forest" }] }],
    }),
  ]);
  const rows = await creatureIndex({ ...noEdge, fetch: fn });
  assert.equal(calls[0]!.url, creatureIndexUrl(1));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.name, "Goblin");
  assert.equal(rows[0]!.hp, 7);
  assert.equal(rows[0]!.ac, 15);
  assert.equal(rows[0]!.size, "small");
  assert.equal(rows[0]!.type, "Humanoid");
  assert.match(rows[0]!.notes, /Nimble Escape: Disengage[\s\S]*Scimitar: Melee/);
  assert.match(rows[0]!.source, /CC BY 4.0/);
});
