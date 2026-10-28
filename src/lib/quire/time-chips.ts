/**
 * Session Time quick chips (design Q6): they fill the existing "Hours to advance" form (and, for
 * Long rest, the rest choice); the DM still reviews the preview and approves the same
 * `session-time` command. Nothing advances on a tap.
 */
export type TimeChip = { label: string; hours: number; rest?: "long" };

/** The morning hour "Next morning" lands on. */
export const MORNING_MINUTE = 6 * 60;

/** Whole hours from `minuteOfDay` to the next 06:00 (today if before it), between 1 and 24. */
export function hoursToNextMorning(minuteOfDay: number): number {
  const minute = Math.min(1439, Math.max(0, Math.floor(minuteOfDay)));
  const target = minute < MORNING_MINUTE ? MORNING_MINUTE : 1440 + MORNING_MINUTE;
  return Math.min(24, Math.max(1, Math.ceil((target - minute) / 60)));
}

export function timeChips(minuteOfDay: number): TimeChip[] {
  return [
    { label: "+1 h", hours: 1 },
    { label: "+4 h", hours: 4 },
    { label: "Long rest · 8 h", hours: 8, rest: "long" },
    { label: "Next morning", hours: hoursToNextMorning(minuteOfDay) },
  ];
}
