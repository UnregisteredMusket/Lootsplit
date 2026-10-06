import { z } from "zod";
import type { Shop, StockLine } from "./types.ts";
export const shopScheduleSchema = z.object({
  cycleDays: z.number().int().min(1).max(30),
  openDays: z.array(z.number().int().min(0).max(29)).max(30),
  restockEveryDays: z.number().int().min(0).max(3650),
  restockQuantity: z.number().int().min(1).max(100000),
  lastRestockDay: z.number().int().min(0).max(1e9),
}).refine((s) => new Set(s.openDays).size === s.openDays.length && s.openDays.every((d) => d < s.cycleDays), "Choose distinct opening days within the cycle.");
export type ShopSchedule = z.infer<typeof shopScheduleSchema>;
export function scheduledMarket(shops: Shop[], stock: StockLine[], day: number) {
  return shops.filter((s) => s.schedule).map((shop) => {
    const schedule = shopScheduleSchema.parse(shop.schedule);
    if (schedule.lastRestockDay > day) throw Error("Shop schedule starts after the campaign day.");
    const periods = schedule.restockEveryDays ? Math.floor((day - schedule.lastRestockDay) / schedule.restockEveryDays) : 0;
    return {
      shopId: shop.id,
      before: JSON.stringify({ closed: shop.closed, schedule }),
      closed: !schedule.openDays.includes(day % schedule.cycleDays),
      lastRestockDay: schedule.lastRestockDay + periods * schedule.restockEveryDays,
      stock: periods ? stock.filter((s) => s.shopId === shop.id && s.quantity !== null).map((s) => ({ id: s.id, before: s.quantity!, after: Math.max(s.quantity!, schedule.restockQuantity) })) : [],
    };
  }).sort((a,b) => a.shopId.localeCompare(b.shopId));
}
