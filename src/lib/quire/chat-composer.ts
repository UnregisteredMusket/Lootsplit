import type { Command } from "./commands.ts";

export type ChatMessage = Extract<Command, { kind: "message" }>;
export type OutgoingMessage = { command: ChatMessage; thread: string; at: number; error?: string };
export type ChatScope = { accountId: string; code: string; seatId: string; sessionId: string };
type Composer = { drafts: Record<string, string>; outbox: OutgoingMessage[] };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

// This map lasts only for the running document. Guests must never write campaign
// content to device storage, but navigating to another app view must not lose it.
const composers = new Map<string, Composer>();
const durable = new Set<string>();
const storageErrors = new Map<string, string>();
const listeners = new Set<() => void>();
let revision = 0;
let warningInstalled = false;
function warnUnsent(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}
function changed() {
  const unsent = [...composers].some(
    ([key, composer]) =>
      Object.values(composer.drafts).some(Boolean) ||
      (composer.outbox.length > 0 && !durable.has(key)),
  );
  if (typeof window !== "undefined" && unsent !== warningInstalled) {
    if (unsent) window.addEventListener("beforeunload", warnUnsent);
    else window.removeEventListener("beforeunload", warnUnsent);
    warningInstalled = unsent;
  }
  revision++;
  for (const listener of listeners) listener();
}
export function subscribeChatComposers(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function getChatComposerRevision() {
  return revision;
}
export function serverChatComposerRevision() {
  return 0;
}
export function chatScopeKey(scope: ChatScope) {
  return JSON.stringify([scope.accountId, scope.code, scope.seatId, scope.sessionId]);
}
export function chatComposer(scope: ChatScope): Composer {
  const key = chatScopeKey(scope);
  let composer = composers.get(key);
  if (!composer) {
    composer = { drafts: {}, outbox: [] };
    composers.set(key, composer);
  }
  return composer;
}
export function setChatDraft(scope: ChatScope, thread: string, text: string) {
  const composer = chatComposer(scope);
  composer.drafts = { ...composer.drafts, [thread]: text };
  changed();
  return composer.drafts;
}
export function chatOutboxKey(scope: ChatScope) {
  if (!scope.accountId) throw Error("Guests keep messages in memory only.");
  return `lootsplit.chat.outbox.v2.${encodeURIComponent(chatScopeKey(scope))}`;
}
function outgoing(value: unknown): OutgoingMessage[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (m) =>
        !(
          m?.command?.kind === "message" &&
          typeof m.command.id === "string" &&
          typeof m.command.text === "string" &&
          typeof m.thread === "string" &&
          Number.isFinite(m.at)
        ),
    )
  )
    throw Error("This saved message copy could not be read.");
  return value
    .filter(
      (m): m is OutgoingMessage =>
        m?.command?.kind === "message" &&
        typeof m.command.id === "string" &&
        typeof m.command.text === "string" &&
        typeof m.thread === "string" &&
        Number.isFinite(m.at),
    )
    .map((m) => ({ ...m, error: "Not confirmed. Retry to check delivery." }));
}
/** Call with storage only after a matching authenticated membership was checked. */
export function restoreChatOutbox(scope: ChatScope, storage?: Storage) {
  const composer = chatComposer(scope);
  if (scope.accountId && storage) {
    const saved = outgoing(JSON.parse(storage.getItem(chatOutboxKey(scope)) || "[]"));
    composer.outbox = [
      ...composer.outbox,
      ...saved.filter((m) => !composer.outbox.some((old) => old.command.id === m.command.id)),
    ];
    // An in-flight message created before verification is still memory only.
    if (composer.outbox.every((m) => saved.some((old) => old.command.id === m.command.id)))
      durable.add(chatScopeKey(scope));
    changed();
  }
  return composer.outbox;
}
/** Discover only the authenticated owner's v2 copies, including closed rooms.
 * These are export-only recovery until their original scope is active again. */
export function restoreAccountChatOutboxes(
  accountId: string,
  storage: Storage & Pick<globalThis.Storage, "length" | "key">,
) {
  let restored = 0,
    unreadable = 0;
  if (!accountId) return { restored, unreadable };
  const prefix = "lootsplit.chat.outbox.v2.";
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    try {
      const identity = JSON.parse(decodeURIComponent(key.slice(prefix.length)));
      if (
        !Array.isArray(identity) ||
        identity.length !== 4 ||
        identity[0] !== accountId ||
        !identity.every((field) => typeof field === "string")
      )
        continue;
      const [owner, code, seatId, sessionId] = identity;
      restoreChatOutbox({ accountId: owner, code, seatId, sessionId }, storage);
      restored++;
    } catch {
      unreadable++;
    }
  }
  return { restored, unreadable };
}
export function updateChatOutbox(scope: ChatScope, next: OutgoingMessage[], storage?: Storage) {
  const key = chatScopeKey(scope);
  // Memory is authoritative for recovery even when device storage is full or
  // unavailable. Persisting must never discard a newly created retry ID.
  chatComposer(scope).outbox = next;
  durable.delete(key);
  if (scope.accountId && storage) {
    try {
      storage.setItem(chatOutboxKey(scope), JSON.stringify(next));
      durable.add(key);
      storageErrors.delete(key);
    } catch {
      storageErrors.set(
        key,
        "Could not save message recovery on this device. It stays in this tab; export before closing or reloading.",
      );
    }
  }
  changed();
  return next;
}
export function chatStorageError(scope: ChatScope) {
  return storageErrors.get(chatScopeKey(scope)) || "";
}
/** Recovery never includes bearer credentials and never automatically replays. */
export function chatRecoveries(accountId: string, active?: ChatScope) {
  const activeKey = active && chatScopeKey(active);
  return [...composers].flatMap(([key, composer]) => {
    const [owner, code, seatId, sessionId] = JSON.parse(key) as string[];
    if (
      owner !== accountId ||
      key === activeKey ||
      (!composer.outbox.length && !Object.values(composer.drafts).some(Boolean))
    )
      return [];
    return [
      {
        scope: { accountId: owner, code, seatId, sessionId },
        pending: composer.outbox.length,
        drafts: Object.values(composer.drafts).filter(Boolean).length,
      },
    ];
  });
}
export function exportChatRecovery(scope: ChatScope) {
  const composer = chatComposer(scope);
  return {
    version: 1,
    code: scope.code,
    seatId: scope.seatId,
    sessionId: scope.sessionId,
    drafts: { ...composer.drafts },
    commands: composer.outbox.map((m) => ({ ...m.command })),
    exportedAt: Date.now(),
  };
}
export function discardChatRecovery(scope: ChatScope, storage?: Storage) {
  // Only an explicit discard removes the exact account-owned v2 copy. Old
  // unscoped recovery keys and other accounts/rooms/sessions remain untouched.
  if (scope.accountId && storage) storage.removeItem(chatOutboxKey(scope));
  composers.delete(chatScopeKey(scope));
  durable.delete(chatScopeKey(scope));
  storageErrors.delete(chatScopeKey(scope));
  changed();
}
/** Old keys have no account/session identity. Preserve them for explicit recovery,
 * never replay their commands automatically into the current session. */
export function legacyChatOutbox(scope: ChatScope, storage?: Storage) {
  if (!scope.accountId || !storage) return [];
  return outgoing(
    JSON.parse(storage.getItem(`lootsplit.chat.outbox.${scope.code}.${scope.seatId}`) || "[]"),
  );
}
