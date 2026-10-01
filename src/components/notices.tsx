import { useEffect, useState } from "react";
import { noticesOn, setNotices } from "@/lib/quire/notify";
import { sendBugReport } from "@/lib/quire/drive-client";
import { Switch, Button } from "@/components/ui";

export function Notices() {
  const [on, setOn] = useState(false);
  const [hint, setHint] = useState("A notice when the mode changes, a message arrives, or it is your turn. Mail after the app is closed needs a mail account, and none is connected.");

  useEffect(() => setOn(noticesOn()), []);

  return (
    <div>
      <Switch
        checked={on}
        label="Notices"
        hint={hint}
        onChange={(checked) => {
          void setNotices(checked).then((allowed) => {
            setOn(allowed);
            if (checked && !allowed) setHint("This browser did not allow notices.");
            else setHint(allowed ? "Notices are on for this phone." : "Notices are off.");
          });
        }}
      />
      <div className="mt-3">
        <Button
          variant="secondary"
          onClick={() => {
            void sendBugReport().then(
              () => setHint("Bug report copied to Google Drive."),
              (error: unknown) => setHint(error instanceof Error ? error.message : "The bug report could not be sent."),
            );
          }}
        >
          Send bug report
        </Button>
      </div>
    </div>
  );
}
