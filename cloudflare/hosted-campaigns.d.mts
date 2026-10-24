type Db = { prepare(sql: string): any; batch(statements: any[]): Promise<any[]> };
export type HostedCampaignStatus = { hosted: number; limit: number; exempt: boolean; atLimit: boolean };
export type HostingPath = "open" | "reopen" | "restore" | "link";
export const DEFAULT_HOSTED_CAMPAIGN_LIMIT: number;
export const HOSTED_CAMPAIGN_LIMIT_CODE: string;
export function hostedCampaignLimit(env?: { HOSTED_CAMPAIGN_LIMIT?: string | number }): number;
export function hostedCampaignLimitMessage(limit: number): string;
export const hostedCampaignGuardSql: string;
export function hostedCampaignGuardArgs(userId: string, limit: number): [string, string, number];
export function hostedCampaignStatus(db: Db, userId: string, limit?: number): Promise<HostedCampaignStatus>;
export function hostedCampaignLimitError(limit: number): Error & { status: number; code: string };
export function recordHostedCampaignRefusal(
  db: Db,
  userId: string,
  path: string,
  status: HostedCampaignStatus,
  now?: number,
): Promise<void>;
export function assertCanHost(db: Db, userId: string, path: string, limit?: number): Promise<HostedCampaignStatus>;
