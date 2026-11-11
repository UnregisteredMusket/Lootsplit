/**
 * One command ID per user action (review P3c).
 *
 * Create an ID when the person starts an action (opens a form, presses Buy),
 * pass it to the economy action as `{ commandId }` (or as `id` on a command),
 * and pass the same ID again when the same action is retried after a failure
 * or an uncertain result. Make a new ID only after the action succeeded or the
 * person changes what the action does. The device keeps a receipt of each
 * caller-supplied ID and the room skips IDs it already applied, so a retry is
 * never a second charge. Reusing an ID for a different action is rejected.
 */
export function newCommandId(): string {
  return crypto.randomUUID();
}

/** Options accepted by economy actions that move money or items. */
export type CommandOptions = { commandId?: string };

/**
 * A command ID for one part of a multi-command action (Claim all as Pass: one claim per lot),
 * derived from the action's ID so a retry reuses it. Other seats cannot predict it from an ID
 * they have seen (it was `${id}-${i}`; review of PR 488). Not a cryptographic hash: its input
 * is a random, unshared action ID.
 */
export function subCommandId(actionId: string, part: string): string {
  const text = `${actionId}|${part}`;
  const lanes = [0x811c9dc5, 0x01000193, 0x5bd1e995, 0x27d4eb2f];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    for (let l = 0; l < lanes.length; l++)
      lanes[l] = Math.imul((lanes[l]! ^ c) + l, 0x01000193 + 2 * l) >>> 0;
  }
  const hex = lanes.map((v) => v.toString(16).padStart(8, "0")).join("");
  return `sub-${hex}`;
}
