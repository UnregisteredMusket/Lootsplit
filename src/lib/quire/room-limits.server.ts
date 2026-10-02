/** Guest entry points only: polling and already-authorized play do not share this budget. */
export async function limitRoomEntry(action: "open" | "lookup" | "join") {
  const env = (
    globalThis as typeof globalThis & {
      __env__?: {
        ROOM_ENTRY_LIMIT?: { limit(input: { key: string }): Promise<{ success: boolean }> };
        ASSETS?: unknown;
      };
    }
  ).__env__;
  if (!env?.ROOM_ENTRY_LIMIT) {
    if (env && "ASSETS" in env)
      throw new Error("Room entry protection is not configured. Please contact the host.");
    return; // Local development and isolated service tests.
  }
  const { getRequestHeader, setResponseHeader, setResponseStatus } =
    await import("@tanstack/react-start/server");
  // CF overwrites this header at the edge. Never trust a caller-selected forwarded IP.
  const ip = getRequestHeader("cf-connecting-ip");
  if (!ip) throw new Error("Could not verify the connection. Please retry.");
  const { success } = await env.ROOM_ENTRY_LIMIT.limit({ key: `lootsplit:${action}:${ip}` });
  if (!success) {
    setResponseStatus(429);
    setResponseHeader("Retry-After", "60");
    throw new Error(
      "Too many room entry attempts. Wait a minute and try again. Your campaign is unchanged.",
    );
  }
}
