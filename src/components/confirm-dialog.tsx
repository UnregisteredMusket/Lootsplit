import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Confirm, Modal, TextInput } from "./ui";
import {
  activeDialog,
  registerDialogHost,
  settleDialog,
  subscribeDialog,
  type ConfirmTone,
  type DialogRequest,
} from "@/lib/quire/confirm-store";

const defaults: Record<ConfirmTone, { confirm: string; cancel: string }> = {
  danger: { confirm: "Delete", cancel: "Cancel" },
  discard: { confirm: "Discard changes", cancel: "Keep editing" },
  default: { confirm: "Continue", cancel: "Cancel" },
};

/**
 * Renders the themed confirmations and prompts asked through `useConfirm` / `usePrompt`
 * (`src/lib/quire/confirm-store.ts`). Mounted once by the root document.
 */
export function DialogHost() {
  const request = useSyncExternalStore(subscribeDialog, activeDialog, () => null);
  useEffect(() => registerDialogHost(), []);
  if (!request) return null;
  if (request.kind === "prompt")
    return <PromptView key={request.id} request={request} />;
  const tone = request.options.tone ?? "default";
  return (
    <Confirm
      key={request.id}
      open
      onOpenChange={(open) => {
        if (!open) settleDialog(request.id, false);
      }}
      title={request.options.title}
      body={request.options.body}
      tone={tone}
      confirmLabel={request.options.confirmLabel ?? defaults[tone].confirm}
      cancelLabel={request.options.cancelLabel ?? defaults[tone].cancel}
      onConfirm={() => settleDialog(request.id, true)}
      container={request.container}
    />
  );
}

function PromptView({ request }: { request: Extract<DialogRequest, { kind: "prompt" }> }) {
  const { options } = request;
  const [value, setValue] = useState(options.defaultValue ?? "");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const fieldId = `themed-prompt-${request.id}`;
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) settleDialog(request.id, null);
      }}
      title={options.title}
      container={request.container}
      data-themed-dialog="prompt"
      data-tone={options.tone ?? "default"}
      role={options.tone === "danger" ? "alertdialog" : undefined}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const problem = options.validate?.(value);
          if (problem) {
            setError(problem);
            input.current?.focus();
            return;
          }
          settleDialog(request.id, value);
        }}
      >
        {options.body ? (
          <div className="mb-3 whitespace-pre-line text-sm text-muted">{options.body}</div>
        ) : null}
        <label htmlFor={fieldId} className="mb-1 block text-sm font-medium">
          {options.label}
        </label>
        <TextInput
          ref={input}
          id={fieldId}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError("");
          }}
        />
        {error ? (
          <p id={`${fieldId}-error`} role="alert" className="mt-2 text-sm text-negative">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" data-dialog-cancel onClick={() => settleDialog(request.id, null)}>
            {options.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            type="submit"
            variant={options.tone === "danger" ? "danger" : "primary"}
            data-dialog-confirm
          >
            {options.confirmLabel ?? "OK"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
