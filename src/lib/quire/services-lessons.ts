import type { CloudTable } from "./cloud.ts";
import type { TrainingRequest } from "./downtime-activities-schema.ts";
import { financeMove, readFinance } from "./finance.ts";
import { formatCopper, toCopper } from "./money.ts";
import { readServices, type ServiceOrder } from "./services-schema.ts";
import { validateServices } from "./services-validation.ts";

// Paid lessons (docs/SERVICES.md, services wave 2): the money half of approving a lesson session.
// `downtime-training-review` has already rechecked the agreement, the hours and the fee.

/**
 * Charge one approved session once (`requestId-fee`, to the lesson payer, at the teacher's shop),
 * add it to the agreement's sessions and complete the agreement when its days are taken.
 */
export function chargeLesson(t: CloudTable, o: ServiceOrder, r: TrainingRequest, commandId: string, at: number) {
  const fee = r.feeCopper ?? 0;
  const payer = t.purses.find((p) => p.id === o.purseId);
  if (!payer) throw Error("The paying character no longer exists.");
  if (t.ledger.some((l) => l.id === r.id + "-fee")) throw Error("This session has already been charged.");
  if (toCopper(payer.coins) < fee) throw Error(`${payer.name} can't afford ${formatCopper(fee)} for this session.`);
  const l = o.terms.lessons!;
  if (fee) {
    financeMove(t, o.purseId, -fee, r.id + "-fee", `Lesson · ${l.topic} · ${o.terms.npcName}`, at);
    t.ledger.at(-1)!.shopId = o.terms.shopId;
  }
  const day = readFinance(t.journal?.finance).day;
  const services = readServices(t.journal?.services),
    stored = services.orders.find((x) => x.id === o.id)!;
  stored.sessions = [
    ...(stored.sessions ?? []),
    { requestId: r.id, minutes: r.minutes, trainingHoursPerDay: r.trainingHoursPerDay, feeCopper: fee, approvedAt: at, day },
  ];
  const taken = stored.sessions.reduce((n, x) => n + x.minutes / (x.trainingHoursPerDay * 60), 0);
  const shown = taken.toLocaleString("en", { maximumFractionDigits: 2 });
  if (taken >= l.maxDays - 1e-9) {
    stored.status = "completed";
    stored.completedDay = day;
    stored.completedMinute = readFinance(t.journal?.finance).minuteOfDay ?? 0;
    stored.message = `Lessons completed: ${shown} training days. Recorded only; the DM decides what was learned.`;
    if (stored.history.length < 50) stored.history.push({ at, status: "completed", note: stored.message });
  } else stored.message = `${shown}/${l.maxDays} training days taken. Each session is charged once, when the DM approves it.`;
  t.journal!.services = services;
  validateServices(t);
  t.journal!.events.push({
    id: `${commandId}-lesson-fee`,
    at,
    kind: "management",
    purseId: o.purseId,
    summary: `Lesson approved: ${l.topic} with ${o.terms.npcName} · ${formatCopper(fee)}.`.slice(0, 500),
  });
}
