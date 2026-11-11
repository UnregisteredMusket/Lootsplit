import { useState } from "react";
import {
  editFormDraft,
  formDraftView,
  idleFormDraft,
  settleFormDraft,
  type FormDraftState,
} from "./form-draft.ts";

/**
 * A form draft over a saved record (see form-draft.ts). Key the form by the record's ID, never by
 * its content: `value` follows the record while nothing is being edited.
 *
 * `set` takes a value or an updater, like a state setter; call `settle` once a save is recorded.
 */
export function useFormDraft<D>(source: D) {
  const [state, setState] = useState<FormDraftState<D>>(() => idleFormDraft(source));
  const view = formDraftView(state, source);
  // Adjusting state during render (not in an effect), so no render shows a stale draft.
  if (view.reset) setState(idleFormDraft(source));
  return {
    value: view.value,
    dirty: view.dirty,
    set: (next: D | ((current: D) => D)) => setState((s) => editFormDraft(s, source, next)),
    settle: () => setState((s) => settleFormDraft(s, source)),
  };
}
