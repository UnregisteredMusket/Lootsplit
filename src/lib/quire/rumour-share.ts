import type { CommandRequest } from "./commands.ts";
import type { EconomyMutationOutcome } from "./mutation-outcome.ts";

type Note = { from: "dm" | "player"; to: "party"; purseId: string; text: string };

/** The party-chat line for a bought rumour, within the chat's 500-character limit. */
export function rumourNote(npcName: string, text: string): string {
  const body = `Rumour from ${npcName}: ${text}`;
  return body.length > 500 ? `${body.slice(0, 499)}…` : body;
}

/**
 * "Share in party chat" for a bought rumour (owner decision: rumours may be shared). In a shared
 * room the line is the authoritative `message` command, as Party chat sends it (manual-chat.tsx),
 * so every seat receives it once per command ID. Writing only to this device's chat in a room
 * (audit I2) said "Shared" while nobody received it. Offline it stays a device note.
 */
export async function shareRumour(
  input: { joined: boolean; role: string; purseId: string; npcName: string; text: string; commandId: string },
  send: {
    queueCommand: (command: CommandRequest) => Promise<EconomyMutationOutcome>;
    postNotes: (notes: Note[]) => Promise<unknown>;
  },
): Promise<EconomyMutationOutcome> {
  const text = rumourNote(input.npcName, input.text);
  if (input.joined)
    return send.queueCommand({ id: input.commandId, kind: "message", to: "party", purseId: input.purseId, text });
  await send.postNotes([{ from: input.role === "dm" ? "dm" : "player", to: "party", purseId: input.purseId, text }]);
  return { status: "committed" };
}
