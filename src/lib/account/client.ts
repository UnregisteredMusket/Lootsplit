import { API_ORIGIN } from "../mobile/origin";
const native = () => import.meta.env.VITE_MOBILE === "true";
const TOKEN = "lootsplit.account.token.v1";
export async function accountRequest<T>(path: string, body?: unknown): Promise<T> {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  const token = native() ? localStorage.getItem(TOKEN) : null;
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${native() ? API_ORIGIN : ""}/api/account/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
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
  return result as T;
}
export type AccountLibrary = {
  user: { id: string; name: string; email: string; role: SiteRole };
  profile: MemberProfile;
  notices: { action: string; reason: string; created_at: number }[];
  members: {
    role: "dm" | "player" | null;
    room_revision: number | null;
    code: string;
    seat_id: string;
    name: string;
    archived: number;
    updated_at: number;
  }[];
  backups: { id: string; name: string; created_at: number }[];
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
