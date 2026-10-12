type Operation = "poll" | "full-read";
type Phase = "access" | "hydrate" | "projection" | "encounter";
/** Request-local wall timings, with no campaign IDs, credentials, URLs or payloads. */
export function syncTimer(operation: Operation) {
  const phases: { phase: Phase; durationMs: number }[] = [], start = performance.now();
  const enabled = !!(globalThis as typeof globalThis & { __env__?: { ASSETS?: unknown } }).__env__?.ASSETS;
  const sample = enabled && crypto.getRandomValues(new Uint32Array(1))[0]! < 42949673;
  return {
    async measure<T>(phase: Phase, work: () => Promise<T>): Promise<T> {
      const at = performance.now();
      try { return await work(); }
      finally { phases.push({ phase, durationMs: Math.round((performance.now() - at) * 100) / 100 }); }
    },
    finish(outcome: "unchanged" | "full" | "failed") {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      if (enabled && (sample || durationMs >= 250 || outcome === "failed"))
        console.info(JSON.stringify({ kind: "lootsplit.sync-timing", operation, outcome, durationMs, phases }));
    },
  };
}
