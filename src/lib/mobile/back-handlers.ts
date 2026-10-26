/**
 * Screen-level Back interceptors (Android hardware Back).
 *
 * The shell asks, in order: an open themed dialog (`dismissDialog`), its own overlays, an open
 * `[role=dialog]` with a Close button, then these handlers (newest first), and only then
 * `history.back()`. A handler returns true when it consumed the press.
 */
type BackHandler = () => boolean;
const handlers: BackHandler[] = [];

export function registerBackHandler(handler: BackHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

/** Runs the newest handler first; returns true as soon as one consumes the press. */
export function runBackHandlers(): boolean {
  for (const handler of [...handlers].reverse()) if (handler()) return true;
  return false;
}
