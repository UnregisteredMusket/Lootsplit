import {
  Children,
  Fragment,
  isValidElement,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";

type Option = { value: string; label: string; disabled: boolean };
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : String(child),
    )
    .join("");
}
function readOptions(children: ReactNode, group = "", inheritedDisabled = false): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        children?: ReactNode;
        value?: string | number;
        label?: string;
        disabled?: boolean;
        hidden?: boolean;
      }>(child)
    )
      return [];
    if (child.type === Fragment) return readOptions(child.props.children, group, inheritedDisabled);
    if (child.type === "optgroup")
      return readOptions(
        child.props.children,
        child.props.label ?? "",
        inheritedDisabled || !!child.props.disabled,
      );
    if (child.type !== "option" || child.props.hidden) return [];
    const label = child.props.label ?? text(child.props.children);
    return [
      {
        value: String(child.props.value ?? label),
        label: group ? `${group} · ${label}` : label,
        disabled: inheritedDisabled || !!child.props.disabled,
      },
    ];
  });
}
const normalize = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();

/** A record picker with search, touch targets and keyboard selection. Native option values remain unchanged. */
export function SearchSelect({
  value,
  defaultValue,
  onValueChange,
  children,
  className,
  disabled,
  required,
  name,
  id,
  "aria-label": label,
  "aria-labelledby": labelledBy,
  tone = "dark",
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "multiple"> & {
  onValueChange: (value: string) => void;
  tone?: "dark" | "paper";
}) {
  const options = useMemo(() => readOptions(children), [children]);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [limit, setLimit] = useState(60),
    [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null);
  const listId = useId(),
    current = String(value ?? defaultValue ?? "");
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const matches = options.filter((o) => terms.every((t) => normalize(o.label).includes(t)));
  const shown = matches.slice(0, limit),
    selected = options.find((o) => o.value === current);
  function choose(option: Option) {
    if (option.disabled || disabled) return;
    onValueChange(option.value);
    setOpen(false);
  }
  return (
    <Popover.Root
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery("");
        setActive(0);
        setLimit(60);
      }}
    >
      <div className="record-select">
        <Popover.Trigger asChild>
          <button
            ref={button}
            id={id}
            type="button"
            role="combobox"
            data-value={current}
            aria-label={label}
            aria-labelledby={labelledBy}
            aria-controls={listId}
            aria-expanded={open && !disabled}
            aria-haspopup="listbox"
            aria-required={required}
            disabled={disabled}
            className={cn(
              "record-select-trigger",
              tone === "paper" && "record-select-paper",
              className,
            )}
          >
            <span>{selected?.label ?? "Choose a record"}</span>
            <ChevronDown size={18} aria-hidden="true" />
          </button>
        </Popover.Trigger>
        {/* Retain native form validity without exposing a second picker to assistive technology. */}
        <select
          className="sr-only"
          aria-hidden="true"
          aria-label="Native record selection"
          tabIndex={-1}
          value={current}
          name={name}
          required={required}
          disabled={disabled}
          onChange={(e) => onValueChange(e.target.value)}
          onInvalid={(e) => {
            e.preventDefault();
            button.current?.focus();
            setOpen(true);
          }}
        >
          {children}
        </select>
      </div>
      <Popover.Portal container={button.current?.closest("dialog") ?? undefined}>
        <Popover.Content
          className="record-select-menu"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            input.current?.focus();
          }}
        >
          <div className="record-select-search">
            <Search size={18} aria-hidden="true" />
            <input
              ref={input}
              role="combobox"
              aria-label={label ? `Search ${label}` : "Search options"}
              aria-autocomplete="list"
              aria-controls={listId}
              aria-expanded="true"
              aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
              placeholder="Type to search…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                setLimit(60);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const direction = e.key === "ArrowDown" ? 1 : -1;
                  let next = active;
                  for (let i = 0; i < shown.length; i++) {
                    next = (next + direction + shown.length) % shown.length;
                    if (!shown[next].disabled) break;
                  }
                  setActive(next);
                  document
                    .getElementById(`${listId}-${next}`)
                    ?.scrollIntoView({ block: "nearest" });
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (shown[active]) choose(shown[active]);
                }
              }}
            />
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label={label ?? "Records"}
            className="record-select-options"
          >
            {shown.map((o, i) => (
              <button
                id={`${listId}-${i}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={o.value === current}
                disabled={o.disabled}
                data-active={i === active}
                data-value={o.value}
                key={o.value}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                <span>{o.label}</span>
                {o.value === current && <Check size={18} aria-hidden="true" />}
              </button>
            ))}
            {!matches.length && <p>No matching records.</p>}
          </div>
          {shown.length < matches.length && (
            <button
              type="button"
              className="record-select-more"
              onClick={() => setLimit(limit + 60)}
            >
              Show more results ({matches.length - shown.length} remaining)
            </button>
          )}
          <p className="record-select-count" role="status">
            {matches.length} {matches.length === 1 ? "result" : "results"}
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
