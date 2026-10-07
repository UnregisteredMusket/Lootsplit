import { getServerCloudTable } from "@/lib/quire/cloud-client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MessageCircle, Send, RotateCcw, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button, Confirm, TextArea } from "./ui";
import { downloadJson } from "@/lib/quire/table";
import { getCloudTable, sendRoomMessage, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { getChatSnapshot, serverChat, subscribeChat } from "@/lib/quire/chat";
import { canReadNote, conversationFor, isOwnNote } from "@/lib/quire/chat-visibility";
import { useChatUnread } from "@/lib/quire/use-chat-unread";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { accountRequest, type AccountLibrary } from "@/lib/account/client";
import {
  chatComposer,
  chatScopeKey,
  legacyChatOutbox,
  restoreChatOutbox,
  setChatDraft,
  updateChatOutbox,
  chatRecoveries,
  discardChatRecovery,
  exportChatRecovery,
  getChatComposerRevision,
  serverChatComposerRevision,
  subscribeChatComposers,
  chatStorageError,
  restoreAccountChatOutboxes,
  type ChatMessage,
  type ChatScope,
  type OutgoingMessage,
} from "@/lib/quire/chat-composer";

export function ShareChat() {
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  useSyncExternalStore(subscribeChatComposers, getChatComposerRevision, serverChatComposerRevision);
  const [discard, setDiscard] = useState<ChatScope | null>(null);
  const [library, setLibrary] = useState<AccountLibrary | null>(null);
  const accountId =
    typeof sessionStorage === "undefined"
      ? ""
      : sessionStorage.getItem("lootsplit.verified-account") || "";
  const scope = useMemo<ChatScope>(
    () => ({ code: room.code, seatId: room.seatId, sessionId: room.sessionId, accountId }),
    [room.code, room.seatId, room.sessionId, accountId],
  );
  useEffect(() => {
    setLibrary(null);
    if (!accountId) return;
    let active = true;
    void accountRequest<AccountLibrary>("library")
      .then((next) => {
        if (!active || next.user.id !== accountId) return;
        const recovered = restoreAccountChatOutboxes(accountId, localStorage);
        setLibrary(next);
        if (recovered.unreadable)
          toast.error(
            "Some saved message copies could not be read. Their device files are preserved.",
          );
      })
      .catch(() => {
        if (active) toast.error("Could not check saved messages. New messages stay in this tab.");
      });
    return () => {
      active = false;
    };
  }, [accountId]);
  const recoveries = chatRecoveries(accountId, room.joined ? scope : undefined);
  return (
    <>
      {room.joined ? (
        <LiveChat key={chatScopeKey(scope)} scope={scope} library={library} />
      ) : (
        <p className="text-sm text-muted">
          Start or join a room to chat live. Offline message files are under Manual sharing & files.
        </p>
      )}
      {recoveries.map((recovery) => (
        <section
          key={chatScopeKey(recovery.scope)}
          className="mt-3"
          aria-label="Unsent chat recovery"
        >
          <p>
            Chat recovery for room {recovery.scope.code}: {recovery.pending} unconfirmed message
            {recovery.pending === 1 ? "" : "s"} and {recovery.drafts} draft
            {recovery.drafts === 1 ? "" : "s"} remain in this document. Export before closing or
            reloading.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                void downloadJson(
                  `lootsplit-chat-recovery-${recovery.scope.code}.json`,
                  exportChatRecovery(recovery.scope),
                ).catch(() =>
                  toast.error("Could not export chat recovery. It is still in this tab."),
                )
              }
            >
              Export chat recovery
            </Button>
            <Button variant="ghost" onClick={() => setDiscard(recovery.scope)}>
              Discard chat recovery
            </Button>
          </div>
        </section>
      ))}
      <Confirm
        open={discard !== null}
        onOpenChange={(open) => {
          if (!open) setDiscard(null);
        }}
        title="Discard unsent chat recovery?"
        body={
          discard?.accountId
            ? "Export first if you need to keep these unconfirmed messages and drafts. This removes this session’s recovery copy from the document and this device."
            : "Export first if you need to keep these unconfirmed messages and drafts. This removes only this document’s recovery copy."
        }
        confirmLabel="Discard"
        onConfirm={() => {
          try {
            if (discard) discardChatRecovery(discard, discard.accountId ? localStorage : undefined);
            setDiscard(null);
          } catch {
            toast.error("Could not remove this device’s recovery copy. It is still available.");
          }
        }}
      />
    </>
  );
}
function LiveChat({ scope, library }: { scope: ChatScope; library: AccountLibrary | null }) {
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const seat = useSeat();
  const { purses } = useEconomy();
  const notes = useSyncExternalStore(subscribeChat, getChatSnapshot, serverChat);
  const { unread, markRead } = useChatUnread();
  const [thread, setThread] = useState("party");
  const [drafts, setDrafts] = useState(() => chatComposer(scope).drafts);
  const [outbox, setOutbox] = useState(() => chatComposer(scope).outbox);
  const [legacy, setLegacy] = useState<OutgoingMessage[]>([]);
  const storage = useRef<globalThis.Storage | undefined>(undefined);
  const [sending, setSending] = useState<string[]>([]);
  const sendingRef = useRef(new Set<string>());
  const history = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      { threshold: 0.2 },
    );
    if (history.current) observer.observe(history.current);
    return () => observer.disconnect();
  }, []);
  const nearBottom = useRef(true);
  useEffect(() => {
    if (
      !library ||
      library.user.id !== scope.accountId ||
      !library.members.some(
        (m) =>
          m.code === scope.code && m.seat_id === scope.seatId && m.role === room.role && !m.closed,
      )
    )
      return;
    try {
      const restored = restoreChatOutbox(scope, localStorage);
      const recoveredLegacy = legacyChatOutbox(scope, localStorage);
      storage.current = localStorage;
      setOutbox(restored);
      setLegacy(recoveredLegacy);
    } catch {
      toast.error("Could not read unsent messages. Their device copies are preserved.");
    }
    return () => {
      storage.current = undefined;
    };
  }, [scope, room.role, library]);
  const characters = purses.filter((p) => p.kind === "character" && p.control !== "npc");
  const options = [
    { id: "party", name: "Party chat" },
    ...(seat.role === "player" ? [{ id: "dm", name: "Dungeon master" }] : []),
    ...characters
      .filter((p) => seat.role === "dm" || !seat.purseIds.includes(p.id))
      .map((p) => ({ id: p.id, name: p.name })),
  ];
  const active = options.find((o) => o.id === thread) ?? options[0]!;
  const visible = useMemo(
    () => notes.filter((n) => canReadNote(n, seat) && conversationFor(n, seat) === active.id),
    [notes, seat, active.id],
  );
  const pending = outbox.filter(
    (m) => m.thread === active.id && !notes.some((n) => n.id === m.command.id),
  );
  const text = drafts[active.id] ?? "";
  const sender = characters.find((p) => seat.purseIds.includes(p.id));
  const isSending = sending.length > 0;
  const viewOnly = room.viewOnly && seat.role === "player";
  const storageError = chatStorageError(scope);

  useEffect(() => {
    const mark = () => {
      if (nearBottom.current && inView) markRead(active.id, visible);
    };
    if (nearBottom.current && history.current)
      history.current.scrollTop = history.current.scrollHeight;
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [active.id, visible, outbox, markRead, inView]);
  // Drop confirmed outbox entries, including an acknowledgement found after a failed response.
  useEffect(() => {
    if (!outbox.some((m) => notes.some((n) => n.id === m.command.id))) return;
    const next = outbox.filter((m) => !notes.some((n) => n.id === m.command.id));
    setOutbox(next);
    try {
      updateChatOutbox(scope, next, storage.current);
    } catch {
      /* duplicate retries remain idempotent */
      updateChatOutbox(scope, next);
    }
  }, [notes, outbox, scope]);

  function persist(next: OutgoingMessage[]) {
    setOutbox(updateChatOutbox(scope, next, storage.current));
  }
  async function deliver(item: OutgoingMessage) {
    if (viewOnly || sendingRef.current.has(item.command.id)) return;
    sendingRef.current.add(item.command.id);
    setSending([...sendingRef.current]);
    try {
      await sendRoomMessage(item.command);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Connection failed. Retry when online.";
      const next = chatComposer(scope).outbox.map((m) =>
        m.command.id === item.command.id ? { ...m, error: message } : m,
      );
      try {
        persist(next);
      } catch {
        setOutbox(updateChatOutbox(scope, next));
      }
    } finally {
      sendingRef.current.delete(item.command.id);
      setSending([...sendingRef.current]);
    }
  }
  function send() {
    if (!text.trim() || isSending || viewOnly) return;
    if (seat.role === "player" && !sender) {
      toast.error("Your character is no longer assigned. Ask the host for help.");
      return;
    }
    const to =
      active.id === "party" ? "party" : active.id === "dm" || seat.role === "dm" ? "dm" : "player";
    const command: ChatMessage = {
      kind: "message",
      id: crypto.randomUUID(),
      to,
      purseId: seat.role === "dm" ? (to === "party" ? "" : active.id) : sender!.id,
      ...(to === "player" ? { recipientId: active.id } : {}),
      text: text.trim(),
    };
    const item: OutgoingMessage = { command, thread: active.id, at: Date.now() };
    try {
      persist([...chatComposer(scope).outbox, item]);
    } catch {
      toast.error("Could not save the message on this device. Your draft is still here.");
      return;
    }
    setDrafts(setChatDraft(scope, active.id, ""));
    nearBottom.current = true;
    void deliver(item);
  }
  return (
    <section className="live-chat" aria-label="Live party chat">
      <label className="chat-select">
        <span className="text-sm font-medium">Conversation</span>
        <select
          aria-label="Conversation"
          value={active.id}
          onChange={(e) => {
            nearBottom.current = true;
            setThread(e.target.value);
          }}
        >
          {options.map((o) => {
            const n = unread.filter((m) => conversationFor(m, seat) === o.id).length;
            return (
              <option key={o.id} value={o.id}>
                {o.name}
                {n ? ` (${n} unread)` : ""}
              </option>
            );
          })}
        </select>
      </label>
      <div className="chat-title">
        <span className="inline-flex items-center gap-2">
          {active.id === "party" ? <MessageCircle size={17} /> : <Lock size={15} />}
          <strong>{active.name}</strong>
        </span>
        <span className="text-xs text-muted">
          {active.id === "party" ? "Everyone in this room" : "Private conversation"}
        </span>
      </div>
      {storageError && (
        <p role="status" className="mt-2 text-sm text-muted">
          {storageError}
        </p>
      )}
      {outbox.length > 0 && (
        <Button
          type="button"
          variant="secondary"
          className="mt-2"
          onClick={() =>
            void downloadJson(
              `lootsplit-chat-recovery-${scope.code}.json`,
              exportChatRecovery(scope),
            ).catch(() => toast.error("Could not export unsent chat. It is still in this tab."))
          }
        >
          Export unsent chat
        </Button>
      )}
      <div
        className="chat-history"
        ref={history}
        onScroll={() => {
          const el = history.current;
          if (!el) return;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (nearBottom.current && inView) markRead(active.id, visible);
        }}
      >
        {!visible.length && !pending.length ? (
          <div className="chat-empty">
            <MessageCircle size={30} />
            <p>No messages yet</p>
            <span>Say hello to {active.id === "party" ? "your party" : active.name}.</span>
          </div>
        ) : null}
        <ol className="chat-messages">
          {visible.map((note) => {
            const own = isOwnNote(note, seat);
            return (
              <li key={note.id} className={own ? "chat-message own" : "chat-message"}>
                <div className="chat-bubble">
                  <p className="chat-author">
                    {own
                      ? "You"
                      : note.from === "dm"
                        ? "Dungeon master"
                        : (purses.find((p) => p.id === note.purseId)?.name ?? "Player")}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{note.text}</p>
                  <p className="chat-time">
                    <time
                      dateTime={new Date(note.at).toISOString()}
                      title={new Date(note.at).toLocaleString()}
                    >
                      {new Date(note.at).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                    {own ? " · Sent" : ""}
                  </p>
                </div>
              </li>
            );
          })}
          {pending.map((item) => (
            <li key={item.command.id} className="chat-message own">
              <div className="chat-bubble">
                <p className="chat-author">You</p>
                <p className="whitespace-pre-wrap break-words">{item.command.text}</p>
                <p className="chat-time" role="status">
                  {sending.includes(item.command.id) ? "Sending…" : "Failed — not confirmed"}
                </p>
                {!sending.includes(item.command.id) ? (
                  <>
                    <p className="mt-1 text-xs text-muted">
                      {item.error || "Retry when you are connected."}
                    </p>
                    <Button
                      variant="secondary"
                      className="mt-2"
                      disabled={viewOnly}
                      onClick={() => void deliver(item)}
                    >
                      <RotateCcw size={14} />
                      Retry
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
      {legacy.length > 0 && (
        <details className="mt-3">
          <summary>Messages saved by an older version ({legacy.length})</summary>
          <p className="text-sm text-muted">
            These recovery copies have no saved account or session identity. Review and copy a
            message to the composer to send it deliberately. The original device copies are
            preserved.
          </p>
          {legacy.map((item) => (
            <div key={item.command.id} className="mt-2">
              <p className="whitespace-pre-wrap break-words">{item.command.text}</p>
              <Button
                type="button"
                variant="secondary"
                disabled={viewOnly}
                onClick={() => setDrafts(setChatDraft(scope, active.id, item.command.text))}
              >
                Copy to composer
              </Button>
            </div>
          ))}
        </details>
      )}
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label className="sr-only" htmlFor="chat-message">
          Message to {active.name}
        </label>
        <TextArea
          id="chat-message"
          rows={2}
          className="min-h-20 resize-none"
          maxLength={500}
          value={text}
          disabled={viewOnly}
          placeholder={`Message ${active.name}…`}
          onChange={(e) => setDrafts(setChatDraft(scope, active.id, e.target.value))}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-muted" role={viewOnly ? "status" : undefined}>
            {text.length}/500 ·{" "}
            {viewOnly ? "View-only until the DM resumes play" : "Send during any turn"}
          </span>
          <Button type="submit" disabled={!text.trim() || isSending || viewOnly}>
            <Send size={16} />
            {isSending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </section>
  );
}
