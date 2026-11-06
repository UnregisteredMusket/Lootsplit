/** One faction or favor market command with a reused ID per action (factions.tsx, favor-market.tsx). */
import { useState } from "react";
import { useEconomy, useCommandId } from "@/lib/quire/economy-context";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import type { CommandInput } from "@/lib/quire/commands";

/** One faction command with a reused ID per action; returns the notice or throws the reason. */
export function useFactionCommand(key: string) {
  const { commandOutcome } = useEconomy();
  const action = useCommandId(key);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function send(command: CommandInput, done: string) {
    if (busy) return false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const outcome = await commandOutcome({ ...command, id: action.commandId } as Parameters<typeof commandOutcome>[0]);
      action.renew();
      setNotice(mutationNotice(outcome, done));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nothing was saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { send, busy, error, notice };
}

export function Status({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </>
  );
}

