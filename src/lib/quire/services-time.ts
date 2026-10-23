import { z } from "zod";
import type { CloudTable } from "./cloud.ts";
import { canonicalJson } from "./canonical-json.ts";
import { previewDays } from "./service-core.ts";
import { readServices, servicesSchema } from "./services-schema.ts";

const id = z.string().min(1).max(150);
/** Workshop progress inside the single DM-approved downtime quote (the forge's model). */
export const serviceQuoteSchema = z
  .object({
    before: z.string(),
    state: servicesSchema,
    notices: z.array(z.object({ orderId: id, purseId: id, summary: z.string().max(1000) })),
  })
  .strict();

/** Pure: only approved between-session downtime advances work; session hours never do. */
export function previewServices(t: Pick<CloudTable, "journal">, days: number, withinSession = false) {
  if (!t.journal?.services) return undefined;
  const s = readServices(t.journal.services),
    f = t.journal.finance ?? { day: 0, minuteOfDay: 0 },
    notices: ReturnType<typeof previewDays> = [];
  // Only orders still in progress: the forge's quote stays unchanged when there are none.
  if (!s.orders.some((o) => o.status === "active" || o.status === "paused")) return undefined;
  if (!withinSession)
    notices.push(
      ...previewDays(
        s.orders.filter((o) => o.terms.workDays > 0),
        days,
        f,
        {
          workDays: (o) => o.terms.workDays,
          name: (o) =>
            `${o.terms.specialty ?? "Workshop"} · ${o.terms.offer.output.kind === "holding" ? o.terms.offer.output.name : o.terms.offer.name}${o.terms.units > 1 ? ` ×${o.terms.units}` : ""}`,
          readyMessage: "Finished; collect it where it was ordered.",
        },
      ),
    );
  return { before: canonicalJson(t.journal.services), state: s, notices };
}
