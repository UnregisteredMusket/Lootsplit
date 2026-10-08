import { useEffect, useRef, useState } from "react";
import { useFinanceReadiness } from "@/lib/quire/use-finance-readiness";
import { denominationCopper } from "@/lib/quire/finance-presentation";
import { formatCopper } from "@/lib/quire/money";
import { AppLink } from "./app-link";
import { TextInput } from "./ui";

export function CoinAmountInput({
  label,
  value,
  onChange,
  min = 0,
  max = 1e12,
  required = true,
  disabled = false,
  resetKey,
}: {
  label: string;
  value: string | number;
  onChange: (raw: string) => void;
  min?: number;
  max?: number;
  required?: boolean;
  disabled?: boolean;
  resetKey?: string | number;
}) {
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
  const parsed = denominationCopper(raw);
  return (
    <div className="grid gap-2">
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
          onChange={(e) => {
            setRaw("");
            emittedValue.current = e.target.value;
            onChange(e.target.value);
          }}
        />
      </label>
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
