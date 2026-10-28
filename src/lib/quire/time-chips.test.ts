import assert from "node:assert/strict";
import test from "node:test";
import { hoursToNextMorning, timeChips } from "./time-chips.ts";

test("Next morning advances to the next 06:00 in whole hours, within the 1–24 h limit", () => {
  assert.equal(hoursToNextMorning(0), 6); // midnight → 06:00 today
  assert.equal(hoursToNextMorning(5 * 60 + 30), 1); // 05:30 → 06:30 (whole hours, at least 1)
  assert.equal(hoursToNextMorning(6 * 60), 24); // 06:00 → 06:00 tomorrow
  assert.equal(hoursToNextMorning(20 * 60), 10); // 20:00 → 06:00
  assert.equal(hoursToNextMorning(23 * 60 + 59), 7);
  for (let m = 0; m < 1440; m += 7) {
    const h = hoursToNextMorning(m);
    assert.ok(Number.isInteger(h) && h >= 1 && h <= 24, `${m}: ${h}`);
  }
});

test("Quick chips: +1 h, +4 h, Long rest 8 h with a long rest, Next morning", () => {
  assert.deepEqual(timeChips(20 * 60), [
    { label: "+1 h", hours: 1 },
    { label: "+4 h", hours: 4 },
    { label: "Long rest · 8 h", hours: 8, rest: "long" },
    { label: "Next morning", hours: 10 },
  ]);
});
