/**
 * Cloudflare Worker entry for Lootsplit.
 * `npm run build:cloudflare` writes the app server to dist/server/index.mjs.
 * Static files are served from the ASSETS binding. Shared rooms use the D1 binding named DB.
 */
import { handleAccounts } from "./accounts.mjs";
import handler from "../dist/server/index.mjs";

export default {
  async fetch(request, env, context) {
    // Public release identity contains only the source commit and Actions run id.
    if (new URL(request.url).pathname === "/assets/release-identity.json" &&
        (request.method === "GET" || request.method === "HEAD")) {
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    const accountResponse = await handleAccounts(request, env);
    if (accountResponse) return accountResponse;
    globalThis.__env__ = env;
    return handler.fetch(request, env, context);
  },
};
