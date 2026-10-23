import type { CloudTable } from "./cloud.ts";
import { readBlacksmith } from "./blacksmith-schema.ts";
import { canonicalJson } from "./canonical-json.ts";
import { previewDays } from "./service-core.ts";
/** Pure extension of the single approved downtime quote; session hours never perform smith work. */
export function previewSmith(t: Pick<CloudTable, "journal">, days: number, withinSession = false) {
  if (!t.journal?.blacksmith) return undefined;
  const s = readBlacksmith(t.journal.blacksmith),
    f = t.journal.finance ?? { day: 0, minuteOfDay: 0 },
    notices: ReturnType<typeof previewDays> = [];
  if (!withinSession)
    notices.push(
      ...previewDays(s.orders, days, f, {
        workDays: (o) => o.terms.workDays,
        name: (o) => o.terms.design.name,
        readyMessage: "Completed; collect at the original forge.",
      }),
    );
  return { before: canonicalJson(t.journal.blacksmith), state: s, notices };
}
