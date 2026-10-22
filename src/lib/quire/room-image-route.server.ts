/**
 * GET /api/room-image/CODE/HASH: one shared map image for a seated participant (tabletop
 * protocol 4). Credentials travel in headers, never in the URL: `x-lootsplit-seat` carries the
 * seat token, and account seats also send their session (cookie on the website, bearer token in
 * the Android app). Authorization is the room projection itself (`authorizedRoomImage`).
 *
 * Caching: the body is immutable content addressed by its SHA-256, so the strong ETag is the
 * hash. `private, no-cache` keeps it out of shared caches and makes every reuse revalidate, so a
 * released, revoked or hidden-map seat gets a 403/404 instead of a cached copy; an authorized
 * revalidation is a bodiless 304. The client also keeps its own per-campaign cache, so most
 * revisions make no request at all.
 *
 * The body is the exact stored `data:image/...;base64,...` text (text/plain), not decoded bytes:
 * the client restores that exact string into the table, so later map edits compare equal with the
 * server's copy. It is never rendered from this URL, so the page's CSP is unaffected.
 */
const CODE = /^[A-Z0-9]{4,16}$/;
const HASH = /^[a-f0-9]{64}$/;

function refusal(status: number, message: string) {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function roomImageResponse(
  request: Request,
  params: { code: string; hash: string },
): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method)) return refusal(405, "Method not allowed.");
  const code = params.code.trim().toUpperCase(),
    hash = params.hash.trim().toLowerCase();
  if (!CODE.test(code) || !HASH.test(hash)) return refusal(404, "No campaign image is available.");
  const token = request.headers.get("x-lootsplit-seat") ?? "";
  if (!token || token.length > 200) return refusal(403, "This browser is not seated at that table.");
  try {
    const { guardMemberSeat } = await import("./member-access.server.ts");
    await guardMemberSeat({ code, token }, request);
  } catch {
    return refusal(403, "This seat cannot read that campaign.");
  }
  const { authorizedRoomImage } = await import("./cloud.server.ts");
  const result = await authorizedRoomImage({
    code,
    token,
    reference: `/art/room-image-${hash}.webp`,
  });
  if ("status" in result)
    return refusal(
      result.status,
      result.status === 403
        ? "This browser is not seated at that table."
        : "No campaign image is available for this seat.",
    );
  const etag = `"${hash}"`;
  const headers = {
    etag,
    "cache-control": "private, no-cache",
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  };
  const match = request.headers.get("if-none-match");
  if (match && match.split(",").some((value) => value.trim().replace(/^W\//, "") === etag))
    return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : result.image, { status: 200, headers });
}
