import { accountRequest } from "../account/client";
import { localEncounterRequest } from "./local";
export function encounterRequest<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const target = body as { id?: string; code?: string } | undefined;
  if (target?.id?.startsWith("local-") || target?.code === "device")
    return localEncounterRequest<T>(path, body);
  return accountRequest<T>(path, body, signal);
}
