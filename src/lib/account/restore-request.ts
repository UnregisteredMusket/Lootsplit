// Store only account-scoped request IDs. No campaign contents or capabilities
// enter this retry marker, which survives a lost response and document reload.
const prefix = "lootsplit.account.restore-request.v1.";
export function accountRestoreRequest(
  userId: string,
  backupId: string,
  storage: Storage = localStorage,
) {
  if (!userId) throw new Error("Sign in before restoring shared records.");
  const key = `${prefix}${userId}.${backupId}`;
  const previous = storage.getItem(key);
  if (previous && /^[a-zA-Z0-9-]{16,80}$/.test(previous)) return previous;
  const requestId = crypto.randomUUID();
  storage.setItem(key, requestId);
  return requestId;
}
export function acknowledgeAccountRestore(
  userId: string,
  backupId: string,
  requestId: string,
  storage: Storage = localStorage,
) {
  const key = `${prefix}${userId}.${backupId}`;
  if (storage.getItem(key) === requestId) storage.removeItem(key);
}
