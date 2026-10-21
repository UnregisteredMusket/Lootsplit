import { useState, type ChangeEvent } from "react";
import { parseNumberDraft } from "./number-draft.ts";

/**
 * Controlled numeric input that lets the user clear the field or type a leading "-".
 * Saved values stay numbers: only parseable text is committed; blur normalizes the text.
 */
export function useNumberDraft(value: number, commit: (value: number) => void) {
  const [text, setText] = useState(() => String(value)),
    [seen, setSeen] = useState(value);
  if (seen !== value) {
    // An outside change (reload, reset) replaces the text unless it already shows that value.
    setSeen(value);
    if (parseNumberDraft(text) !== value) setText(String(value));
  }
  return {
    value: text,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setText(e.target.value);
      const next = parseNumberDraft(e.target.value);
      if (next !== null) commit(next);
    },
    onBlur: () => {
      // As before, an emptied field means 0.
      const next = parseNumberDraft(text);
      if (next === null) {
        setText("0");
        if (value !== 0) commit(0);
      } else setText(String(next));
    },
  };
}
