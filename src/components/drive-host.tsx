import { useEffect, useState } from "react";
import { toast } from "sonner";
import { askDrive, driveCopiesSaves, sendBugReport, sendToDrive, setDriveCopiesSaves } from "@/lib/quire/drive-client";
import { snapshot } from "@/lib/quire/economy";
import { redirectToLoginIfRequired } from "@/lib/app-data";
import { APP_VERSION } from "@/lib/quire/version";
import { Button, Switch, TextInput } from "@/components/ui";

export function DriveHost() {
  const [copies, setCopies] = useState(false);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setCopies(driveCopiesSaves()), []);

  function run(work: () => Promise<void>) {
    setBusy(true);
    void work()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Google Drive could not take that file.";
        setStatus(message);
        toast.error(message);
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Version {APP_VERSION}. A connected Google Drive holds a Lootsplit folder for backups, saves, and bug reports.
      </p>
      <div>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const result = await askDrive();
              if (result.loginUrl && redirectToLoginIfRequired({ ok: false, data: null, loginRequired: true, loginUrl: result.loginUrl })) {
                setStatus("Continue in the Google window, then check again.");
                return;
              }
              setStatus(result.connected ? "Google Drive is connected." : result.error || "Google Drive is not connected.");
            })
          }
        >
          Check Google Drive
        </Button>
      </div>
      <Switch
        checked={copies}
        label="Copy saves to Drive"
        hint="Each save in the folder is also copied to Google Drive."
        onChange={(on) => {
          setDriveCopiesSaves(on);
          setCopies(on);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const file = await snapshot();
              const copied = await sendToDrive("backup", "campaign", JSON.stringify(file));
              setStatus(copied.files.length > 0 ? `Copied ${copied.name}. The folder has ${copied.files.join(", ")}.` : `Copied ${copied.name}.`);
              toast.success("Backup copied to Google Drive.");
            })
          }
        >
          Send a backup
        </Button>
      </div>
      <TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="What went wrong" aria-label="Bug note" />
      <div>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await sendBugReport(note);
              setNote("");
              setStatus("Bug report copied to Google Drive.");
              toast.success("Bug report copied to Google Drive.");
            })
          }
        >
          Send bug report
        </Button>
      </div>
      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}
