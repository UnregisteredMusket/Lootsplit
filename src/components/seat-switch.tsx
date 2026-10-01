import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, Modal, TextInput } from "@/components/ui";
import { releasePlayerSeat } from "@/lib/quire/cloud-client";
import { getCloudWatch } from "@/lib/quire/cloud-turn";
import { loadSeatLock, passwordMatches, type SeatLock } from "@/lib/quire/lock";
import { setSeat, type Seat } from "@/lib/quire/table";

export function SeatSwitch({
  open,
  onOpenChange,
  seat,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seat: Seat;
}) {
  const [lock, setLock] = useState<SeatLock | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setError("");
    setLock(undefined);
    void loadSeatLock()
      .then(setLock)
      .catch(() => setLock(null));
  }, [open]);

  async function flip(event: FormEvent) {
    event.preventDefault();
    const watch = getCloudWatch();
    if (watch.joined && watch.live) {
      setError("Live Mode does not allow a role change.");
      return;
    }
    if (!lock) return;
    setBusy(true);
    try {
      if (!(await passwordMatches(password, lock))) {
        setError("That password does not match this save.");
        return;
      }
      setSeat({ ...seat, role: "dm", elevated: true });
      releasePlayerSeat();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Switch to dungeon master">
      {lock === undefined ? <p className="text-sm text-muted">Loading…</p> : null}
      {lock === null ? (
        <p className="text-sm text-muted">This save has no password yet. The dungeon master sets it in Settings, then copies a new player link.</p>
      ) : null}
      {lock ? (
        <form className="flex flex-col gap-3" onSubmit={(event) => void flip(event)}>
          <p className="text-sm text-muted">Enter the password from this save. The bill you send will say this phone became the dungeon master.</p>
          <Field label="Password">
            <TextInput type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={busy || password.length === 0}>
            Switch to dungeon master
          </Button>
        </form>
      ) : null}
    </Modal>
  );
}
