import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, Field, Fold, Switch, TextInput } from "@/components/ui";
import { getCampaigns } from "@/lib/quire/campaigns";
import {
  clearSeatLock,
  isLockedFile,
  loadSeatLock,
  lockFile,
  passwordMatches,
  saveSeatLock,
  sealPassword,
  unlockFile,
  type SeatLock,
} from "@/lib/quire/lock";
import { readQuireFile } from "@/lib/quire/economy";
import { listSaves, replaceSaves } from "@/lib/quire/saves";

export function PasswordSettings() {
  const [lock, setLock] = useState<SeatLock | null | undefined>(undefined);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadSeatLock()
      .then((next) => {
        if (!cancelled) setLock(next);
      })
      .catch(() => {
        if (!cancelled) setLock(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function resetFields() {
    setCurrent("");
    setPassword("");
    setAgain("");
    setError("");
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (password.trim().length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== again) {
      setError("Those passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const sealed = await sealPassword(password, false);
      await saveSeatLock(sealed);
      setLock(sealed);
      resetFields();
      toast.success("Password saved with this campaign.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That password could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function change(event: FormEvent) {
    event.preventDefault();
    if (!lock) return;
    if (password.trim().length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== again) {
      setError("Those passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (!(await passwordMatches(current, lock))) {
        setError("That password does not match this save.");
        return;
      }
      const sealed = await sealPassword(password, lock.protectSaves);
      const campaignId = getCampaigns().activeId;
      const saves = await listSaves(campaignId);
      const replacements = [];
      for (const save of saves) {
        if (!isLockedFile(save.file)) continue;
        const plain = readQuireFile(await unlockFile(save.file, current));
        plain.seatLock = sealed;
        replacements.push({ ...save, file: await lockFile(plain, password, sealed.salt) });
      }
      await replaceSaves(replacements);
      try {
        await saveSeatLock(sealed);
      } catch (error) {
        await replaceSaves(saves);
        throw error;
      }
      setLock(sealed);
      resetFields();
      toast.success("Password changed. Locked saves use the new one.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That password could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!lock) return;
    setBusy(true);
    try {
      if (!(await passwordMatches(current, lock))) {
        setError("That password does not match this save.");
        return;
      }
      await clearSeatLock();
      setLock(null);
      resetFields();
      toast.success("Password removed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That password could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  async function protect(on: boolean) {
    if (!lock) return;
    const next = { ...lock, protectSaves: on };
    await saveSeatLock(next);
    setLock(next);
    toast.success(on ? "Saves ask for this password." : "Saves are not password protected.");
  }

  return (
    <Fold
      title="Password"
      hint="One password for the dungeon master switch and, if you turn it on, for saves."
    >
      {lock === undefined ? <p className="text-sm text-muted">Loading…</p> : null}
      {lock === null ? (
        <form className="flex flex-col gap-3" onSubmit={(event) => void create(event)}>
          <p className="text-sm text-muted">
            This campaign has no password. Set one here. It is kept with the save. A player must
            enter it to become the dungeon master.
          </p>
          <Field label="Password">
            <TextInput
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label="Confirm password">
            <TextInput
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(event) => setAgain(event.target.value)}
            />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            Save password
          </Button>
        </form>
      ) : null}
      {lock ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            A password is saved with this campaign. Switching to dungeon master asks for it.
            Switching to player asks you to confirm. Shared modes block both.
          </p>
          <Switch
            checked={lock.protectSaves}
            onChange={(on) =>
              void protect(on).catch((caught) =>
                toast.error(
                  caught instanceof Error ? caught.message : "That setting could not be saved.",
                ),
              )
            }
            label="Protect saves"
            hint="Save, load, import, and export ask for this same password. The file itself is locked."
          />
          <form className="flex flex-col gap-3" onSubmit={(event) => void change(event)}>
            <Field label="Current password">
              <TextInput
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            </Field>
            <Field label="New password">
              <TextInput
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field label="Confirm new password">
              <TextInput
                type="password"
                autoComplete="new-password"
                value={again}
                onChange={(event) => setAgain(event.target.value)}
              />
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                Change password
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void remove()}
              >
                Remove password
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </Fold>
  );
}
