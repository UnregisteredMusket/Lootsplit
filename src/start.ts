import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { isAppOrigin } from "@/lib/mobile/origin";

function sameOrigin(origin: string, requestUrl: string): boolean {
  try {
    return origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

const csrf = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
  secFetchSite: (site, ctx) => {
    if (site === "same-origin" || site === "none") return true;
    return isAppOrigin(ctx.request.headers.get("origin"));
  },
  origin: (origin, ctx) => isAppOrigin(origin) || sameOrigin(origin, ctx.request.url),
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf],
}));
