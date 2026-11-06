/**
 * Create room saves the new room to My account just after the room opens. Until that save
 * finishes the account has no membership for the room, so account reads that need one
 * (character imports, the campaign roll log) would be refused with 403. Screens wait while a
 * save is underway and read again when it ends (QA pass 2026-11). Nothing is stored.
 */
let underway = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Run `save` (room creation plus its account save) with account reads held back meanwhile. */
export async function whileSavingMembership<T>(save: () => Promise<T>): Promise<T> {
  underway += 1;
  notify();
  try {
    return await save();
  } finally {
    underway -= 1;
    notify();
  }
}

/** Whether a new room is being saved to My account right now. */
export function savingMembership() {
  return underway > 0;
}

export function subscribeMembershipSave(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Server render: no save is ever underway. */
export function serverSavingMembership() {
  return false;
}
