import { roleOf } from "./members.mjs";

// Read-only aggregate diagnostics. Never return identities, room bodies, keys or endpoints.
export async function serverMonitor(env, userId) {
  if (!["owner", "admin"].includes(await roleOf(env.DB, userId)))
    throw Object.assign(new Error("Owner or administrator access is required."), { status: 403 });
  const started = Date.now();
  async function check(name, operation) {
    const start = Date.now();
    let timer;
    try {
      const value = await Promise.race([
        operation(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), 5000);
        }),
      ]);
      return { name, status: "healthy", durationMs: Date.now() - start, value };
    } catch {
      // Raw exceptions may contain SQL or credentials; keep diagnostics intentionally generic.
      return { name, status: "unavailable", durationMs: Date.now() - start, value: null };
    } finally {
      clearTimeout(timer);
    }
  }
  const [database, assets] = await Promise.all([
    check("Database", async () => {
      const row = await env.DB.prepare(
        `SELECT
        (SELECT COUNT(*) FROM user) AS accounts,
        (SELECT COUNT(*) FROM member_profiles WHERE last_online >= ?) AS active5m,
        (SELECT COUNT(*) FROM member_profiles WHERE last_online >= ?) AS active24h,
        (SELECT COUNT(*) FROM campaign_rooms) AS sharedCampaigns,
        (SELECT COUNT(*) FROM library_members) AS savedMemberships,
        (SELECT COUNT(*) FROM library_backups) AS cloudBackups,
        (SELECT COUNT(*) FROM library_characters) AS characterProfiles,
        (SELECT COUNT(DISTINCT endpoint) FROM push_subscriptions) AS pushDevices,
        (SELECT COUNT(*) FROM push_config WHERE id='vapid') AS pushConfigured,
        (SELECT COUNT(*) FROM moderation_audit WHERE created_at >= ?) AS moderation24h
      `,
      )
        .bind(started - 300000, started - 86400000, started - 86400000)
        .first();
      if (!row) throw new Error("no data");
      return row;
    }),
    check("Website assets", async () => {
      if (!env.ASSETS) throw new Error("binding unavailable");
      // Fixed same-site asset, no cookies or user-controlled destinations.
      const result = await env.ASSETS.fetch(
        new Request(new URL("/favicon.svg", env.ACCOUNT_ORIGIN), { method: "HEAD" }),
      );
      if (result.status !== 200 || !result.headers.get("content-type")?.includes("image/svg+xml"))
        throw new Error("asset unavailable");
      return null;
    }),
  ]);
  return {
    checkedAt: Date.now(),
    durationMs: Date.now() - started,
    status: database.status === "healthy" && assets.status === "healthy" ? "healthy" : "degraded",
    checks: [database, assets].map(({ name, status, durationMs }) => ({
      name,
      status,
      durationMs,
    })),
    stats: database.value,
    version: env.CF_VERSION_METADATA
      ? {
          id: env.CF_VERSION_METADATA.id || null,
          createdAt: env.CF_VERSION_METADATA.timestamp || null,
        }
      : null,
  };
}
