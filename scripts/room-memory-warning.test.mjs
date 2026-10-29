// The total-size warning threshold (ROOM_TOTAL_LIMIT; a notice, never a refusal) documents the
// measured safe size of whole-campaign operations: a campaign at the threshold, in the two shapes
// that cost most, is read whole (as Download a copy, deletion copies and account records read it)
// and has a line undone (a command that reads every archived session), each twice at once, inside
// a 128 MB heap (scripts/room-memory-measure.mjs; a Worker isolate has 128 MB). Two at once is the
// margin: one such operation uses at most about half the isolate. If the threshold is raised past
// what fits, this fails: raise it only after streaming exports, delta session archives and an
// archived-ledger index make whole-campaign operations bounded. Disposable local database only.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { ROOM_TOTAL_LIMIT, ROOM_LIVE_LIMIT } = await import("../src/lib/quire/room-size.ts");
const script = fileURLToPath(new URL("./room-memory-measure.mjs", import.meta.url));
const run = (heap, ...args) =>
  spawnSync(process.execPath, [`--max-old-space-size=${heap}`, "--experimental-strip-types", "--no-warnings", script, ...args], {
    encoding: "utf8",
    maxBuffer: 1e8,
  });

// Two shapes at the threshold: the largest live campaign with a few archived sessions, and a small live
// campaign with many (archived sessions cost more memory per byte: they are projected one by one).
for (const [shape, live] of [["the largest live campaign", Math.round(ROOM_LIVE_LIMIT * 0.95)], ["a small live campaign", 1_000_000]])
  test(`${shape} at the total-size warning threshold: whole-campaign reads and Undo fit twice at once in 128 MB`, { timeout: 600_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "lootsplit-cap-"));
    try {
      const file = join(dir, "cap.sqlite");
      const probe = JSON.parse(run(1024, "setup", file, "--live", String(live), "--reports", "1").stdout);
      const reports = Math.floor((ROOM_TOTAL_LIMIT - probe.storedBytes) / probe.reportBytes);
      const sizes = JSON.parse(run(1024, "setup", file, "--live", String(live), "--reports", String(reports)).stdout);
      const total = sizes.storedBytes + sizes.reportBytes;
      assert.ok(total <= ROOM_TOTAL_LIMIT && total >= ROOM_TOTAL_LIMIT - probe.reportBytes, `fixture at the threshold (${total} bytes)`);
      for (const op of ["whole", "undo"]) {
        const copy = join(dir, `${op}.sqlite`);
        copyFileSync(file, copy);
        copyFileSync(file + ".json", copy + ".json");
        const result = run(128, "read", copy, "--protocol", "12", "--op", op, "--concurrency", "2");
        assert.equal(result.status, 0, `${op} at ${(total / 1e6).toFixed(2)} MB ran out of memory: ${result.stderr.slice(-300)}`);
        const output = JSON.parse(result.stdout.trim().split("\n").at(-1));
        assert.equal(output.ok, true);
        if (op === "undo") assert.ok(!JSON.stringify(output).includes("error"), "the Undo was applied");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
