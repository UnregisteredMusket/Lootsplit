import type { CloudTable } from "./cloud.ts";
import { readBlacksmith } from "./blacksmith-schema.ts";
import { canonicalJson } from "./canonical-json.ts";
/** Pure extension of the single approved downtime quote; session hours never perform smith work. */
export function previewSmith(t: Pick<CloudTable, "journal">, days: number, withinSession = false) {
  if (!t.journal?.blacksmith) return undefined;
  const s = readBlacksmith(t.journal.blacksmith),
    f = t.journal.finance ?? { day: 0, minuteOfDay: 0 },
    notices = [];
  if (!withinSession)
    for (const o of s.orders.filter((o) => o.status === "active")) {
      const worked = Math.min(days, o.terms.workDays - o.progressDays);
      o.progressDays += worked;
      if (o.progressDays === o.terms.workDays) {
        o.status = "ready";
        o.completedDay = f.day + worked;
        o.completedMinute = f.minuteOfDay ?? 0;
        o.message = "Completed; collect at the original forge.";
      }
      notices.push({
        orderId: o.id,
        purseId: o.purseId,
        summary: `${o.terms.design.name}: ${o.progressDays}/${o.terms.workDays} days; ${o.status}${o.completedDay === undefined ? "" : `; completed ${`campaign day ${o.completedDay}`}`}.`,
      });
    }
  return { before: canonicalJson(t.journal.blacksmith), state: s, notices };
}
