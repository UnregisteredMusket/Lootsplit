import { activeDatabaseName } from "./db.ts";
import { isEphemeralCampaign } from "./guest-storage.ts";

export type DeviceMutationScope = Readonly<{
  campaignId: string;
  databaseName: string;
  accountId: string;
  ephemeral: boolean;
}>;

/** Use live storage, not a React/campaign presentation snapshot. */
export function captureDeviceMutationScope(): DeviceMutationScope {
  const ephemeral = isEphemeralCampaign();
  return Object.freeze({
    campaignId:
      typeof localStorage === "undefined"
        ? "main"
        : localStorage.getItem("quire.campaign.v1") || "main",
    databaseName: ephemeral ? "guest-memory" : activeDatabaseName(),
    accountId:
      typeof sessionStorage === "undefined"
        ? ""
        : sessionStorage.getItem("lootsplit.verified-account") || "",
    ephemeral,
  });
}

export function assertDeviceMutationScope(expected: DeviceMutationScope): void {
  const actual = captureDeviceMutationScope();
  if (
    actual.campaignId !== expected.campaignId ||
    actual.databaseName !== expected.databaseName ||
    actual.accountId !== expected.accountId ||
    actual.ephemeral !== expected.ephemeral
  )
    throw Error(
      "The campaign or account changed before this action could finish. Your draft is retained; reopen its original campaign before trying again.",
    );
}
