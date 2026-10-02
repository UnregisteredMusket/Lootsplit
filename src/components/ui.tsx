import {
  forwardRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Tone = "dark" | "paper";

const styles: Record<Tone, Record<Variant, string>> = {
  dark: {
    primary: "bg-lead text-bg hover:brightness-95",
    secondary: "border border-border bg-subtle text-fg hover:bg-elevated",
    ghost: "text-fg hover:bg-subtle",
    danger: "border border-danger text-fg hover:bg-danger",
  },
  paper: {
    primary: "bg-ink text-paper hover:bg-paper-muted",
    secondary: "border border-paper-line bg-paper-sunk text-ink hover:bg-paper",
    ghost: "text-ink hover:bg-paper-sunk",
    danger: "border border-danger text-ink hover:bg-danger hover:text-fg",
  },
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  tone?: Tone;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", tone = "dark", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-4 text-sm font-medium motion-press active:scale-[0.98] disabled:opacity-40",
        styles[tone][variant],
        className,
      )}
      {...props}
    />
  );
});

export function Fold({
  title,
  hint,
  children,
  defaultOpen = false,
  actions,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="loot-fold mt-4 rounded-lg border border-border">
      <div className="flex items-stretch">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 px-4 text-left"
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium">{title}</span>
            {hint && !open ? (
              <span className="mt-0.5 block truncate text-sm text-muted">{hint}</span>
            ) : null}
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-faint", open && "rotate-180")} />
        </button>
        {actions ? <div className="flex items-center pr-3">{actions}</div> : null}
      </div>
      {open ? <div className="border-t border-border px-4 pt-3 pb-4">{children}</div> : null}
    </section>
  );
}

export function TextInput({
  tone = "dark",
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { tone?: Tone }) {
  return (
    <input
      {...props}
      className={cn(
        "min-h-11 w-full rounded-sm border px-3 text-base outline-none",
        tone === "dark"
          ? "border-border bg-subtle text-fg placeholder:text-faint"
          : "border-paper-line bg-paper text-ink placeholder:text-paper-muted",
        className,
      )}
    />
  );
}

export function TextArea({
  tone = "dark",
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { tone?: Tone }) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-24 w-full rounded-sm border px-3 py-2 text-base outline-none",
        tone === "dark"
          ? "border-border bg-subtle text-fg placeholder:text-faint"
          : "border-paper-line bg-paper text-ink placeholder:text-paper-muted",
        className,
      )}
    />
  );
}

export function Select({
  tone = "dark",
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { tone?: Tone }) {
  return (
    <select
      {...props}
      className={cn(
        "min-h-11 w-full rounded-sm border px-3 text-base",
        tone === "dark" ? "border-border bg-subtle text-fg" : "border-paper-line bg-paper text-ink",
        className,
      )}
    />
  );
}

export function Field({
  label,
  children,
  hint,
  tone = "dark",
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <label className="block">
      <span
        className={cn("mb-1 block text-sm font-medium", tone === "paper" ? "text-ink" : "text-fg")}
      >
        {label}
      </span>
      {children}
      {hint ? (
        <span
          className={cn("mt-1 block text-sm", tone === "paper" ? "text-paper-muted" : "text-muted")}
        >
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div className="flex rounded-md bg-subtle p-1" role="tablist" aria-label={label}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-11 flex-1 rounded-sm px-3 text-sm font-medium motion-colors",
              selected ? "bg-fg text-bg" : "text-muted hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "danger" | "paper";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium",
        tone === "danger" && "bg-danger text-fg",
        tone === "neutral" && "bg-subtle text-muted",
        tone === "paper" && "bg-paper-sunk text-paper-muted",
      )}
    >
      {children}
    </span>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  children,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  returnFocus?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay fixed inset-0 z-40" />
        <Dialog.Content
          className="modal-pop rounded-xl border border-border bg-elevated p-4 text-fg"
          aria-describedby={undefined}
          onCloseAutoFocus={
            returnFocus
              ? (event) => {
                  event.preventDefault();
                  document.querySelector<HTMLElement>(returnFocus)?.focus();
                }
              : undefined
          }
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-display text-2xl leading-tight tracking-tight">
              {title}
            </Dialog.Title>
            <Dialog.Close
              className="grid size-11 shrink-0 place-items-center rounded-sm hover:bg-subtle"
              aria-label="Close"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Confirm({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="modal-overlay fixed inset-0 z-40" />
        <AlertDialog.Content className="modal-pop rounded-xl border border-border bg-elevated p-4 text-fg">
          <AlertDialog.Title className="font-display text-2xl leading-tight tracking-tight">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted">
            {body}
          </AlertDialog.Description>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="danger" onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function ToggleButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-sm border px-3 text-sm font-medium motion-colors",
        pressed ? "border-fg bg-fg text-bg" : "border-border text-fg hover:bg-subtle",
      )}
    >
      {children}
    </button>
  );
}

export function ChoiceGrid<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {options.map((option) => (
          <ToggleButton
            key={String(option.value)}
            pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </ToggleButton>
        ))}
      </div>
    </fieldset>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="mt-1 block text-sm text-muted">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-11 w-16 shrink-0 rounded-full motion-colors",
          checked ? "bg-accent" : "border border-border bg-subtle",
        )}
      >
        <span
          className={cn(
            "absolute top-1.5 left-1.5 size-8 rounded-full bg-fg transition-transform duration-150",
            checked && "translate-x-6",
          )}
        />
      </button>
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  tone = "dark",
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  tone?: Tone;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        tone={tone}
        variant="secondary"
        className="size-11 px-0"
        aria-label={`Decrease ${label}`}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
      >
        <Minus className="size-4" />
      </Button>
      <span className="min-w-8 text-center text-lg font-medium tabular-nums">{value}</span>
      <Button
        tone={tone}
        variant="secondary"
        className="size-11 px-0"
        aria-label={`Increase ${label}`}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
      >
        <Plus className="size-4" />
      </Button>
    </div>
  );
}

export function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  onCommit,
  display,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  display: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="text-muted tabular-nums">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={display}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={(event) => onCommit?.(Number((event.target as HTMLInputElement).value))}
        onBlur={(event) => onCommit?.(Number(event.target.value))}
        onKeyUp={(event) => onCommit?.(Number((event.target as HTMLInputElement).value))}
        className="mt-1 w-full accent-accent"
      />
    </label>
  );
}
