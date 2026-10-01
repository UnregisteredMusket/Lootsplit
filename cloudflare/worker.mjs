/**
 * Cloudflare Worker entry for Lootsplit.
 * `npm run build:cloudflare` writes the app server to dist/server/index.mjs.
 * Static files are served from the ASSETS binding. Shared rooms use the D1 binding named DB.
 */
import handler from "../dist/server/index.mjs";

export default {
  fetch(request, env, context) {
    globalThis.__env__ = env;
    return handler.fetch(request, env, context);
  },
};
