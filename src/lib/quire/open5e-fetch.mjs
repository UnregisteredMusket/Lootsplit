// Reliable, cached Open5e reads shared by the Catalog reference search (server functions) and the
// encounter creature index (Worker, and the browser for device encounters).
//
// Why: api.open5e.com sometimes takes longer than a single 12-second attempt (Android 1.15.0
// showed the raw "The operation was aborted due to timeout"). Each read here:
// - answers from a cache keyed by the exact Open5e URL: an in-memory copy in this isolate or
//   browser tab, and the Cloudflare Cache API where it works (custom domains; it does nothing on
//   workers.dev). Copies are fresh for a day and kept as a fallback for a week;
// - when a copy is stale, serves it at once and refreshes it after the response if the caller
//   can defer work, otherwise tries Open5e first and falls back to the stale copy;
// - collapses identical reads already in flight;
// - retries once after a timeout, a network error, a 5xx or a short 429, inside one overall budget;
// - fails with a short, friendly message instead of a raw AbortError.
// Requests carry only the public Open5e URL: no cookies, campaign or account data.

export const OPEN5E_FRESH_MS = 24 * 60 * 60 * 1000;
export const OPEN5E_STALE_MS = 7 * 24 * 60 * 60 * 1000;
export const OPEN5E_BUDGET_MS = 25000;
export const OPEN5E_ATTEMPT_MS = 12000;
const RETRY_DELAY_MS = 750;
const MAX_RETRY_AFTER_MS = 3000;
const MEMORY_ENTRIES = 120;
const MEMORY_ENTRY_BYTES = 512 * 1024;
const FETCHED_AT = "X-Lootsplit-Fetched-At";

export const OPEN5E_MESSAGES = {
  timeout: "Open5e is taking too long to respond. Please try again in a moment.",
  busy: "Open5e is busy. Please try again shortly.",
  unavailable: "Open5e is unavailable. Try again later.",
  network: "Could not reach Open5e. Check your connection and try again.",
  invalid: "Open5e returned an unexpected response. Try again later.",
};

/** @typedef {keyof typeof OPEN5E_MESSAGES} Open5eReason */
export class Open5eError extends Error {
  /** @param {Open5eReason} reason */
  constructor(reason) {
    super(OPEN5E_MESSAGES[reason]);
    this.name = "Open5eError";
    this.reason = reason;
    this.status = reason === "busy" ? 429 : 503;
  }
}

/**
 * The friendly message for any failure from an Open5e read, including raw fetch errors
 * ("The operation was aborted due to timeout", "Failed to fetch") from older code paths.
 * Messages that are not Open5e transport failures (permissions, validation) pass through.
 * @param {unknown} error
 * @returns {string}
 */
export function open5eErrorMessage(error) {
  if (error instanceof Open5eError) return error.message;
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError" || /aborted|timed? ?out/i.test(raw))
    return OPEN5E_MESSAGES.timeout;
  if (/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(raw))
    return OPEN5E_MESSAGES.network;
  return raw || OPEN5E_MESSAGES.unavailable;
}

/** @typedef {{ at: number, text: string }} Entry */
/** @type {Map<string, Entry>} */
const memory = new Map();
/** @type {Map<string, Promise<unknown>>} */
const inFlight = new Map();

/** Clears the in-memory copies (tests). */
export function clearOpen5eMemory() {
  memory.clear();
  inFlight.clear();
}

/** @param {string} key @param {Entry} entry */
function remember(key, entry) {
  if (entry.text.length > MEMORY_ENTRY_BYTES) return;
  memory.delete(key);
  memory.set(key, entry);
  while (memory.size > MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

/**
 * The Workers cache, when this runtime has one (`caches.default` exists only in Workers).
 * @param {unknown} storage
 * @returns {{ match(key: Request): Promise<Response | undefined>, put(key: Request, value: Response): Promise<void> } | null}
 */
function edgeCache(storage) {
  const cache = /** @type {{ default?: unknown } | undefined} */ (storage)?.default;
  return cache &&
    typeof (/** @type {{ match?: unknown }} */ (cache).match) === "function" &&
    typeof (/** @type {{ put?: unknown }} */ (cache).put) === "function"
    ? /** @type {any} */ (cache)
    : null;
}

/**
 * @typedef {{
 *   fetch?: typeof fetch,
 *   caches?: unknown,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   defer?: (task: () => Promise<unknown>) => unknown,
 *   budgetMs?: number,
 *   attemptMs?: number,
 *   memory?: boolean,
 *   accept?: (payload: unknown) => boolean,
 * }} Open5eReadOptions
 */

/** @param {unknown} payload */
const defaultAccept = (payload) =>
  !!payload &&
  typeof payload === "object" &&
  Array.isArray(/** @type {{ results?: unknown }} */ (payload).results);

/**
 * @param {string} key
 * @param {Open5eReadOptions} options
 * @returns {Promise<Entry | null>}
 */
async function cached(key, options) {
  const local = options.memory === false ? undefined : memory.get(key);
  if (local) return local;
  const edge = edgeCache(options.caches === undefined ? globalThis.caches : options.caches);
  if (!edge) return null;
  try {
    const hit = await edge.match(new Request(key));
    if (!hit) return null;
    const at = Number(hit.headers.get(FETCHED_AT));
    if (!Number.isFinite(at)) return null;
    const entry = { at, text: await hit.text() };
    if (options.memory !== false) remember(key, entry);
    return entry;
  } catch {
    return null;
  }
}

/** @param {string} key @param {Entry} entry @param {Open5eReadOptions} options */
async function store(key, entry, options) {
  if (options.memory !== false) remember(key, entry);
  const edge = edgeCache(options.caches === undefined ? globalThis.caches : options.caches);
  if (!edge) return;
  try {
    await edge.put(
      new Request(key),
      new Response(entry.text, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${Math.floor(OPEN5E_STALE_MS / 1000)}`,
          [FETCHED_AT]: String(entry.at),
        },
      }),
    );
  } catch {
    // A cache that cannot store (quota, preview) must not fail a search that succeeded.
  }
}

/**
 * One Open5e read with a timeout per attempt, one retry and an overall budget.
 * @param {string} url
 * @param {Open5eReadOptions} options
 * @returns {Promise<Entry>}
 */
async function download(url, options) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const accept = options.accept ?? defaultAccept;
  const deadline = now() + (options.budgetMs ?? OPEN5E_BUDGET_MS);
  /** @type {Open5eReason} */
  let failure = "unavailable";
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - now();
    if (remaining < 1000) break;
    let retry = false;
    let delay = RETRY_DELAY_MS;
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(Math.min(options.attemptMs ?? OPEN5E_ATTEMPT_MS, remaining)),
        // No credentials option: Workers reject it, and browsers send no cookies cross-origin.
        headers: { Accept: "application/json" },
      });
      if (response.ok) {
        const text = await response.text();
        /** @type {unknown} */
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          payload = undefined;
        }
        if (accept(payload)) return { at: now(), text };
        failure = "invalid";
        retry = true;
      } else if (response.status === 429) {
        failure = "busy";
        const seconds = Number(response.headers.get("Retry-After"));
        const wait = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : RETRY_DELAY_MS;
        retry = wait <= MAX_RETRY_AFTER_MS;
        delay = Math.max(wait, RETRY_DELAY_MS);
      } else {
        failure = "unavailable";
        retry = response.status >= 500;
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      failure = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
      retry = true;
    }
    if (!retry || attempt === 1) break;
    const left = deadline - now();
    if (left < delay + 1000) break;
    await sleep(delay);
  }
  throw new Open5eError(failure);
}

/**
 * Read an Open5e JSON page (see the file comment for caching, retries and errors).
 * @param {string} url an https://api.open5e.com/ URL; it is also the cache key.
 * @param {Open5eReadOptions} [options]
 * @returns {Promise<unknown>}
 */
export async function readOpen5e(url, options = {}) {
  const key = new URL(url);
  if (key.protocol !== "https:" || key.hostname !== "api.open5e.com")
    throw new Error("Only Open5e reference URLs can be read.");
  const now = options.now ?? Date.now;
  const prior = await cached(key.href, options);
  const age = prior ? now() - prior.at : Infinity;
  if (prior && age < OPEN5E_FRESH_MS) return JSON.parse(prior.text);
  const refresh = () => {
    const running = inFlight.get(key.href);
    if (running) return /** @type {Promise<Entry>} */ (running);
    const next = download(key.href, options)
      .then(async (entry) => {
        await store(key.href, entry, options);
        return entry;
      })
      .finally(() => inFlight.delete(key.href));
    inFlight.set(key.href, next);
    return next;
  };
  if (prior && age < OPEN5E_STALE_MS && options.defer) {
    // Stale-while-revalidate: answer now, refresh after the response.
    options.defer(() => refresh().catch(() => undefined));
    return JSON.parse(prior.text);
  }
  try {
    return JSON.parse((await refresh()).text);
  } catch (error) {
    // Stale-if-error: a slow or failing Open5e must not break a search that worked before.
    if (prior && age < OPEN5E_STALE_MS) return JSON.parse(prior.text);
    throw error;
  }
}
