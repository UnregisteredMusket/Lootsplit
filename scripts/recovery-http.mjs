// Bounded retries for reads, or a write explicitly protected by an idempotency key.
export async function requestJson(
  url,
  options = {},
  {
    fetchImpl = fetch,
    pause = (ms) => new Promise((r) => setTimeout(r, ms)),
    attempts = 3,
    timeoutMs = 15000,
  } = {},
) {
  const method = options.method || "GET";
  if (method !== "GET" && !options.headers?.["Idempotency-Key"])
    throw Error("Refusing to retry a write without an idempotency key");
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      if (attempt + 1 === attempts) throw Error("Network request failed after bounded retries");
      await pause(1000 * 2 ** attempt);
      continue;
    }
    if (response.ok) return response.json();
    if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt + 1 === attempts)
      throw Error(`Remote request returned HTTP ${response.status}`);
    await pause(
      Math.min(
        10000,
        Math.max(1000 * 2 ** attempt, Number(response.headers.get("retry-after") || 0) * 1000),
      ),
    );
  }
  throw Error("No request attempts configured");
}
