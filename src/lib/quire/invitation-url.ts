import { deploymentOrigins, validateOrigin } from "../deployment/origins.mjs";
/** Origin for links people open elsewhere: the public website on native (the app's own origin is https://localhost), otherwise this page's origin. */
export function publicLinkOrigin(input: { origin: string; native?: boolean }) {
  return input.native ? deploymentOrigins.website : validateOrigin(input.origin, true);
}
export function invitationUrl(input: { origin: string; native?: boolean; code: string; session: string; character?: string; invitation?: string }) {
  const url = new URL("/share", publicLinkOrigin(input));
  url.searchParams.set("join", input.code);
  url.searchParams.set("session", input.session);
  if (input.character) url.searchParams.set("character", input.character);
  if (input.invitation) url.searchParams.set("invitation", input.invitation);
  return url.href;
}
