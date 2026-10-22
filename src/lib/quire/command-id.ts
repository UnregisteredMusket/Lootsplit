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
