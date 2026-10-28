import { toast } from "sonner";

/**
 * The standard result toast (design D9 / dm #15): the outcome, "View receipt" when the action
 * left a receipt, and "Undo" only where an existing reversal command applies (a DM's shop
 * purchase, through the ledger void). Undo lives as long as the toast: within this session,
 * on this screen, and only while the reversal's own checks still pass.
 */
export function resultToast(
  message: string,
  options: { receipt?: () => void; undo?: () => void } = {},
) {
  const { receipt, undo } = options;
  return toast.success(message, {
    duration: undo ? 10000 : receipt ? 6000 : 4000,
    ...(undo
      ? { action: { label: "Undo", onClick: undo } }
      : receipt
        ? { action: { label: "View receipt", onClick: receipt } }
        : {}),
    ...(undo && receipt ? { cancel: { label: "View receipt", onClick: receipt } } : {}),
  });
}
