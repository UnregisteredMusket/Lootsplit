/**
 * The public support address (Cloudflare Email Routing on lootsplitter.com, owner
 * decision 2026-10-22). It forwards privately; never publish the forwarding target.
 * Links use a plain `mailto:` anchor: it is an external URL, so it never goes through
 * AppLink, never unloads the document and cannot replay the title screen.
 */
export const SUPPORT_EMAIL = "support@lootsplitter.com";
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;
