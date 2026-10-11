import { createServerFn } from "@tanstack/react-start";
import { openQuery, type OpenQuery } from "./open5e.ts";
import { z } from "zod";
const campaign = z
  .object({ code: z.string().min(1).max(16), token: z.string().min(1).max(200) })
  .strict();
export const searchOpen5e = createServerFn({ method: "POST" })
  .validator((input: OpenQuery & { campaign?: z.infer<typeof campaign> }) => ({
    ...openQuery(input),
    ...(input.campaign ? { campaign: campaign.parse(input.campaign) } : {}),
  }))
  .handler(async ({ data }) => {
    const { setResponseHeader } = await import("@tanstack/react-start/server");
    setResponseHeader("Cache-Control", "no-store");
    const check = async () => {
      if (!data.campaign) return;
      const { guardMemberSeat } = await import("./member-access.server.ts");
      await guardMemberSeat(data.campaign);
      const { assertReferenceLookup } = await import("./cloud.server.ts");
      await assertReferenceLookup(data.campaign, data.kind);
    };
    await check();
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
    const result = normalizeOpenPage(await response.json(), data);
    await check();
    return result;
  });
