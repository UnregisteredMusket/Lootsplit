import assert from "node:assert/strict";
import test from "node:test";
import {
  byRecent,
  lastOpenedLabel,
  noteCampaignOpened,
  readCampaignRecents,
  RECENTS_ITEM,
  titlePrompt,
} from "./campaign-recents.ts";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

test("The title prompt names the last opened campaign and its session", () => {
  const store = memory();
  assert.equal(titlePrompt(readCampaignRecents(store)), null);
  noteCampaignOpened("a", { name: "The Wayfarers", session: 12 }, 1000, store);
  assert.equal(titlePrompt(readCampaignRecents(store)), "Continue · The Wayfarers · Session 12");
  noteCampaignOpened("b", { name: "Saltmarsh" }, 2000, store);
  assert.equal(titlePrompt(readCampaignRecents(store)), "Continue · Saltmarsh");
  // Reopening keeps the known session number when this open does not know it yet.
  noteCampaignOpened("a", { name: "The Wayfarers" }, 3000, store);
  assert.equal(titlePrompt(readCampaignRecents(store)), "Continue · The Wayfarers · Session 12");
});

test("Moving between screens does not rewrite the record; a change or an hour later does", () => {
  const store = memory();
  let writes = 0;
  const counted = { getItem: store.getItem, setItem: (k: string, v: string) => (writes++, store.setItem(k, v)) };
  noteCampaignOpened("a", { name: "A", session: 2 }, 1000, counted);
  noteCampaignOpened("a", { name: "A", session: 2 }, 5000, counted);
  noteCampaignOpened("a", { name: "A" }, 6000, counted);
  assert.equal(writes, 1);
  noteCampaignOpened("a", { name: "A", session: 3 }, 7000, counted);
  assert.equal(writes, 2);
  noteCampaignOpened("a", { name: "A", session: 3 }, 7000 + 60 * 60 * 1000, counted);
  assert.equal(writes, 3);
  noteCampaignOpened("b", { name: "B" }, 8000 + 60 * 60 * 1000, counted);
  assert.equal(writes, 4);
});

test("Recents sort newest first and keep never-opened campaigns in their order", () => {
  const store = memory();
  noteCampaignOpened("b", { name: "B" }, 1000, store);
  noteCampaignOpened("c", { name: "C" }, 2000, store);
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(byRecent(list, readCampaignRecents(store)).map((c) => c.id), ["c", "b", "a", "d"]);
});

test("Broken or blocked storage reads as empty and never throws", () => {
  const broken = { getItem: () => "{nope", setItem: () => undefined };
  assert.deepEqual(readCampaignRecents(broken), { campaigns: {} });
  const blocked = {
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
  };
  assert.doesNotThrow(() => noteCampaignOpened("a", { name: "A" }, 1, blocked));
  const odd = memory();
  odd.setItem(RECENTS_ITEM, JSON.stringify({ last: 5, campaigns: { a: { name: 1 }, b: { name: "B", openedAt: 2, session: -1 } } }));
  assert.deepEqual(readCampaignRecents(odd), { last: undefined, campaigns: { b: { name: "B", openedAt: 2 } } });
});

test("Last-opened labels count calendar days", () => {
  const now = new Date(2026, 9, 26, 9).getTime();
  assert.equal(lastOpenedLabel(undefined, now), null);
  assert.equal(lastOpenedLabel(new Date(2026, 9, 26, 1).getTime(), now), "Opened today");
  assert.equal(lastOpenedLabel(new Date(2026, 9, 25, 23).getTime(), now), "Opened yesterday");
  assert.equal(lastOpenedLabel(new Date(2026, 9, 22).getTime(), now), "Opened 4 days ago");
  assert.match(lastOpenedLabel(new Date(2026, 5, 1).getTime(), now)!, /^Opened .*2026/);
});
