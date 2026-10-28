import assert from "node:assert/strict";
import test from "node:test";
import { createSharedPoller, startVisiblePoll, type PollEnvironment } from "./visible-poll.ts";

const unexpected = (error: unknown) => assert.fail(String(error));
/** A manual clock and page visibility for the pollers. */
function fakeEnvironment() {
  let now = 0,
    hidden = false,
    seq = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const visible = new Set<() => void>();
  const env: PollEnvironment = {
    hidden: () => hidden,
    setTimeout: (run, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout: (id) => void timers.delete(id as number),
    onVisible: (run) => (visible.add(run), () => void visible.delete(run)),
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    env,
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        await settle();
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].run();
      }
      now = end;
      await settle();
    },
    async setHidden(value: boolean) {
      hidden = value;
      if (!value) for (const run of [...visible]) run();
      await settle();
    },
    pending: () => timers.size,
  };
}

test("the DM's display controller and Initiative panel share one encounter poll (audit 2026-10-28 F4)", async () => {
  const clock = fakeEnvironment();
  const requests: string[] = [];
  const poller = createSharedPoller(
    async (key) => (requests.push(key), { key, n: requests.length }),
    clock.env,
  );
  const display: number[] = [],
    panel: number[] = [];
  const stopDisplay = poller.subscribe("enc-1", {
    intervalMs: 2000,
    onResult: (r) => display.push(r.n),
    onError: unexpected,
  });
  await clock.advance(0);
  const stopPanel = poller.subscribe("enc-1", {
    intervalMs: 3000,
    onResult: (r) => panel.push(r.n),
    onError: unexpected,
  });
  assert.deepEqual(panel, [1], "the panel shows the shared latest result without a new request");
  await clock.advance(60_000);
  // One request every 2 s for both views together (old: 30 + 20 = 50 a minute).
  assert.ok(requests.length <= 31, `${requests.length} requests a minute`);
  assert.ok(requests.length >= 29, `${requests.length} requests a minute`);
  assert.deepEqual(display.slice(1), panel.slice(1), "both views get every result");
  stopDisplay();
  const before = requests.length;
  await clock.advance(30_000);
  assert.ok(requests.length - before <= 10, "the panel alone polls every 3 s");
  stopPanel();
  const after = requests.length;
  await clock.advance(30_000);
  assert.equal(requests.length, after, "no subscribers, no requests");
  assert.equal(clock.pending(), 0);
  assert.deepEqual(poller.keys(), []);
});

test("the shared encounter poll pauses in hidden tabs, catches up on return, and keeps a launched display updated", async () => {
  const clock = fakeEnvironment();
  let requests = 0;
  const poller = createSharedPoller(async () => ++requests, clock.env);
  const stop = poller.subscribe("enc", {
    intervalMs: 3000,
    onResult: () => undefined,
    onError: unexpected,
  });
  await clock.advance(0);
  assert.equal(requests, 1);
  await clock.setHidden(true);
  await clock.advance(60_000);
  assert.equal(requests, 1, "nothing while hidden");
  await clock.setHidden(false);
  assert.equal(requests, 2, "catches up as soon as the tab is visible");
  // A launched TV display (another tab hides this one) still wants updates.
  let launched = true;
  const stopDisplay = poller.subscribe("enc", {
    intervalMs: 2000,
    wanted: () => launched,
    onResult: () => undefined,
    onError: unexpected,
  });
  await clock.setHidden(true);
  const hiddenStart = requests;
  await clock.advance(10_000);
  assert.ok(requests - hiddenStart >= 4, "the launched display keeps polling while hidden");
  launched = false;
  const closed = requests;
  await clock.advance(10_000);
  assert.equal(requests, closed, "closing the display stops hidden polling");
  // A save refreshes everyone at once, visible or not.
  poller.refresh("enc");
  await clock.advance(0);
  assert.equal(requests, closed + 1);
  stopDisplay();
  stop();
});

test("errors reach every subscriber and polling continues", async () => {
  const clock = fakeEnvironment();
  let fail = true;
  const poller = createSharedPoller(async () => {
    if (fail) throw Error("offline");
    return "ok";
  }, clock.env);
  const errors: string[] = [],
    results: string[] = [];
  const stop = poller.subscribe("enc", {
    intervalMs: 2000,
    onResult: (r) => results.push(r),
    onError: (e) => errors.push((e as Error).message),
  });
  await clock.advance(0);
  fail = false;
  await clock.advance(2000);
  assert.deepEqual(errors, ["offline"]);
  assert.deepEqual(results, ["ok"]);
  stop();
});

test("combat views poll only while visible and never overlap (audit 2026-10-28 F8)", async () => {
  const clock = fakeEnvironment();
  let loads = 0,
    active = 0,
    overlap = false;
  const stop = startVisiblePoll(
    async () => {
      loads++;
      active++;
      overlap ||= active > 1;
      await new Promise((resolve) => setImmediate(resolve));
      active--;
    },
    3000,
    clock.env,
  );
  await clock.advance(0);
  assert.equal(loads, 1);
  await clock.advance(9000);
  assert.equal(loads, 4);
  await clock.setHidden(true);
  await clock.advance(60_000);
  assert.equal(loads, 4, "no requests in a hidden tab");
  await clock.setHidden(false);
  assert.equal(loads, 5, "catches up on return");
  await clock.setHidden(false);
  assert.equal(overlap, false);
  stop();
  await clock.advance(30_000);
  assert.ok(loads <= 6);
  assert.equal(clock.pending(), 0);
});
