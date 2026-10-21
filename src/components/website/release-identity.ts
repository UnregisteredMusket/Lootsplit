import { useEffect, useState } from "react";
import { API_ORIGIN } from "@/lib/mobile/origin";
import { parseReleaseIdentity, type ReleaseIdentity } from "@/lib/website/client-presentation";

// One request per document: the footer and the release details share it.
// A failed request is forgotten so Retry (or the next page) asks again.
let pending: Promise<ReleaseIdentity> | null = null;

function loadReleaseIdentity(retry: boolean) {
  if (!pending || retry) {
    const origin = import.meta.env.VITE_MOBILE === "true" ? API_ORIGIN : "";
    // This asset is produced by the immutable release packager, not the dev server.
    const request = fetch(`${origin}/assets/release-identity.json`, {
      cache: "no-store",
      credentials: "omit",
    }).then(async (response) => {
      if (!response.ok) throw Error("Release information unavailable");
      const next = parseReleaseIdentity(await response.json());
      if (!next) throw Error("Release information unavailable");
      return next;
    });
    request.catch(() => {
      if (pending === request) pending = null;
    });
    pending = request;
  }
  return pending;
}

export type ReleaseIdentityState =
  | { status: "development" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; identity: ReleaseIdentity };

/** Hosted web and backend identity; never invented when unavailable. */
export function useReleaseIdentity(enabled = true) {
  const [state, setState] = useState<ReleaseIdentityState>(
    import.meta.env.DEV ? { status: "development" } : { status: "loading" },
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (import.meta.env.DEV || !enabled) return;
    let alive = true;
    setState({ status: "loading" });
    loadReleaseIdentity(attempt > 0)
      .then((identity) => {
        if (alive) setState({ status: "ready", identity });
      })
      .catch(() => {
        if (alive) setState({ status: "failed" });
      });
    return () => {
      alive = false;
    };
  }, [attempt, enabled]);
  return { state, retry: () => setAttempt((value) => value + 1) };
}
