/**
 * The campaign gate's decision after the account check (audit 2026-11-10 D1).
 *
 * Only a positive "no session" (a 200 with no user, or 401/403) signs a device out of its owned
 * campaign and forgets the offline-owner marker. A check that could not finish (network error,
 * captive Wi-Fi page, 5xx during a deploy, 429 from the per-address sign-in limit a table shares)
 * keeps device-owner access, says so, and is retried; the account is checked again later.
 */
export type IdentityCheck =
  | { kind: "signed-in"; userId: string }
  | { kind: "signed-out" }
  | { kind: "unknown" };

/** What a failed account read tells the gate: 401/403 mean signed out, anything else unknown. */
export function identityFailure(error: unknown): IdentityCheck {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 401 || status === 403 ? { kind: "signed-out" } : { kind: "unknown" };
}

export type GateAccess = {
  /** sessionStorage "lootsplit.verified-account": a user ID to set, null to remove, undefined to leave. */
  verified: string | null | undefined;
  /** localStorage "lootsplit.offline-owner": a user ID to set, null to remove, undefined to leave. */
  marker: string | null | undefined;
  /** This device's campaign opens as its owner's. */
  owned: boolean;
  /** The check did not finish: show a notice with Retry and check again later. */
  unchecked: boolean;
};

export const UNCHECKED_NOTICE =
  "Your account could not be checked just now. This device's campaign stays open; Lootsplitter checks again when you reconnect or come back to this window.";
export const UNCHECKED_SIGNED_OUT_NOTICE =
  "Your account could not be checked. Reconnect and retry before opening a campaign.";

export function gateAccess({
  check,
  owner,
  marker,
}: {
  check: IdentityCheck;
  /** `quire.owner.<campaign>`: the account that owns this device's campaign, if any. */
  owner: string | null;
  /** `lootsplit.offline-owner`: the last account verified on this device. */
  marker: string | null;
}): GateAccess {
  if (check.kind === "signed-in")
    return {
      verified: check.userId,
      marker: check.userId,
      owned: owner === check.userId,
      unchecked: false,
    };
  if (check.kind === "signed-out")
    return { verified: null, marker: null, owned: false, unchecked: false };
  const deviceOwner = !!owner && owner === marker;
  return {
    verified: deviceOwner ? owner : undefined,
    marker: undefined,
    owned: deviceOwner,
    unchecked: true,
  };
}
