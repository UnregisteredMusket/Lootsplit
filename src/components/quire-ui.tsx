import { useState } from "react";
import { Confirm } from "@/components/ui";
import { cn } from "@/lib/cn";
import { usePrefs } from "@/lib/quire/prefs";

export function pageLabel(start: number, end: number) {
  if (!start) return "Page unknown";
  if (start === end) return `Page ${start}`;
  return `Pages ${start}–${end}`;
}

export function RemoveButton({
  label,
  title,
  body,
  onRemove,
  className,
}: {
  label: string;
  title: string;
  body: string;
  onRemove: () => void;
  className?: string;
}) {
  const { prefs } = usePrefs();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={cn("text-sm text-muted", className)}
        onClick={() => {
          if (prefs.confirmRemoves) setOpen(true);
          else onRemove();
        }}
      >
        {label}
      </button>
      <Confirm
        open={open}
        onOpenChange={setOpen}
        title={title}
        body={body}
        confirmLabel="Remove"
        onConfirm={onRemove}
      />
    </>
  );
}

