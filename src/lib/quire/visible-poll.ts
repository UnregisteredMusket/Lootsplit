/**
 * Visibility-gated polling (audit 2026-10-28 F4, F8). Like the room and map-ping pollers, these
 * loops make no requests while the tab is hidden and catch up as soon as it is visible again.
 * The environment is injectable so the timing rules are unit-tested without a browser.
 */
export type PollEnvironment = {
  hidden: () => boolean;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
  /** Calls `run` whenever the page becomes visible; returns the unsubscribe function. */
  onVisible: (run: () => void) => () => void;
};

export const browserPollEnvironment = (): PollEnvironment => ({
  hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
  onVisible: (run) => {
    if (typeof document === "undefined") return () => undefined;
    const listener = () => {
      if (document.visibilityState !== "hidden") run();
    };
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
});

/**
 * Runs `load` now and then every `intervalMs` after the previous load finished, never two at
 * once, and not while the tab is hidden. Returns `stop`.
 */
export function startVisiblePoll(
  load: () => Promise<void>,
  intervalMs: number,
  env: PollEnvironment = browserPollEnvironment(),
): () => void {
  let stopped = false,
    running = false,
    timer: unknown;
  const tick = async () => {
    env.clearTimeout(timer);
    if (stopped || running) return;
    if (!env.hidden()) {
      running = true;
      try {
        await load();
      } catch {
        /* `load` reports its own errors; the loop continues. */
      } finally {
        running = false;
      }
    }
    if (!stopped) timer = env.setTimeout(() => void tick(), intervalMs);
  };
  const unsubscribe = env.onVisible(() => void tick());
  void tick();
  return () => {
    stopped = true;
    env.clearTimeout(timer);
    unsubscribe();
  };
}

export type SharedPollSubscriber<T> = {
  intervalMs: number;
  /** Whether this subscriber needs a request now. Default: only while the tab is visible. */
  wanted?: () => boolean;
  onResult: (value: T) => void;
  onError: (error: unknown) => void;
};

/**
 * One poll per key shared by every subscriber on the page (for example the DM's TV display
 * controller and the map Initiative panel reading the same encounter). The key is polled at the
 * shortest subscribed interval, only while some subscriber wants it, and every result goes to all
 * subscribers. `refresh` polls now (after an in-flight request, if any).
 */
export function createSharedPoller<T>(
  request: (key: string) => Promise<T>,
  env: PollEnvironment = browserPollEnvironment(),
) {
  type Entry = {
    subscribers: Set<SharedPollSubscriber<T>>;
    timer: unknown;
    running: boolean;
    again: boolean;
    last?: { value: T } | { error: unknown };
    stopVisible: () => void;
  };
  const entries = new Map<string, Entry>();
  const wants = (entry: Entry) =>
    [...entry.subscribers].some((s) => (s.wanted ? s.wanted() : !env.hidden()));
  const interval = (entry: Entry) => Math.min(...[...entry.subscribers].map((s) => s.intervalMs));
  async function tick(key: string, force = false) {
    const entry = entries.get(key);
    if (!entry) return;
    if (entry.running) {
      if (force) entry.again = true;
      return;
    }
    env.clearTimeout(entry.timer);
    if (force || wants(entry)) {
      entry.running = true;
      let outcome: { value: T } | { error: unknown };
      try {
        outcome = { value: await request(key) };
      } catch (error) {
        outcome = { error };
      }
      entry.running = false;
      if (entries.get(key) !== entry) return;
      entry.last = outcome;
      for (const subscriber of [...entry.subscribers])
        if ("value" in outcome) subscriber.onResult(outcome.value);
        else subscriber.onError(outcome.error);
      if (entry.again) {
        entry.again = false;
        return tick(key, true);
      }
    }
    if (entries.get(key) === entry && entry.subscribers.size)
      entry.timer = env.setTimeout(() => void tick(key), interval(entry));
  }
  return {
    subscribe(key: string, subscriber: SharedPollSubscriber<T>): () => void {
      let entry = entries.get(key);
      if (!entry) {
        const created: Entry = {
          subscribers: new Set(),
          timer: undefined,
          running: false,
          again: false,
          stopVisible: () => undefined,
        };
        created.stopVisible = env.onVisible(() => void tick(key));
        entries.set(key, created);
        entry = created;
      }
      entry.subscribers.add(subscriber);
      if (entry.last) {
        // Joining a running poll: show its latest result now instead of requesting again.
        const last = entry.last;
        if ("value" in last) subscriber.onResult(last.value);
        else subscriber.onError(last.error);
        if (!entry.running) {
          env.clearTimeout(entry.timer);
          entry.timer = env.setTimeout(() => void tick(key), interval(entry));
        }
      } else if (!entry.running) void tick(key);
      const current = entry;
      return () => {
        current.subscribers.delete(subscriber);
        if (current.subscribers.size || entries.get(key) !== current) return;
        env.clearTimeout(current.timer);
        current.stopVisible();
        entries.delete(key);
      };
    },
    refresh(key: string) {
      void tick(key, true);
    },
    /** Test and diagnostics only: keys currently polled. */
    keys: () => [...entries.keys()],
  };
}
