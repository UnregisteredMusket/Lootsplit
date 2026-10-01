import { isAppOrigin } from "../../src/lib/mobile/origin.ts";

interface CorsEvent {
  url: URL;
  req: { method?: string; headers: Headers };
}

function headersFor(origin: string, requested: string | null): Headers {
  const headers = new Headers();
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", requested || "content-type, accept, x-tsr-serverfn");
  // TanStack uses these response headers to decode server-function results.
  headers.set("access-control-expose-headers", "x-tss-serialized, x-tss-raw, x-tss-context");
  headers.set("access-control-max-age", "86400");
  headers.set("vary", "origin");
  return headers;
}

export default async function mobileCors(
  event: CorsEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const origin = event.req.headers.get("origin");
  if (!origin || !isAppOrigin(origin) || !event.url.pathname.startsWith("/_serverFn")) return next();
  const allowed = headersFor(origin, event.req.headers.get("access-control-request-headers"));
  if ((event.req.method ?? "GET").toUpperCase() === "OPTIONS") return new Response(null, { status: 204, headers: allowed });
  const result = await next();
  if (!(result instanceof Response)) return result;
  const headers = new Headers(result.headers);
  allowed.forEach((value, key) => headers.set(key, value));
  return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
}
