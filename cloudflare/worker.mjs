/**
 * Cloudflare Worker entry for Lootsplit.
 * `npm run build:cloudflare` writes the app server to dist/server/index.mjs.
 * Static files are served from the ASSETS binding. Shared rooms use the D1 binding named DB.
 */
import { handleAccounts } from "./accounts.mjs";
import { recoveryGuard } from "./recovery-guard.mjs";
import { serveBuildAsset, releaseResponse } from "./release-assets.mjs";
import { crawlerFile, landingRedirect } from "../src/lib/deployment/public-urls.mjs";
import { cachedPublicPage } from "./public-page-cache.mjs";
import handler from "../dist/server/index.mjs";
import { scheduledMonitor } from "./monitor-journal.mjs";
import { telemetryResponse } from "./monitor-telemetry.mjs";
import { expireRateLimits, rateLimitExpiryDue } from "./rate-limit-expiry.mjs";

export default {
  async scheduled(controller, env) {
    // Await the durable result: rejected scheduled executions remain visible in Cloudflare.
    // Rate-limit expiry runs independently of monitoring, so one failing never skips the other.
    const [monitor, expiry] = await Promise.allSettled([
      scheduledMonitor(env, controller.scheduledTime),
      rateLimitExpiryDue(controller.scheduledTime)
        ? expireRateLimits(env.DB, controller.scheduledTime)
        : null,
    ]);
    if (monitor.status === "rejected") throw monitor.reason;
    if (expiry.status === "rejected") throw expiry.reason;
  },
  async fetch(request, env, context) {
    const recovery = await recoveryGuard(request, env);
    if (recovery) return recovery;
    const telemetry = await telemetryResponse(request, env);
    if (telemetry) return telemetry;
    const asset = await serveBuildAsset(request, env);
    if (asset) return asset;
    const crawler = crawlerFile(request);
    if (crawler)
      return releaseResponse(
        new Response(request.method === "HEAD" ? null : crawler.body, {
          headers: { "Content-Type": crawler.type, "Cache-Control": "public, max-age=3600" },
        }),
        env,
      );
    const landing = landingRedirect({
      method: request.method,
      url: request.url,
      accept: request.headers.get("accept"),
      cookie: request.headers.get("cookie"),
    });
    if (landing)
      return releaseResponse(
        new Response(null, {
          status: 302,
          headers: { Location: landing, "Cache-Control": "no-store", Vary: "Cookie" },
        }),
        env,
      );
    const accountResponse = await handleAccounts(request, env);
    if (accountResponse) return accountResponse;
    globalThis.__env__ = env;
    return releaseResponse(
      await cachedPublicPage(request, env, context, () => handler.fetch(request, env, context)),
      env,
    );
  },
};
