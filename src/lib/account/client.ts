import { API_ORIGIN } from "../mobile/origin";
import { announceSheetChange } from "../quire/party-sheet-links";
const native = () => import.meta.env.VITE_MOBILE === "true";
const TOKEN = "lootsplit.account.token.v1";
// Coalesce the startup gate and account controls' identity reads. This is UI
// state only: every server mutation independently authenticates the request.
let identityRead: { until: number; result: Promise<unknown> } | undefined;
export function accountRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  if (body !== undefined && path.startsWith("auth/")) identityRead = undefined;
  if (path === "auth/get-session" && body === undefined && !signal) {
    if (identityRead && identityRead.until > Date.now()) return identityRead.result as Promise<T>;
    const result = accountRequestCore<T>(path).catch(e => { identityRead = undefined; throw e; });
    identityRead = { until: Date.now() + 2500, result };
    return result;
  }
  return accountRequestCore<T>(path, body, signal);
}
async function accountRequestCore<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  const token = native() ? localStorage.getItem(TOKEN) : null;
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${native() ? API_ORIGIN : ""}/api/account/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    signal,
    credentials: native() ? "omit" : "same-origin",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (path === "activity" && response.status === 401)
    localStorage.removeItem("lootsplit.account.active");
  if (response.ok && path === "library") localStorage.setItem("lootsplit.account.active", "yes");
  if (path === "auth/sign-out" && response.ok) localStorage.removeItem("lootsplit.account.active");
  if (!response.ok)
    throw new Error(
      result.error?.message ||
        result.error ||
        result.message ||
        "The account service is unavailable. Try again when online.",
    );
  const nextToken = response.headers.get("set-auth-token");
  if (native() && nextToken) localStorage.setItem(TOKEN, nextToken);
  if (path === "auth/sign-out") localStorage.removeItem(TOKEN);
  if (body !== undefined && path.startsWith("auth/")) { identityRead = undefined; announceSheetChange(); }
  if (response.ok && ["auth/sign-in/email", "auth/sign-up/email", "auth/sign-out"].includes(path)) {
    // Old account identity must not authorize device recovery while the gate is
    // checking the newly authenticated account (or after sign-out).
    sessionStorage.removeItem("lootsplit.verified-account");
    window.dispatchEvent(new Event("lootsplit-account-changed"));
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
    archived: number;
    updated_at: number;
    has_recovery?: number;
  }[];
  backups: { id: string; name: string; created_at: number; shared_recovery?: number }[];
  characters: CharacterProfile[];
  hasRecoveryKey: boolean;
};
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
