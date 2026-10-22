import { rewriteServerFnUrl } from "./origin.ts";
import { ACCOUNT_TOKEN, accountTokenReady, accountTokenSettled } from "./token-binding.ts";

/** Installed once, and only in the packaged client. The website keeps same-origin calls. */
export function installMobileApi(): void {
  if (import.meta.env.VITE_MOBILE !== "true" || typeof window === "undefined") return;
  const mark = window as Window & { __lootsplitMobileApi?: boolean };
  if (mark.__lootsplitMobileApi) return;
  mark.__lootsplitMobileApi = true;
  void accountTokenReady(); // Start the restored-token check before the first request needs it.
  const base = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const next = rewriteServerFnUrl(raw, window.location.origin);
    if (!next) return base(input, init);
    // Only the fixed Worker server-function destination receives account credentials.
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const send = () => {
      const token = localStorage.getItem(ACCOUNT_TOKEN);
      if (token) headers.set("authorization", `Bearer ${token}`);
      const options = { ...init, headers };
      if (typeof Request !== "undefined" && input instanceof Request) return base(new Request(next, input), options);
      return base(next, options);
    };
    // Wait (first request only) for the restored-token check, so a token copied from another install is never sent.
    return accountTokenSettled() ? send() : accountTokenReady().then(send);
  };
}

installMobileApi();
