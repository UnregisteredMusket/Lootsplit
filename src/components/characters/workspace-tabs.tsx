import { useRef } from "react";
export function CharacterTabs({
  options,
  value,
  onChange,
  label,
  ids,
}: {
  options: readonly (readonly [string, string])[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  ids: { tabId: (key: string) => string; panelId: string };
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  return (
    <div className="sheet-tabs character-tablist" role="tablist" aria-label={label}>
      {options.map(([key, text], index) => (
        <button
          key={key}
          type="button"
          role="tab"
          id={ids.tabId(key)}
          aria-controls={ids.panelId}
          aria-selected={key === value}
          aria-pressed={key === value}
          tabIndex={key === value ? 0 : -1}
          ref={(node) => {
            if (node) buttons.current.set(key, node);
            else buttons.current.delete(key);
          }}
          onClick={() => onChange(key)}
          onKeyDown={(event) => {
            let next = index;
            if (event.key === "ArrowRight") next = (index + 1) % options.length;
            else if (event.key === "ArrowLeft")
              next = (index + options.length - 1) % options.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = options.length - 1;
            else return;
            event.preventDefault();
            const selected = options[next][0];
            onChange(selected);
            buttons.current.get(selected)?.focus();
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
