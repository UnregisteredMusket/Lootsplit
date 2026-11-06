// Playwright's APIRequestContext keeps HTTP keep-alive sockets between requests. When the dev
// server (or wrangler dev) has already closed an idle socket, the next request on it fails with
// "read ECONNRESET" before anything reaches the server. Only a read is ever retried, and only
// once, for that exact transport error: a reset GET changed nothing, so asking again is safe.
// Never use this for POST/PUT/DELETE or for any other error.
const RESET = /\bECONNRESET\b|socket hang up/;

/** True when the error is the stale keep-alive reset this helper retries. */
export function isConnectionReset(error) {
  return RESET.test(String(error?.message ?? error ?? ""));
}

/** `request.get(url, options)`, retried once on a connection reset. */
export async function getWithReset(request, url, options) {
  try {
    return await request.get(url, options);
  } catch (error) {
    if (!isConnectionReset(error)) throw error;
    return request.get(url, options);
  }
}
