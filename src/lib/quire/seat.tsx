import { useEffect, useState, useSyncExternalStore } from "react";
import { DM_SEAT, getSeat, subscribeSeat, type Seat } from "./table.ts";

export function useSeatKnown(): boolean {
  const [known, setKnown] = useState(false);
  useEffect(() => {
    setKnown(true);
  }, []);
  return known;
}

function serverSeat(): Seat {
  return DM_SEAT;
}

export function useSeat(): Seat {
  const known = useSeatKnown();
  const seat = useSyncExternalStore(subscribeSeat, getSeat, serverSeat);
  if (!known) return DM_SEAT;
  return seat;
}