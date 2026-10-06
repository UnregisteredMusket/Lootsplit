import { deploymentOrigins, validateOrigin } from "../deployment/origins.mjs";
export function invitationUrl(input: { origin: string; native?: boolean; code: string; session: string; character?: string; invitation?: string }) {
  const origin = input.native ? deploymentOrigins.website : validateOrigin(input.origin, true);
  const url = new URL("/share", origin);
  url.searchParams.set("join", input.code);
  url.searchParams.set("session", input.session);
  if (input.character) url.searchParams.set("character", input.character);
  if (input.invitation) url.searchParams.set("invitation", input.invitation);
  return url.href;
}
