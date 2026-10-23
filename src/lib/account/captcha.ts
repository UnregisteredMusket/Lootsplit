import { accountRequest } from "./client";

let config: Promise<{ required: boolean; siteKey: string }> | null = null;
/** Whether this server asks for the human check (only when its Turnstile secret is set). */
export function captchaConfig() {
  if (import.meta.env.VITE_MOBILE === "true") return Promise.resolve({ required: false, siteKey: "" });
  config ??= accountRequest<{ required: boolean; siteKey: string }>("captcha").catch(() => {
    config = null;
    return { required: false, siteKey: "" };
  });
  return config;
}
