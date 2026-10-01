import { useState } from "react";
import { toast } from "sonner";
import { downloadBugReport } from "@/lib/quire/diagnostics";
import { Button, TextInput } from "./ui";
export function Diagnostics() {
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Download an error report to this device and share it manually if you need help. Reports are
        not sent automatically.
      </p>
      <TextInput
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Describe the issue (optional)"
        aria-label="Bug note"
      />
      <Button
        variant="secondary"
        onClick={() =>
          void downloadBugReport(note)
            .then(() => {
              setNote("");
              toast.success("Diagnostic report downloaded.");
            })
            .catch((e) => toast.error(e instanceof Error ? e.message : "Download failed."))
        }
      >
        Download diagnostic report
      </Button>
    </div>
  );
}
