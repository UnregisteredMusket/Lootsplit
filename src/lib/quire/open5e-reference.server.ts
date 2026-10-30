import type { OpenQuery } from "./open5e.ts";
/** Server-only Open5e read for the reference search functions (cached, retried, friendly errors). */
export async function fetchReference(data: OpenQuery) {
  const { openUrl, normalizeOpenPage } = await import("./open5e.ts");
  const { readOpen5e } = await import("./open5e-fetch.mjs");
  const { afterResponse } = await import("../../../cloudflare/request-context.mjs");
  // Only the public reference URL (section, edition, search text, page) reaches Open5e.
  const payload = await readOpen5e(openUrl(data), {
    defer: (task) => void afterResponse(task),
  });
  return normalizeOpenPage(payload, data);
}
