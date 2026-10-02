import { getServerCloudTable } from "./cloud-client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getCloudTable, subscribeCloudTable } from "./cloud-client";
import { getChatSnapshot, serverChat, subscribeChat } from "./chat";
import { useSeat } from "./seat";
import { unreadMessages, readThrough, type ReadState } from "./chat-read";
const EVENT = "lootsplit-chat-read";
export function useChatUnread() {
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const notes = useSyncExternalStore(subscribeChat, getChatSnapshot, serverChat);
  const seat = useSeat();
  const key = `lootsplit.chat.read.${room.code}.${room.seatId}`;
  const [state, setState] = useState<{ key: string; read: ReadState }>({ key: "", read: {} });
  const read = state.key === key ? state.read : {};
  useEffect(() => {
    const load = () => {
      try {
        setState({ key, read: JSON.parse(localStorage.getItem(key) || "{}") });
      } catch {
        setState({ key, read: {} });
      }
    };
    load();
    window.addEventListener(EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, [key]);
  const markRead = useCallback(
    (thread: string, visible: typeof notes) => {
      if (!visible.length || document.visibilityState !== "visible") return;
      let current: ReadState = {};
      try {
        current = JSON.parse(localStorage.getItem(key) || "{}");
      } catch {
        /* start fresh */
      }
      const next = { ...current, [thread]: readThrough(visible, current[thread]) };
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* keep this tab's read state */
      }
      setState({ key, read: next });
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );
  const unread = room.joined ? unreadMessages(notes, seat, read) : [];
  return { count: unread.length, unread, markRead };
}
