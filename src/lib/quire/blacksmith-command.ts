import type { CloudTable, CloudSeat } from "./cloud.ts";
import { canonicalJson } from "./canonical-json.ts";
import { readBlacksmith, type SmithCommand, type SmithOrder } from "./blacksmith-schema.ts";
import { readEstate } from "./estate-schema.ts";
import { financeMove, readFinance } from "./finance.ts";
import { toCopper } from "./money.ts";
import { smithQuote, smithHere, smithDescription } from "./blacksmith.ts";
import { validateBlacksmith } from "./blacksmith-validation.ts";
import { controlOrder, downtimePending } from "./service-core.ts";
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const open = (o: SmithOrder) => ["active", "paused", "ready"].includes(o.status);
export function applySmithCommand(t: CloudTable, seat: CloudSeat, cmd: SmithCommand, at: number) {
  const s = readBlacksmith(t.journal?.blacksmith),
    f = readFinance(t.journal?.finance);
  if (downtimePending(t))
    throw Error("Approve or cancel pending downtime before changing smith services or orders.");
  const dm = () => {
    if (seat.role !== "dm")
      throw Error("Only the DM can configure a blacksmith or control its orders.");
  };
  const own = (id: string) => {
    if (seat.role !== "dm" && !seat.purseIds.includes(id))
      throw Error("You can only commission or collect for your assigned account.");
  };
  if (cmd.kind === "smith-profile") {
    dm();
    const prior = s.profiles.find((p) => p.shopId === cmd.shopId) ?? null;
    if (!same(prior, cmd.before))
      throw Error("Smith configuration changed. Review the current settings.");
    if (cmd.profile && cmd.profile.shopId !== cmd.shopId)
      throw Error("The profile must belong to this shop.");
    if (!cmd.profile && s.orders.some((o) => o.terms.shopId === cmd.shopId && open(o)))
      throw Error("Resolve outstanding commissions before removing this forge's configuration.");
    s.profiles = s.profiles.filter((p) => p.shopId !== cmd.shopId);
    if (cmd.profile) {
      s.profiles.push(cmd.profile);
      const estate = readEstate(t.journal?.propertyOperations);
      for (const m of cmd.profile.materials) {
        const existing = estate.materials.find((e) => e.key === m.materialKey);
        if (existing && (existing.name !== m.name || existing.unit !== m.unit))
          throw Error(
            "Existing material keys must retain their canonical name and unit. Use another key for a new material.",
          );
        if (!existing) estate.materials.push({ key: m.materialKey, name: m.name, unit: m.unit });
      }
      t.journal!.propertyOperations = estate;
    }
  } else if (cmd.kind === "smith-order") {
    own(cmd.purseId);
    const q = smithQuote(t, cmd.shopId, cmd.purseId, cmd.design);
    if (q.before !== cmd.before)
      throw Error(
        "The commission quote changed. Review the new price, materials and work days before ordering.",
      );
    if (s.orders.some((o) => o.id === cmd.id))
      throw Error("This commission has already been recorded.");
    const payer = t.purses.find((p) => p.id === cmd.purseId)!;
    if (toCopper(payer.coins) < q.terms.costCopper)
      throw Error("Insufficient funds for this commission.");
    financeMove(
      t,
      cmd.purseId,
      -q.terms.costCopper,
      cmd.id + "-payment",
      `Commission ${cmd.design.name} from ${q.terms.makerName}`,
      at,
    );
    if (q.terms.costCopper) t.ledger.at(-1)!.shopId = cmd.shopId;
    const profile = s.profiles.find((p) => p.shopId === cmd.shopId)!;
    for (const m of q.terms.materials) {
      if (m.holdingId) t.holdings.find((h) => h.id === m.holdingId)!.quantity -= m.quantity;
      else {
        const offer = profile.materials.find((o) => o.materialKey === m.materialKey)!;
        if (offer.quantity !== null) offer.quantity -= m.quantity;
      }
    }
    s.orders.push({
      id: cmd.id,
      purseId: cmd.purseId,
      terms: q.terms,
      orderedDay: f.day,
      orderedMinute: f.minuteOfDay ?? 0,
      progressDays: 0,
      status: "active",
      message: "Paid and materials committed. Waiting for DM-approved downtime.",
    });
  } else {
    const order = s.orders.find((o) => o.id === cmd.orderId);
    if (!order || !same(order, cmd.before))
      throw Error("The commission changed. Refresh before acting.");
    if (cmd.kind === "smith-claim") {
      own(order.purseId);
      if (order.status !== "ready")
        throw Error("This commission is not ready for collection or has already been collected.");
      if (!smithHere(t, order.terms.locationId, order.purseId))
        throw Error("Visit the original forge to collect the completed item.");
      t.holdings.push({
        id: order.id + "-crafted",
        purseId: order.purseId,
        kind: "item",
        quantity: 1,
        name: order.terms.design.name,
        unitCopper: order.terms.valueCopper,
        weight: order.terms.weight,
        category: "smith",
        notes: smithDescription(order),
      });
      order.status = "claimed";
      order.claimedDay = f.day;
      order.message = "Collected into inventory.";
    } else {
      dm();
      controlOrder(order, cmd.action, cmd.reason, (o) => open(o as SmithOrder));
    }
  }
  t.journal!.blacksmith = s;
  validateBlacksmith(t);
  t.journal!.events.push({
    id: cmd.id + "-smith-event",
    at,
    kind: "management",
    summary: `Blacksmith service: ${cmd.kind.replace("smith-", "")}.`,
    ...(cmd.kind === "smith-profile"
      ? { dmOnly: true }
      : {
          purseId:
            cmd.kind === "smith-order"
              ? cmd.purseId
              : s.orders.find((o) => o.id === cmd.orderId)!.purseId,
        }),
  });
}
