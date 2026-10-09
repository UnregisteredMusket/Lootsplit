// Keep this list and the named Playwright tests in sync. CI always runs all of them.
export const accountScenarios = [
  "network-boundary",
  "ownership",
  "layout",
  "library",
  "dm-resume",
  "resume-queue",
  "recovery",
  "portrait-resume",
  "campaign-choice",
  "invitations",
  "shared-recovery",
  "resume-partial",
];

export function selectAccountScenario(args, ci = process.env.CI) {
  if (!args.length) return null;
  if (args.length !== 2 || args[0] !== "--scenario" || !accountScenarios.includes(args[1]))
    throw new Error(`Use --scenario ${accountScenarios.join("|")}; omit it for the full audit.`);
  if (ci) throw new Error("CI release audits must run every account scenario.");
  return args[1];
}

export function localAuditOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Account audits require a disposable local HTTP server with an explicit port.");
  return url.origin;
}

/** Intercept only requests outside this disposable server, never every Vite module. */
export function externalAuditRequests(value) {
  const origin = localAuditOrigin(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^(?!${origin}(?:/|$))`);
}
