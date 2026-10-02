/**
 * Cloudflare Worker entry for Lootsplit.
 * `npm run build:cloudflare` writes the app server to dist/server/index.mjs.
 * Static files are served from the ASSETS binding. Shared rooms use the D1 binding named DB.
 */
import { handleAccounts } from "./accounts.mjs";
import handler from "../dist/server/index.mjs";

export default {
  async fetch(request, env, context) {
    const accountResponse = await handleAccounts(request, env);
    if (accountResponse) return accountResponse;
    globalThis.__env__ = env;
    return handler.fetch(request, env, context);
  },
};
