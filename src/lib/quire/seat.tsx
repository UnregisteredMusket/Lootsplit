import { useSyncExternalStore } from "react";
import { DM_SEAT, getSeat, subscribeSeat, type Seat } from "./table.ts";

function clientKnown(): boolean {
  return true;
}

function serverKnown(): boolean {
  return false;
}

export function useSeatKnown(): boolean {
  return useSyncExternalStore(subscribeSeat, clientKnown, serverKnown);
}

function serverSeat(): Seat {
  return DM_SEAT;
}

export function useSeat(): Seat {
  const known = useSeatKnown();
  const seat = useSyncExternalStore(subscribeSeat, getSeat, serverSeat);
  if (!known) return { ...seat, role: "player" };
  return seat;
}

