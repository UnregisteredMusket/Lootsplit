import { useState, type ReactNode, type FormEvent } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import type { CommandInput } from "@/lib/quire/commands";
import { Button } from "./ui";
export function CommandForm({
  children,
  submit,
  label,
  dirty = false,
  onDone,
}: {
  children?: ReactNode;
  submit: () => CommandInput | Promise<CommandInput>;
  label: string;
  dirty?: boolean;
  onDone?: () => void;
}) {
  const { commandOutcome } = useEconomy(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useDraftGuard(dirty, label);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await commandOutcome(await submit());
      setNotice(mutationNotice(result, "Recorded."));
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action failed. Your draft is retained.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="world-form" onSubmit={save}>
      <fieldset disabled={busy}>
        {children}
        <Button type="submit">{busy ? "Saving…" : label}</Button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
export function CommandButton({ input, children }: { input: CommandInput; children: ReactNode }) {
  return (
    <CommandForm label={typeof children === "string" ? children : "Record"} submit={() => input} />
  );
}
