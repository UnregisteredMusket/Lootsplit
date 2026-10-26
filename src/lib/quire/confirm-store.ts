import type { ReactNode } from "react";

/**
 * Themed replacements for `window.confirm` and `window.prompt` (design audit D7).
 *
 * `useConfirm()` / `usePrompt()` (or `requestConfirm` / `requestPrompt` outside components) open one dialog rendered by `<DialogHost />`
 * (`src/components/confirm-dialog.tsx`), which the root document mounts once. They work from
 * event handlers, effects and non-React code alike (router blockers, draft guards, the offline
 * report import), inside split view, over an open Modal and in the Android WebView.
 *
 * Only one question is shown at a time. A request made while one is already open settles at once
 * as "Cancel" (false / null), so a double tap can never run the same action twice.
 */
export type ConfirmTone = "danger" | "discard" | "default";

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  /** "danger": destructive (red action). "discard": throw away a draft. Default: neutral. */
  tone?: ConfirmTone;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type PromptOptions = {
  title: string;
  /** Visible label of the text field. */
  label: string;
  body?: ReactNode;
  defaultValue?: string;
  /** "danger" (type-to-confirm deletes): red action and role="alertdialog". */
  tone?: ConfirmTone;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Return an error message to keep the dialog open, or nothing to accept the value. */
  validate?: (value: string) => string | null | undefined | void;
};

export type DialogRequest =
  | {
      id: number;
      kind: "confirm";
      options: ConfirmOptions;
      resolve: (ok: boolean) => void;
      container?: HTMLElement;
      opener?: HTMLElement;
    }
  | {
      id: number;
      kind: "prompt";
      options: PromptOptions;
      resolve: (value: string | null) => void;
      container?: HTMLElement;
      opener?: HTMLElement;
    };

let active: DialogRequest | null = null;
let hosts = 0;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function subscribeDialog(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const activeDialog = () => active;

/** The host calls this while mounted; without a host, questions fall back to the browser's. */
export function registerDialogHost() {
  hosts++;
  return () => {
    hosts--;
  };
}

/** Answer the open question (the host's buttons, Escape, Android back). */
export function settleDialog(id: number, value: boolean | string | null) {
  if (!active || active.id !== id) return;
  const request = active;
  active = null;
  emit();
  // Focus returns to the control that asked (these dialogs have no Radix trigger to return to),
  // unless the answer removed it or another question opened meanwhile.
  const opener = request.opener;
  if (opener)
    setTimeout(() => {
      if (!active && opener.isConnected && !opener.matches(":disabled")) opener.focus();
    }, 0);
  if (request.kind === "confirm") request.resolve(value === true);
  else request.resolve(typeof value === "string" ? value : null);
}

// A fullscreen element or a native modal <dialog> (the map editor) puts everything outside it
// behind the top layer and makes it inert, so the question opens inside the topmost one.
const container = () => {
  if (typeof document === "undefined") return undefined;
  const modal = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")]
    .filter((dialog) => {
      try {
        return dialog.matches(":modal");
      } catch {
        return false;
      }
    })
    .at(-1);
  return modal ?? (document.fullscreenElement as HTMLElement | null) ?? undefined;
};
const opener = () => {
  const focused = typeof document !== "undefined" ? document.activeElement : null;
  return focused && focused !== document.body && "focus" in focused
    ? (focused as HTMLElement)
    : undefined;
};

/** Ask a yes/no question in a themed dialog. Resolves true only for the confirm button. */
export function requestConfirm(options: ConfirmOptions): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!hosts) return Promise.resolve(nativeConfirm(options));
  if (active) return Promise.resolve(false);
  return new Promise((resolve) => {
    active = {
      id: nextId++,
      kind: "confirm",
      options,
      resolve,
      container: container(),
      opener: opener(),
    };
    emit();
  });
}

/** Ask for one line of text in a themed dialog. Resolves null when cancelled. */
export function requestPrompt(options: PromptOptions): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!hosts) return Promise.resolve(nativePrompt(options));
  if (active) return Promise.resolve(null);
  return new Promise((resolve) => {
    active = {
      id: nextId++,
      kind: "prompt",
      options,
      resolve,
      container: container(),
      opener: opener(),
    };
    emit();
  });
}

/** `const confirm = useConfirm(); if (await confirm({ title, tone: "danger" })) …` */
export const useConfirm = () => requestConfirm;
/** `const prompt = usePrompt(); const name = await prompt({ title, label });` (null: cancelled) */
export const usePrompt = () => requestPrompt;

/** Cancel the open themed question (Android back button). Returns whether one was open. */
export function dismissDialog() {
  if (!active) return false;
  settleDialog(active.id, null);
  return true;
}

/** The standard "Discard changes / Keep editing" question for one or more unsaved drafts. */
export function confirmDiscard(subjects: string[]) {
  const list = [...new Set(subjects)];
  const named =
    list.length < 2 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
  return requestConfirm({
    title: "Discard unsaved changes?",
    body: `Discard unsaved ${named} changes and leave this view?`,
    tone: "discard",
  });
}

const plain = (title: string, body: ReactNode) =>
  [title, typeof body === "string" ? body : ""].filter(Boolean).join("\n\n");

// Only before the root document has mounted the host (never in the running app) and in unit
// tests: keep the question answerable rather than silently cancelling it.
/* eslint-disable no-restricted-properties -- the one sanctioned use of the native dialogs */
function nativeConfirm(options: ConfirmOptions) {
  return typeof window.confirm === "function"
    ? window.confirm(plain(options.title, options.body))
    : false;
}
function nativePrompt(options: PromptOptions) {
  return typeof window.prompt === "function"
    ? window.prompt(plain(options.title, options.body), options.defaultValue ?? "")
    : null;
}
/* eslint-enable no-restricted-properties */
