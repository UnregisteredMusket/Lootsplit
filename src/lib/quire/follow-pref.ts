import { useSyncExternalStore } from "react";

/**
 * The player's own "Follow me" switch (map tokens PR 7): on by default, kept on this device per
 * campaign, so browsing with it off never moves the token. The DM's campaign setting
 * (`world.tabletop.followView`) decides whether following happens at all.
 */
const KEY = "lootsplit.map.followMe.v1";
const listeners = new Set<() => void>();
function read(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}
export function followMe(scope: string): boolean {
  return read()[scope] ?? true;
}
export function setFollowMe(scope: string, on: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [scope]: on }));
  } catch {
    /* Private windows: the switch lasts for this page. */
    fallback[scope] = on;
  }
  for (const listener of listeners) listener();
}
const fallback: Record<string, boolean> = {};
export function useFollowMe(scope: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => fallback[scope] ?? followMe(scope),
    () => true,
  );
}
