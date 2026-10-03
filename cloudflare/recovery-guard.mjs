// This switch must remain set throughout a recovery, including subsequent releases.
export async function recoveryGuard(request, env) {
  const fenced = Boolean(env.RECOVERY_FENCE);
  if (new URL(request.url).pathname === "/.well-known/lootsplit-recovery") {
    const id = fenced ? Array.from(new Uint8Array(await crypto.subtle.digest(
      "SHA-256", new TextEncoder().encode(env.RECOVERY_FENCE),
    )), (byte) => byte.toString(16).padStart(2, "0")).join("") : null;
    return Response.json({ mode: fenced ? "fenced" : "primary", fenceId: id }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (fenced) return new Response("Lootsplit is undergoing recovery. Please use the recovery address provided by the host.", {
    status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" },
  });
  return null;
}
