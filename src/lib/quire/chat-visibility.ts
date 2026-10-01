import type { ChatNote } from "./chat.ts";
export type ChatSeat = { role: "dm" | "player"; purseIds: string[] };
export function canReadNote(note: ChatNote, seat: ChatSeat): boolean {
  if (note.to === "party") return true;
  if (note.to === "player")
    return (
      seat.role === "player" &&
      (seat.purseIds.includes(note.purseId) ||
        (!!note.recipientId && seat.purseIds.includes(note.recipientId)))
    );
  return seat.role === "dm" || seat.purseIds.includes(note.purseId);
}
export function isOwnNote(note: Pick<ChatNote, "from" | "purseId">, seat: ChatSeat): boolean {
  return seat.role === "dm"
    ? note.from === "dm"
    : note.from === "player" && seat.purseIds.includes(note.purseId);
}
export function conversationFor(note: ChatNote, seat: ChatSeat): string {
  if (note.to === "party") return "party";
  if (note.to === "dm") return seat.role === "dm" ? note.purseId : "dm";
  return seat.purseIds.includes(note.purseId) ? note.recipientId! : note.purseId;
}
