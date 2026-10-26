import { useRouterState } from "@tanstack/react-router";

/** Tab title of the website's not-found page (W-1). */
export const NOT_FOUND_TITLE = "Page not found · Lootsplitter";

/** True when no route matched the address, so only the root route is in the match list. */
export function isUnmatchedRoute(matches: readonly { routeId: string }[]) {
  return matches.length > 0 && matches.every((match) => match.routeId === "__root__");
}

/** Whether the current address matched no page (an unknown or mistyped link). */
export function useUnmatchedRoute() {
  return useRouterState({ select: (state) => isUnmatchedRoute(state.matches) });
}
