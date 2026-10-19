// Keep this list and the named Playwright tests in sync. CI always runs all of them.
// The order balances the measured cold-CI and local two-worker timelines;
// ownership and partial recovery still start early. See the October19 tabletop audit.
export const accountScenarios = [
  "network-boundary",
  "ownership",
  "resume-partial",
  "invitations",
  "library",
  "portrait-resume",
  "recovery",
  "campaign-choice",
  "layout",
  "resume-queue",
  "dm-resume",
  "shared-recovery",
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
