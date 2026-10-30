import { createServerFn } from "@tanstack/react-start";
import { openQuery, type OpenQuery } from "./open5e.ts";
import { z } from "zod";
const campaign = z
  .object({ code: z.string().min(1).max(16), token: z.string().min(1).max(200) })
  .strict();
// Keep the public, credential-free GET function for existing bundled Android clients.
export const searchOpen5e = createServerFn({ method: "GET" })
  .validator((input: OpenQuery) => {
    const q = openQuery(input);
    return { kind: q.kind, edition: q.edition, query: q.query, page: q.page };
  })
  .handler(async ({ data }) => {
    const { setResponseHeader } = await import("@tanstack/react-start/server");
    setResponseHeader("Cache-Control", "no-store");
    const { fetchReference } = await import("./open5e-reference.server.ts");
    return fetchReference(data);
  });
export const searchScopedOpen5e = createServerFn({ method: "POST" })
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
    const { fetchReference } = await import("./open5e-reference.server.ts");
    const result = await fetchReference(data);
    await check();
    return result;
  });
