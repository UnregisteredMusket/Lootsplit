import test from "node:test";
import assert from "node:assert/strict";
import {
  chatComposer,
  chatOutboxKey,
  legacyChatOutbox,
  restoreChatOutbox,
  setChatDraft,
  updateChatOutbox,
  chatRecoveries,
  exportChatRecovery,
  discardChatRecovery,
  chatStorageError,
  restoreAccountChatOutboxes,
  type ChatScope,
  type OutgoingMessage,
} from "./chat-composer.ts";

const scope = (accountId = ""): ChatScope => ({
  accountId,
  code: crypto.randomUUID(),
  seatId: "seat",
  sessionId: "session",
});
const message = (): OutgoingMessage => ({
  command: {
    kind: "message",
    id: crypto.randomUUID(),
    to: "party",
    purseId: "hero",
    text: "Private unsent content",
  },
  thread: "party",
  at: Date.now(),
});
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
  };
}

test("guest drafts and failed messages survive view remount without touching persistent storage", () => {
  const guest = scope(),
    item = message();
  const forbidden = {
    getItem: () => {
      throw Error("Guest storage read");
    },
    setItem: () => {
      throw Error("Guest storage write");
    },
    removeItem: () => {
      throw Error("Guest storage removal");
    },
  };
  setChatDraft(guest, "party", "A draft between views");
  setChatDraft(guest, "dm", "A different private conversation");
  updateChatOutbox(guest, [item], forbidden);
  assert.deepEqual(restoreChatOutbox({ ...guest }, forbidden), [item]);
  assert.deepEqual(chatComposer({ ...guest }).drafts, {
    party: "A draft between views",
    dm: "A different private conversation",
  });
  assert.deepEqual(legacyChatOutbox(guest, forbidden), []);
  assert.throws(() => chatOutboxKey(guest), /memory only/);
});

test("drafts and pending commands cannot move between accounts, rooms, seats or sessions", () => {
  const original = scope("account-a");
  setChatDraft(original, "party", "Only for this seat");
  updateChatOutbox(original, [message()]);
  for (const different of [
    { ...original, accountId: "account-b" },
    { ...original, accountId: "" },
    { ...original, code: "other-room" },
    { ...original, seatId: "other-seat" },
    { ...original, sessionId: "other-session" },
  ])
    assert.deepEqual(chatComposer(different), { drafts: {}, outbox: [] });
});

test("verified account recovery keeps stable IDs and merges an interrupted in-memory send once", () => {
  const owner = scope("account-a"),
    device = storage(),
    saved = message(),
    pending = message();
  device.setItem(chatOutboxKey(owner), JSON.stringify([saved]));
  updateChatOutbox(owner, [pending]);
  const restored = restoreChatOutbox(owner, device);
  assert.deepEqual(
    restored.map((m) => m.command.id),
    [pending.command.id, saved.command.id],
  );
  assert.equal(restoreChatOutbox(owner, device).length, 2);
  updateChatOutbox(
    owner,
    restored.filter((m) => m.command.id !== saved.command.id),
    device,
  );
  assert.deepEqual(
    JSON.parse(device.getItem(chatOutboxKey(owner))!).map((m: OutgoingMessage) => m.command.id),
    [pending.command.id],
  );
  assert.equal(device.getItem(chatOutboxKey({ ...owner, accountId: "account-b" })), null);
});

test("legacy outbox is preserved as explicit recovery and never restored into a new session", () => {
  const owner = scope("account-a"),
    device = storage(),
    old = message();
  const key = `lootsplit.chat.outbox.${owner.code}.${owner.seatId}`;
  const original = JSON.stringify([old]);
  device.setItem(key, original);
  assert.deepEqual(restoreChatOutbox(owner, device), []);
  assert.equal(legacyChatOutbox(owner, device)[0].command.id, old.command.id);
  updateChatOutbox(owner, [message()], device);
  assert.equal(device.getItem(key), original);
});

test("revoked chat remains exportable in its original scope without credentials or automatic replay", () => {
  const guest = scope(),
    item = message();
  setChatDraft(guest, "dm", "An unsent private draft");
  updateChatOutbox(guest, [item]);
  assert.equal(
    chatRecoveries("", guest).some((r) => r.scope.code === guest.code),
    false,
  );
  const recovery = chatRecoveries("").find((r) => r.scope.code === guest.code)!;
  assert.equal(recovery.pending, 1);
  assert.equal(recovery.drafts, 1);
  const file = exportChatRecovery(guest);
  assert.equal(file.commands[0].id, item.command.id);
  assert.equal(file.drafts.dm, "An unsent private draft");
  assert.equal("token" in file, false);
  assert.equal(
    chatRecoveries("other-account").some((r) => r.scope.code === guest.code),
    false,
  );
  discardChatRecovery(guest);
  assert.equal(
    chatRecoveries("").some((r) => r.scope.code === guest.code),
    false,
  );
});

test("full device storage keeps the exact message and draft in memory with an explicit recovery notice", () => {
  const owner = scope("account-a"),
    item = message();
  const full = {
    getItem: () => null,
    setItem: () => {
      throw new DOMException("Full", "QuotaExceededError");
    },
    removeItem: () => {},
  };
  setChatDraft(owner, "dm", "Keep this original draft");
  assert.deepEqual(updateChatOutbox(owner, [item], full), [item]);
  assert.match(chatStorageError(owner), /stays in this tab/);
  const file = exportChatRecovery(owner);
  assert.equal(file.commands[0].id, item.command.id);
  assert.equal(file.drafts.dm, "Keep this original draft");
  updateChatOutbox(owner, [item], storage());
  assert.equal(chatStorageError(owner), "");
});

test("explicit account discard removes only its scoped persistent copy", () => {
  const owner = scope("account-a"),
    other = { ...owner, accountId: "account-b" },
    device = storage();
  updateChatOutbox(owner, [message()], device);
  updateChatOutbox(other, [message()], device);
  const legacyKey = `lootsplit.chat.outbox.${owner.code}.${owner.seatId}`;
  device.setItem(legacyKey, "legacy untouched");
  discardChatRecovery(owner, device);
  assert.equal(device.getItem(chatOutboxKey(owner)), null);
  assert.ok(device.getItem(chatOutboxKey(other)));
  assert.equal(device.getItem(legacyKey), "legacy untouched");
  assert.deepEqual(restoreChatOutbox(owner, device), []);
});

test("verified account discovery recovers unavailable old sessions without reading another account's content", () => {
  const prior = scope("account-a"),
    other = { ...prior, accountId: "account-b" },
    device = storage(),
    item = message();
  device.setItem(chatOutboxKey(prior), JSON.stringify([item]));
  device.setItem(chatOutboxKey(other), "private other-account data");
  const guarded = {
    ...device,
    getItem: (key: string) => {
      assert.notEqual(key, chatOutboxKey(other));
      return device.getItem(key);
    },
  };
  const result = restoreAccountChatOutboxes("account-a", guarded);
  assert.equal(result.restored, 1);
  assert.equal(result.unreadable, 0);
  assert.equal(chatRecoveries("account-a").find((r) => r.scope.code === prior.code)!.pending, 1);
  assert.equal(exportChatRecovery(prior).commands[0].id, item.command.id);
  assert.equal(device.getItem(chatOutboxKey(other)), "private other-account data");
  discardChatRecovery(prior, device);
  restoreAccountChatOutboxes("account-a", device);
  assert.equal(
    chatRecoveries("account-a").some((r) => r.scope.code === prior.code),
    false,
  );
});

test("unreadable account outboxes remain untouched and are reported instead of partially imported", () => {
  const owner = scope("account-a"),
    device = storage(),
    raw = JSON.stringify([
      message(),
      { command: { kind: "message", text: "Keep this malformed original" } },
    ]);
  device.setItem(chatOutboxKey(owner), raw);
  assert.throws(() => restoreChatOutbox(owner, device), /could not be read/);
  assert.equal(restoreAccountChatOutboxes("account-a", device).unreadable, 1);
  assert.equal(device.getItem(chatOutboxKey(owner)), raw);
  assert.deepEqual(chatComposer(owner).outbox, []);
});
