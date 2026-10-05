import { rewriteServerFnUrl } from "./origin.ts";

/** Installed once, and only in the packaged client. The website keeps same-origin calls. */
export function installMobileApi(): void {
  if (import.meta.env.VITE_MOBILE !== "true" || typeof window === "undefined") return;
  const mark = window as Window & { __lootsplitMobileApi?: boolean };
  if (mark.__lootsplitMobileApi) return;
  mark.__lootsplitMobileApi = true;
  const base = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const next = rewriteServerFnUrl(raw, window.location.origin);
    if (!next) return base(input, init);
    // Only the fixed Worker server-function destination receives account credentials.
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const token = localStorage.getItem("lootsplit.account.token.v1");
    if (token) headers.set("authorization", `Bearer ${token}`);
    const options = { ...init, headers };
    if (typeof Request !== "undefined" && input instanceof Request) return base(new Request(next, input), options);
    return base(next, options);
  };
}

installMobileApi();
