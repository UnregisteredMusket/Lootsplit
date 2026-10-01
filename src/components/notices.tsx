import { PushNotices } from "./push-notices";
import { useEffect, useState } from "react";
import { noticesOn, setNotices } from "@/lib/quire/notify";
import { downloadBugReport } from "@/lib/quire/diagnostics";
import { Switch, Button } from "@/components/ui";

export function Notices() {
  const [on, setOn] = useState(false);
  const [hint, setHint] = useState(
    "Receive notifications for messages, mode changes, and turns while Lootsplit is running. Browser permission is required.",
  );

  useEffect(() => setOn(noticesOn()), []);

  return (
    <div>
      <PushNotices />
      <Switch
        checked={on}
        label="Alerts while the app is open"
        hint={hint}
        onChange={(checked) => {
          void setNotices(checked).then((allowed) => {
            setOn(allowed);
            if (checked && !allowed) setHint("This browser did not allow notifications.");
            else
              setHint(
                allowed
                  ? "Notifications are on for this browser on this device."
                  : "Notifications are off.",
              );
          });
        }}
      />
      <div className="mt-3">
        <Button
          variant="secondary"
          onClick={() => {
            void downloadBugReport().then(
              () => setHint("Diagnostic report downloaded."),
              (error: unknown) =>
                setHint(
                  error instanceof Error ? error.message : "The bug report could not be sent.",
                ),
            );
          }}
        >
          Download diagnostic report
        </Button>
      </div>
    </div>
  );
}
