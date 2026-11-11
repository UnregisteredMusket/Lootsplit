/**
 * Edit forms over a saved record (audit 2026-11-10 D5/D6). A form shows the saved record directly
 * until someone edits it; only then does it hold its own draft. A reload (window focus, another
 * seat's action) never puts back what is being typed, and saving keeps the form mounted, so its
 * section stays open and its "Recorded." notice stays visible.
 *
 * - While not edited, the form shows the outside value as it is now.
 * - While edited, it shows the draft. The draft ends once it matches the outside value (the save
 *   arrived, or the edit was undone).
 * - After a save (`settle`), the form keeps showing what was saved until the outside value changes,
 *   then follows it again: a queued room command or a server-normalized record never flashes the
 *   old values or leaves a stale draft behind.
 */
export type FormDraftState<D> = {
  draft: D;
  edited: boolean;
  /** After a save: the outside value's key at that moment; the draft shows until it changes. */
  holdWhile?: string;
};

export const draftKey = (value: unknown): string => JSON.stringify(value) ?? "undefined";

export const idleFormDraft = <D>(source: D): FormDraftState<D> => ({ draft: source, edited: false });

/** What the form shows for this render, and whether its state should return to idle. */
export function formDraftView<D>(
  state: FormDraftState<D>,
  source: D,
): { value: D; dirty: boolean; reset: boolean } {
  const key = draftKey(source);
  if (state.edited) {
    if (draftKey(state.draft) === key) return { value: source, dirty: false, reset: true };
    return { value: state.draft, dirty: true, reset: false };
  }
  if (state.holdWhile !== undefined) {
    if (state.holdWhile === key) return { value: state.draft, dirty: false, reset: false };
    return { value: source, dirty: false, reset: true };
  }
  return { value: source, dirty: false, reset: false };
}

/** The state after an edit: `next` is a value or an updater of what the form shows now. */
export function editFormDraft<D>(
  state: FormDraftState<D>,
  source: D,
  next: D | ((current: D) => D),
): FormDraftState<D> {
  const current = formDraftView(state, source).value;
  return {
    draft: typeof next === "function" ? (next as (current: D) => D)(current) : next,
    edited: true,
  };
}

/** The state after a save was recorded (committed or queued). */
export function settleFormDraft<D>(state: FormDraftState<D>, source: D): FormDraftState<D> {
  if (!state.edited) return state;
  return { draft: state.draft, edited: false, holdWhile: draftKey(source) };
}
