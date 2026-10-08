/** Client identity comes from the runtime, never from an Android user-agent string. */
export function clientKind(isNative: boolean, platform?: string) {
  if (!isNative) return "browser" as const;
  return platform === "android" ? ("android-native" as const) : ("native" as const);
}

export function describeClient(input: {
  isNative: boolean;
  platform?: string;
  declaredVersion: string;
  installedVersion?: string;
}) {
  const kind = clientKind(input.isNative, input.platform);
  const installedVersion = input.isNative ? input.installedVersion?.trim() : undefined;
  return {
    kind,
    label: kind === "android-native" ? "Android app" : kind === "native" ? "Native app" : "Browser",
    version: installedVersion || input.declaredVersion,
    versionLabel: installedVersion ? "Installed app version" : "Client release label",
  };
}

export type ReleaseIdentity = { commit: string; runId: string | null };

/** The existing public build asset contains no credentials or campaign data. */
export function parseReleaseIdentity(value: unknown): ReleaseIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.commit !== "string" || !/^[a-f0-9]{40}$/.test(record.commit)) return null;
  return {
    commit: record.commit,
    runId:
      typeof record.runId === "string" && /^[1-9]\d*$/.test(record.runId) ? record.runId : null,
  };
}
