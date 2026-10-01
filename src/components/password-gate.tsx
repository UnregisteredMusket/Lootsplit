import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, Modal, TextInput } from "@/components/ui";

export function PasswordGate({
  open,
  title,
  body,
  onOpenChange,
  onSubmit,
  showBackupPassword = false,
}: {
  open: boolean;
  title: string;
  body: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (password: string, backupPassword?: string) => Promise<void>;
  showBackupPassword?: boolean;
}) {
  const [password, setPassword] = useState("");
  const [backupPassword,setBackupPassword]=useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setBackupPassword("");
    setError("");
    setBusy(false);
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || password.length === 0) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(password,backupPassword||undefined);
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
        {showBackupPassword ? <Field label="Backup file password (if different)"><TextInput type="password" autoComplete="off" value={backupPassword} onChange={e=>setBackupPassword(e.target.value)} /></Field> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy || password.length === 0}>
          Continue
        </Button>
      </form>
    </Modal>
  );
}
