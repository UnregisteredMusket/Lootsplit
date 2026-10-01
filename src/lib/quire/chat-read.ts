import type { ChatNote } from "./chat.ts";
import { canReadNote, isOwnNote, conversationFor, type ChatSeat } from "./chat-visibility.ts";
export type ReadCursor = { at: number; ids: string[] };
export type ReadState = Record<string, ReadCursor>;
export function unreadMessages(notes: ChatNote[], seat: ChatSeat, read: ReadState): ChatNote[] {
  return notes.filter((note) => {
    if (!canReadNote(note, seat) || isOwnNote(note, seat)) return false;
    const cursor = read[conversationFor(note, seat)];
    return (
      !cursor || note.at > cursor.at || (note.at === cursor.at && !cursor.ids.includes(note.id))
    );
  });
}
export function readThrough(notes: ChatNote[], previous?: ReadCursor): ReadCursor {
  const at = notes.reduce((latest, note) => Math.max(latest, note.at), previous?.at ?? 0);
  return {
    at,
    ids: [
      ...new Set([
        ...(previous?.at === at ? previous.ids : []),
        ...notes.filter((note) => note.at === at).map((note) => note.id),
      ]),
    ],
  };
}
