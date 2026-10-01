import { createServerFn } from "@tanstack/react-start";
import { openQuery, type OpenQuery } from "./open5e.ts";
export const searchOpen5e = createServerFn({ method: "GET" })
  .validator((input: OpenQuery) => openQuery(input))
  .handler(async ({ data }) => {
    const { openUrl, normalizeOpenPage } = await import("./open5e.ts");
    const response = await fetch(openUrl(data), {
      signal: AbortSignal.timeout(12000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? "Open5e is busy. Please try again shortly."
          : "Open5e is unavailable. Try again later.",
      );
    return normalizeOpenPage(await response.json(), data);
  });
