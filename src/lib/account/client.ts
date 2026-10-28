import { API_ORIGIN } from "../mobile/origin";
import { announceSheetChange } from "../quire/party-sheet-links";
import { readAccountResponse } from "./response";
import { accountTokenReady, accountTokenSettled } from "../mobile/token-binding";
import { announceWorkspaceChange } from "../quire/workspace-events";
const native = () => import.meta.env.VITE_MOBILE === "true";
async function disconnectOwnerWidget(expectedToken?: string) {
  // Native integration must not add a Capacitor startup dependency to website account reads.
  if (native()) await (await import("../mobile/owner-widget")).disconnectOwnerWidget(expectedToken);
}
const TOKEN = "lootsplit.account.token.v1";
// Coalesce the startup gate and account controls' identity reads. This is UI
// state only: every server mutation independently authenticates the request.
let identityRead: { until: number; result: Promise<unknown> } | undefined;
export function forgetAccountIdentity() {
  identityRead = undefined;
}
/** A sign-in, sign-up or recovery request carrying the Turnstile human-check token. */
export function accountRequestWithCaptcha<T>(path: string, body: unknown, captcha: string): Promise<T> {
  if (path.startsWith("auth/")) identityRead = undefined;
  return accountRequestCore<T>(path, body, undefined, captcha);
}
export function accountRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  if (body !== undefined && path.startsWith("auth/")) identityRead = undefined;
  if (path === "auth/get-session" && body === undefined && !signal) {
    if (identityRead && identityRead.until > Date.now()) return identityRead.result as Promise<T>;
    const result = accountRequestCore<T>(path).catch((e) => {
      identityRead = undefined;
      throw e;
    });
    identityRead = { until: Date.now() + 2500, result };
    return result;
  }
  return accountRequestCore<T>(path, body, signal);
}
async function accountRequestCore<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  captcha?: string,
): Promise<T> {
  if (
    native() &&
    body !== undefined &&
    ["auth/sign-out", "auth/sign-in/email", "auth/sign-up/email"].includes(path)
  )
    await disconnectOwnerWidget();
  const headers = new Headers();
  headers.set("accept", "application/json");
  headers.set("x-lootsplit-tabletop", "10");
  if (body !== undefined) headers.set("content-type", "application/json");
  if (captcha) headers.set("x-captcha-response", captcha);
  // Once per page: drop a token restored from another installation before it is ever sent.
  if (native() && !accountTokenSettled()) await accountTokenReady();
  const token = native() ? localStorage.getItem(TOKEN) : null;
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${native() ? API_ORIGIN : ""}/api/account/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    signal,
    credentials: native() ? "omit" : "same-origin",
    cache: "no-store",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (native() && token && (response.status === 401 || (response.status === 403 && path.startsWith("owner/monitor")))) await disconnectOwnerWidget(token);
  const result = await readAccountResponse<{
    error?: string | { message?: string };
    message?: string;
    user?: { role?: string } | null;
  } | null>(response);
  if (
    native() &&
    token &&
    response.ok &&
    ((path === "auth/get-session" && !result?.user) ||
      (path === "library" && result?.user?.role !== "owner"))
  )
    await disconnectOwnerWidget(token);
  if (path === "activity" && response.status === 401)
    localStorage.removeItem("lootsplit.account.active");
  if (response.ok && path === "library") localStorage.setItem("lootsplit.account.active", "yes");
  if (path === "auth/sign-out" && response.ok) localStorage.removeItem("lootsplit.account.active");
  if (!response.ok)
    throw Object.assign(
      new Error(
        (typeof result?.error === "object" ? result.error?.message : result?.error) ||
          result?.message ||
          "The account service is unavailable. Try again when online.",
      ),
      { status: response.status },
    );
  const nextToken = response.headers.get("set-auth-token");
  if (native() && nextToken) localStorage.setItem(TOKEN, nextToken);
  if (path === "auth/sign-out") localStorage.removeItem(TOKEN);
  if (body !== undefined && path.startsWith("auth/")) {
    identityRead = undefined;
    announceSheetChange();
  }
  if (response.ok && ["auth/sign-in/email", "auth/sign-up/email", "auth/sign-out"].includes(path)) {
    // Old account identity must not authorize device recovery while the gate is
    // checking the newly authenticated account (or after sign-out).
    sessionStorage.removeItem("lootsplit.verified-account");
    window.dispatchEvent(new Event("lootsplit-account-changed"));
    announceWorkspaceChange("account");
  }
  return result as T;
}
export type AccountLibrary = {
  user: { id: string; name: string; email: string; role: SiteRole };
  profile: MemberProfile;
  notices: { action: string; reason: string; created_at: number }[];
  members: {
    role: "dm" | "player" | null;
    closed: boolean;
    /** Derived room metadata; absent on older servers/clients. */
    viewOnly?: boolean;
    live?: boolean;
    room_revision: number | null;
    code: string;
    seat_id: string;
    name: string;
    /** The DM's campaign name for the room (not private); absent on older servers or unnamed rooms. */
    campaignName?: string;
    archived: number;
    updated_at: number;
    has_recovery?: number;
  }[];
  backups: { id: string; name: string; created_at: number; shared_recovery?: number }[];
  characters: CharacterProfile[];
  hasRecoveryKey: boolean;
  /** Live online campaigns this account hosts against its limit; absent on older servers. */
  hosting?: HostingAllowance;
};
/** Server-computed; the server enforces the limit on every hosting path (client display only). */
export type HostingAllowance = { hosted: number; limit: number; exempt: boolean; atLimit: boolean };
/** "1 of 2 online campaigns" (owner accounts are not limited). */
export function hostingLabel(h: HostingAllowance) {
  return h.exempt
    ? `${h.hosted} online ${h.hosted === 1 ? "campaign" : "campaigns"} (site owner: not limited)`
    : `${h.hosted} of ${h.limit} online ${h.limit === 1 ? "campaign" : "campaigns"}`;
}
export const HOSTING_LIMIT_HELP =
  "End (close) or delete one of your online campaigns to free a slot, or keep playing this campaign offline on your device: Local play has no limit, and joining other campaigns as a player is never limited.";
export type CharacterProfile = { id: string; name: string; description: string; portrait: string };
export type AccountMembership = {
  userId: string;
  code: string;
  token: string;
  seatId: string;
  role: "dm" | "player";
  purseIds: string[];
  name: string;
};

export type SiteRole = "owner" | "admin" | "moderator" | "member";
export type MemberProfile = {
  id: string;
  name: string;
  member_since: string | number;
  last_online: number | null;
  introduction: string;
  portrait: string;
  contact_email: string;
  share_contact: number;
  email_opt_in: number;
  revision: number;
};
