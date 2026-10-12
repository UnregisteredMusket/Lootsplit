import type { Holding } from "./types.ts";
export function assertCarried(h: Holding) {
  if (h.custody || h.reservedFor)
    throw Error(
      "Retrieve this item from its property first. Goods in storage, delivery or reserved for work cannot be equipped, consumed, sold or given remotely.",
    );
}
