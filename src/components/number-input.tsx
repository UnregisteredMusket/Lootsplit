import type { InputHTMLAttributes } from "react";
import { useNumberDraft } from "@/lib/quire/use-number-draft";

/** A number input whose saved value stays numeric while the user can type "-" or clear it. */
export function NumberInput({
  value,
  onValue,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "type"> & {
  value: number;
  onValue: (value: number) => void;
}) {
  const draft = useNumberDraft(value, onValue);
  return <input {...props} type="number" {...draft} />;
}
