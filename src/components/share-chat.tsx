import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MessageCircle, Send, RotateCcw, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button, TextArea } from "./ui";
import { getCloudTable, sendRoomMessage, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { getChatSnapshot, serverChat, subscribeChat } from "@/lib/quire/chat";
import { canReadNote, conversationFor, isOwnNote } from "@/lib/quire/chat-visibility";
import { useChatUnread } from "@/lib/quire/use-chat-unread";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import type { Command } from "@/lib/quire/commands";

type Message = Extract<Command, { kind: "message" }>;
type Outgoing = { command: Message; thread: string; at: number; error?: string };
export function ShareChat() {
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getCloudTable);
  if (!room.joined)
    return (
      <p className="text-sm text-muted">
        Start or join a room to chat live. Offline message files are under Manual sharing & files.
      </p>
    );
  return <LiveChat key={`${room.code}.${room.seatId}`} />;
}
function LiveChat() {
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getCloudTable);
  const seat = useSeat();
  const { purses } = useEconomy();
  const notes = useSyncExternalStore(subscribeChat, getChatSnapshot, serverChat);
  const { unread, markRead } = useChatUnread();
  const [thread, setThread] = useState("party");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [sending, setSending] = useState<string[]>([]);
  const sendingRef = useRef(new Set<string>());
  const history = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const store = `lootsplit.chat.outbox.${room.code}.${room.seatId}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(store) || "[]");
      if (Array.isArray(saved))
        setOutbox(
          saved
            .filter(
              (m) =>
                m?.command?.kind === "message" &&
                typeof m.command.id === "string" &&
                typeof m.command.text === "string",
            )
            .map((m) => ({ ...m, error: "Not confirmed. Retry to check delivery." })),
        );
    } catch {
      toast.error("Could not read unsent messages.");
    }
  }, [store]);
  const characters = purses.filter((p) => p.kind === "character" && p.control !== "npc");
  const options = [
    { id: "party", name: "Party chat" },
    ...(seat.role === "player" ? [{ id: "dm", name: "Dungeon master" }] : []),
    ...characters
      .filter((p) => seat.role === "dm" || !seat.purseIds.includes(p.id))
      .map((p) => ({ id: p.id, name: p.name })),
  ];
  const active = options.find((o) => o.id === thread) ?? options[0]!;
  const visible = notes.filter(
    (n) => canReadNote(n, seat) && conversationFor(n, seat) === active.id,
  );
  const pending = outbox.filter(
    (m) => m.thread === active.id && !notes.some((n) => n.id === m.command.id),
  );
  const text = drafts[active.id] ?? "";
  const sender = characters.find((p) => seat.purseIds.includes(p.id));
  const isSending = sending.length > 0;

  useEffect(() => {
    const mark = () => {
      if (nearBottom.current) markRead(active.id, visible);
    };
    if (nearBottom.current && history.current)
      history.current.scrollTop = history.current.scrollHeight;
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [active.id, notes, outbox, markRead]);
  // Drop confirmed outbox entries, including an acknowledgement found after a failed response.
  useEffect(() => {
    if (!outbox.some((m) => notes.some((n) => n.id === m.command.id))) return;
    const next = outbox.filter((m) => !notes.some((n) => n.id === m.command.id));
    setOutbox(next);
    try {
      localStorage.setItem(store, JSON.stringify(next));
    } catch {
      /* duplicate retries remain idempotent */
    }
  }, [notes, outbox, store]);

  function persist(next: Outgoing[]) {
    localStorage.setItem(store, JSON.stringify(next));
    setOutbox(next);
  }
  async function deliver(item: Outgoing) {
    if (sendingRef.current.has(item.command.id)) return;
    sendingRef.current.add(item.command.id);
    setSending([...sendingRef.current]);
    try {
      await sendRoomMessage(item.command);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Connection failed. Retry when online.";
      setOutbox((old) => {
        const next = old.map((m) =>
          m.command.id === item.command.id ? { ...m, error: message } : m,
        );
        try {
          localStorage.setItem(store, JSON.stringify(next));
        } catch {
          /* keep in this tab */
        }
        return next;
      });
    } finally {
      sendingRef.current.delete(item.command.id);
      setSending([...sendingRef.current]);
    }
  }
  function send() {
    if (!text.trim() || isSending) return;
    if (seat.role === "player" && !sender) {
      toast.error("Your character is no longer assigned. Ask the host for help.");
      return;
    }
    const to =
      active.id === "party" ? "party" : active.id === "dm" || seat.role === "dm" ? "dm" : "player";
    const command: Message = {
      kind: "message",
      id: crypto.randomUUID(),
      to,
      purseId: seat.role === "dm" ? (to === "party" ? "" : active.id) : sender!.id,
      ...(to === "player" ? { recipientId: active.id } : {}),
      text: text.trim(),
    };
    const item: Outgoing = { command, thread: active.id, at: Date.now() };
    try {
      persist([...outbox, item]);
    } catch {
      toast.error("Could not save the message on this device. Your draft is still here.");
      return;
    }
    setDrafts((old) => ({ ...old, [active.id]: "" }));
    nearBottom.current = true;
    void deliver(item);
  }
  return (
    <section className="live-chat" aria-label="Live party chat">
      <label className="chat-select">
        <span className="text-sm font-medium">Conversation</span>
        <select
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
      <div
        className="chat-history"
        ref={history}
        onScroll={() => {
          const el = history.current;
          if (!el) return;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (nearBottom.current) markRead(active.id, visible);
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
                    <Button variant="secondary" className="mt-2" onClick={() => void deliver(item)}>
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
          placeholder={`Message ${active.name}…`}
          onChange={(e) => setDrafts((old) => ({ ...old, [active.id]: e.target.value }))}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-muted">{text.length}/500 · Send during any turn</span>
          <Button type="submit" disabled={!text.trim() || isSending}>
            <Send size={16} />
            {isSending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </section>
  );
}
