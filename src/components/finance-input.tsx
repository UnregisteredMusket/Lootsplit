import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { useFinanceReadiness } from "@/lib/quire/use-finance-readiness";
import { denominationCopper } from "@/lib/quire/finance-presentation";
import { formatCopper } from "@/lib/quire/money";
import { copperEcho } from "@/lib/quire/copper-echo";
import { useNumberDraft } from "@/lib/quire/use-number-draft";
import { AppLink } from "./app-link";
import { TextInput } from "./ui";
import "./finance-input.css";

export function CoinAmountInput({
  label,
  value,
  onChange,
  min = 0,
  max = 1e12,
  required = true,
  disabled = false,
  resetKey,
  onBlur,
}: {
  label: string;
  value: string | number;
  onChange: (raw: string) => void;
  min?: number;
  max?: number;
  required?: boolean;
  disabled?: boolean;
  resetKey?: string | number;
  onBlur?: () => void;
}) {
  const echoId = useId();
  const [withCoins, setWithCoins] = useState(false),
    [raw, setRaw] = useState("");
  const normalizedValue = Number.isNaN(Number(value)) ? "" : String(value),
    emittedValue = useRef(normalizedValue),
    previousReset = useRef(resetKey);
  useEffect(() => {
    if (emittedValue.current !== normalizedValue || previousReset.current !== resetKey) setRaw("");
    previousReset.current = resetKey;
    emittedValue.current = normalizedValue;
  }, [normalizedValue, resetKey]);
  const parsed = denominationCopper(raw),
    echo = copperEcho(value);
  return (
    <div className="grid gap-2 coin-amount">
      <label className="grid gap-2 text-sm">
        {label}
        <TextInput
          type="number"
          step="1"
          min={min}
          max={max}
          required={required}
          disabled={disabled}
          value={Number.isNaN(Number(value)) ? "" : value}
          aria-describedby={echo ? echoId : undefined}
          onBlur={onBlur}
          onChange={(e) => {
            setRaw("");
            emittedValue.current = e.target.value;
            onChange(e.target.value);
          }}
        />
      </label>
      {echo && (
        <span id={echoId} className="coin-amount-echo" data-coin-echo="">
          {echo}
        </span>
      )}
      <button
        type="button"
        className="min-h-11 text-sm underline"
        disabled={disabled}
        onClick={() => setWithCoins(!withCoins)}
      >
        {withCoins ? "Hide denomination entry" : "Enter gold, silver or other coins"}
      </button>
      {withCoins && (
        <label className="grid gap-2 text-sm">
          {label} with coin denominations
          <TextInput
            value={raw}
            disabled={disabled}
            placeholder="1 gp 5 sp"
            onChange={(e) => {
              const text = e.target.value;
              setRaw(text);
              const amount = denominationCopper(text);
              emittedValue.current = amount === null ? "" : String(amount);
              onChange(emittedValue.current);
            }}
          />
        </label>
      )}
      {withCoins && raw && (
        <p role={parsed === null ? "alert" : "status"}>
          {parsed === null
            ? "Enter a valid amount, such as 1 gp 5 sp."
            : `${parsed} cp · ${formatCopper(parsed)}. The copper amount above is used.`}
        </p>
      )}
    </div>
  );
}

/**
 * A copper amount saved as a number (design plan D8): the same `CoinAmountInput` with its live gold
 * echo and coin entry, keeping the number-field draft rules (clearing is allowed while typing; an
 * emptied field means 0 on blur). The stored unit and every command payload stay whole copper.
 */
export function CopperField({
  label,
  value,
  set,
  min = 0,
  max = 1e12,
  required = true,
  disabled = false,
}: {
  label: string;
  value: number;
  set: (copper: number) => void;
  min?: number;
  max?: number;
  required?: boolean;
  disabled?: boolean;
}) {
  const draft = useNumberDraft(value, set);
  return (
    <CoinAmountInput
      label={label}
      value={draft.value}
      min={min}
      max={max}
      required={required}
      disabled={disabled}
      onBlur={draft.onBlur}
      onChange={(raw) =>
        draft.onChange({ target: { value: raw } } as ChangeEvent<HTMLInputElement>)
      }
    />
  );
}

export function FinanceReadiness({ pendingDowntime = false }: { pendingDowntime?: boolean }) {
  const { reason, room } = useFinanceReadiness(pendingDowntime);
  return (
    <>
      {reason && <p role="status">{reason}</p>}
      {room.joined && room.pending > 0 && (
        <p role="status">
          {room.pending} pending action{room.pending === 1 ? "" : "s"}.{" "}
          {room.live
            ? "Check sync before repeating an action."
            : "Submit your turn to commit changes."}{" "}
          <AppLink href="/share">Open Multiplayer</AppLink>
        </p>
      )}
    </>
  );
}
