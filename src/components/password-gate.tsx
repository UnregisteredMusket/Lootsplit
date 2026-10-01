import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, Modal, TextInput } from "@/components/ui";

export function PasswordGate({
  open,
  title,
  body,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  body: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setError("");
    setBusy(false);
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || password.length === 0) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(password);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That password does not match this save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title}>
      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <p className="text-sm text-muted">{body}</p>
        <Field label="Password">
          <TextInput type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy || password.length === 0}>
          Continue
        </Button>
      </form>
    </Modal>
  );
}
