import { accountRequest } from "../account/client";
import { localEncounterRequest } from "./local";
import { announceWorkspaceChange } from "../quire/workspace-events";
export async function encounterRequest<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const target = body as { id?: string; code?: string } | undefined;
  const result =
    target?.id?.startsWith("local-") || target?.code === "device"
      ? await localEncounterRequest<T>(path, body)
      : await accountRequest<T>(path, body, signal);
  if (/^encounters\/(create|save|start|conclude|roll|award)$/.test(path)) announceWorkspaceChange();
  return result;
}
