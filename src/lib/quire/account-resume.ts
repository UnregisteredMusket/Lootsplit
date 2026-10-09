import type { Command } from "./commands.ts";
import { sameCommand } from "./command-identity.ts";

export type ResumeCache = {
  code: string;
  token: string;
  seatId: string;
  role: "dm" | "player";
  revision: number;
  pending: Command[];
  batchId: string;
};

/** Reading an account save never submits commands or replaces the server table. */
export function reconcileAccountResume(
  cached: ResumeCache | null,
  remote: {
    code: string;
    seatId: string;
    revision: number;
    acknowledged: string[];
    draft: string;
  },
  identity: { token: string; role: "dm" | "player" },
  freshBatchId: string,
) {
  const draft = JSON.parse(remote.draft) as Command[];
  if (!Array.isArray(draft))
    throw new Error("The saved turn could not be read. Retry account resume.");
  const sameSeat =
    !!cached &&
    cached.code === remote.code &&
    cached.seatId === remote.seatId &&
    cached.token === identity.token &&
    cached.role === identity.role;
  const acknowledged = new Set(remote.acknowledged);
  const local = sameSeat ? cached!.pending.filter((c) => !acknowledged.has(c.id)) : [];
  // Server drafts and local unsent additions both survive a cross-device resume.
  const pending = [...draft.filter((c) => !acknowledged.has(c.id))];
  const known = new Set(pending.map((c) => c.id));
  const conflict = local.some((c) => pending.some((d) => d.id === c.id && !sameCommand(d, c)));
  for (const command of local)
    if (!known.has(command.id)) {
      pending.push(command);
      known.add(command.id);
    }
  return {
    pending,
    // A receipt identifies the whole ordered payload. Keep it only for an
    // unchanged retry; individual command IDs still prevent double execution.
    batchId:
      sameSeat &&
      pending.length > 0 &&
      pending.length === cached!.pending.length &&
      pending.every((c, i) => sameCommand(c, cached!.pending[i]))
        ? cached!.batchId
        : freshBatchId,
    // Force a read/rebase after selecting the device database, including conflicts.
    revision: pending.length ? -1 : 0,
    // A changed seat must never replay the previous seat's queued work.
    needsRecovery:
      !!cached?.pending.length && (!sameSeat || cached.revision > remote.revision || conflict),
  };
}
